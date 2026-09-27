import { CredentialStatus, TokenOutcome, type Job } from "@prisma/client";
import Elysia from "elysia";
import { createAuditLogHelper } from "../../../helpers/audit/audit.helper";
import { getJobsHelper, retryFailedTokensHelper } from "../../../helpers/jobs/jobs.helper";
import {
  cancelNotificationHelper,
  createNotificationHelper,
  getNotificationErrorBreakdownHelper,
  getNotificationJobSummaryHelper,
  getNotificationsCountHelper,
  getNotificationsHelper,
  getTokenResultsCountHelper,
  getTokenResultsHelper,
} from "../../../helpers/notifications/notifications.helper";
import { getProjectsHelper } from "../../../helpers/projects/projects.helper";
import { getWebhookDeliveriesHelper } from "../../../helpers/webhooks/webhooks.helper";
import { maskToken } from "../../../logger";
import {
  adminCreateNotificationSchema,
  adminGetTokenResultsSchema,
  getNotificationsSchema,
  notificationParamsSchema,
  tokenResultParamsSchema,
} from "../../../models/notifications/notifications.mo";
import { adminAuther } from "../../../plugins/derives/admin_session.derives";
import { normalizeTokens } from "../../../utils/chunk.utils";
import { sha256 } from "../../../utils/crypto.utils";
import { notificationRuleErrors } from "../../../utils/notification_rules.utils";
import { stableStringify } from "../../../utils/stable_json.utils";

// Jobs are listed without their token arrays; those can be 500 full FCM tokens each.
export const toAdminJob = ({ tokens, ...job }: Job & { Project?: { id: string; name: string } }) => job;

const csvCell = (value: string | null) => `"${(value ?? "").replaceAll('"', '""')}"`;

const adminNotificationsRouter = new Elysia({
  tags: ["Admin Notifications", "Admin"],
}).group("/notifications", (app) =>
  app
    .use(adminAuther)
    .get(
      "/",
      async ({ query }) => {
        const notifications = (await getNotificationsHelper(query)) ?? [];
        return {
          notifications: notifications.map(({ payload, requestHash, idempotencyKey, ...notification }) => notification),
          count: await getNotificationsCountHelper({ ...query, limit: undefined, offset: undefined }),
        };
      },
      { query: getNotificationsSchema }
    )
    // Sends from the dashboard go through the same queue, workers and results as API sends.
    .post(
      "/",
      async ({ body, admin }) => {
        const { projectID, tokens, externalId, ...payload } = body;
        const { notification, jobs } = await createNotificationHelper({
          projectID,
          payload,
          externalID: externalId,
          requestHash: sha256(stableStringify(body)),
          totalTokens: tokens.length,
          tokens: normalizeTokens(tokens),
        });
        await createAuditLogHelper({
          adminID: admin.id,
          action: "notification.sent",
          targetType: "notification",
          targetID: notification.id,
          details: { projectID, tokens: notification.uniqueTokens, externalId },
        });
        return {
          id: notification.id,
          status: notification.status.toLowerCase(),
          totalTokens: notification.totalTokens,
          uniqueTokens: notification.uniqueTokens,
          jobs,
        };
      },
      {
        body: adminCreateNotificationSchema,
        beforeHandle: async ({ body, error }) => {
          const fields = notificationRuleErrors(body);
          if (fields.length > 0) return error(400, { error: "Validation failed", fields });
          const project = (await getProjectsHelper({ id: body.projectID }))?.[0];
          if (!project) return error(404, { error: "Project not found" });
          if (!project.enabled) return error(409, { error: "Project is disabled" });
          if (project.credentialStatus === CredentialStatus.MISSING) {
            return error(409, { error: "Upload the project's service account first" });
          }
        },
      }
    )
    .group(
      "/:id",
      {
        params: notificationParamsSchema,
        beforeHandle: async ({ params, error }) => {
          const notification = await getNotificationsHelper({ id: params.id });
          if (!notification) return error(404, { error: "Notification not found" });
        },
      },
      (app) =>
        app
          .get("/", async ({ params }) => {
            const { requestHash, ...notification } = (await getNotificationsHelper({ id: params.id }))![0]!;
            return {
              ...notification,
              jobSummary: await getNotificationJobSummaryHelper(params.id),
              jobs: ((await getJobsHelper({ notificationID: params.id, limit: 0 })) ?? []).map(toAdminJob),
              errors: await getNotificationErrorBreakdownHelper(params.id),
              webhookDeliveries: (await getWebhookDeliveriesHelper({ notificationID: params.id, limit: 0 })) ?? [],
            };
          })
          .get(
            "/results",
            async ({ params, query }) => {
              const filter = { ...query, notificationID: params.id };
              const results = (await getTokenResultsHelper({ ...filter, limit: query.limit ?? 50 })) ?? [];
              return {
                results: results.map((result) => ({ ...result, token: maskToken(result.token) })),
                count: await getTokenResultsCountHelper({ ...filter, limit: undefined, offset: undefined }),
              };
            },
            { query: adminGetTokenResultsSchema }
          )
          .get(
            "/results/:resultID",
            async ({ params, error }) => {
              const result = (await getTokenResultsHelper({ notificationID: params.id, limit: 0 }))?.find(
                (row) => row.id === params.resultID
              );
              if (!result) return error(404, { error: "Token result not found" });
              return result;
            },
            { params: tokenResultParamsSchema }
          )
          .get("/invalid-tokens.csv", async ({ params, set }) => {
            const results = (await getTokenResultsHelper({ notificationID: params.id, outcome: TokenOutcome.INVALID, limit: 0 })) ?? [];
            set.headers["content-type"] = "text/csv; charset=utf-8";
            set.headers["content-disposition"] = `attachment; filename="${params.id}-invalid-tokens.csv"`;
            return ["token,error_code,error_message", ...results.map((r) => [r.token, r.errorCode, r.errorMessage].map(csvCell).join(","))].join("\n");
          })
          .post("/cancel", async ({ params, admin, error }) => {
            const notification = (await getNotificationsHelper({ id: params.id }))![0]!;
            if (notification.finishedAt) return error(409, { error: "Notification already finished" });
            const result = await cancelNotificationHelper(params.id);
            await createAuditLogHelper({
              adminID: admin.id,
              action: "notification.canceled",
              targetType: "notification",
              targetID: params.id,
              details: result,
            });
            return result;
          })
          .post("/retry-failed", async ({ params, admin, error }) => {
            const result = await retryFailedTokensHelper({ notificationID: params.id });
            if (result.tokens === 0) return error(409, { error: "No failed tokens to retry (invalid tokens are never retried)" });
            await createAuditLogHelper({
              adminID: admin.id,
              action: "notification.retried",
              targetType: "notification",
              targetID: params.id,
              details: result,
            });
            return result;
          })
    )
);

export default adminNotificationsRouter;
