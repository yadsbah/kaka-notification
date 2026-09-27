import { CredentialStatus, Prisma, type Notification } from "@prisma/client";
import Elysia from "elysia";
import { getJobsCountHelper } from "../../../helpers/jobs/jobs.helper";
import {
  cancelNotificationHelper,
  createNotificationHelper,
  getNotificationErrorBreakdownHelper,
  getNotificationJobSummaryHelper,
  getNotificationsHelper,
  getTokenResultsCountHelper,
  getTokenResultsHelper,
  releaseIdempotencyKeyHelper,
} from "../../../helpers/notifications/notifications.helper";
import {
  apiGetInvalidTokensSchema,
  createNotificationSchema,
  idempotencyHeaderSchema,
  notificationParamsSchema,
  type CreateNotificationSchema,
} from "../../../models/notifications/notifications.mo";
import { projectAuther } from "../../../plugins/derives/api_key.derives";
import { normalizeTokens } from "../../../utils/chunk.utils";
import { sha256 } from "../../../utils/crypto.utils";
import { notificationRuleErrors } from "../../../utils/notification_rules.utils";
import { stableStringify } from "../../../utils/stable_json.utils";

const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

const toAcceptedResponse = (notification: Notification, jobs: number) => ({
  id: notification.id,
  status: notification.status.toLowerCase(),
  totalTokens: notification.totalTokens,
  uniqueTokens: notification.uniqueTokens,
  jobs,
});

const splitBody = (body: CreateNotificationSchema) => {
  const { tokens, externalId, ...payload } = body;
  return { tokens, externalId, payload };
};

const apiNotificationsRouter = new Elysia({
  tags: ["API Notifications", "API"],
}).group("/notifications", (app) =>
  app
    .use(projectAuther)
    .post(
      "/",
      async ({ body, headers, project, set, error }) => {
        if (project.credentialStatus === CredentialStatus.MISSING) {
          return error(409, { error: "Project has no Firebase service account yet" });
        }

        const requestHash = sha256(stableStringify(body));
        const idempotencyKey = headers["idempotency-key"];

        // Returns the stored notification (200) or a 409, or null when the key is free to use.
        const replay = async () => {
          if (!idempotencyKey) return null;
          const existing = (await getNotificationsHelper({ projectID: project.id, idempotencyKey }))?.[0];
          if (!existing) return null;
          if (Date.now() - existing.createdAt.getTime() >= IDEMPOTENCY_WINDOW_MS) {
            await releaseIdempotencyKeyHelper(existing.id);
            return null;
          }
          if (existing.requestHash !== requestHash) {
            return error(409, { error: "Idempotency-Key was already used with a different request body" });
          }
          set.status = 200;
          const jobs = await getJobsCountHelper({ notificationID: existing.id, parentJobID: null });
          return toAcceptedResponse(existing, jobs);
        };

        const replayed = await replay();
        if (replayed) return replayed;

        const { tokens, externalId, payload } = splitBody(body);
        const uniqueTokens = normalizeTokens(tokens);
        try {
          const { notification, jobs } = await createNotificationHelper({
            projectID: project.id,
            payload,
            externalID: externalId,
            idempotencyKey,
            requestHash,
            totalTokens: tokens.length,
            tokens: uniqueTokens,
          });
          set.status = 202;
          return toAcceptedResponse(notification, jobs);
        } catch (err) {
          // Two concurrent requests with the same key: the loser replays the winner.
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            const raced = await replay();
            if (raced) return raced;
          }
          throw err;
        }
      },
      {
        body: createNotificationSchema,
        headers: idempotencyHeaderSchema,
        beforeHandle: ({ body, error }) => {
          const fields = notificationRuleErrors(body);
          if (fields.length > 0) return error(400, { error: "Validation failed", fields });
        },
      }
    )
    .group(
      "/:id",
      {
        params: notificationParamsSchema,
        beforeHandle: async ({ params, project, error }) => {
          const notification = await getNotificationsHelper({ id: params.id, projectID: project.id });
          if (!notification) return error(404, { error: "Notification not found" });
        },
      },
      (app) =>
        app
          .get("/", async ({ params, project }) => {
            const notification = (await getNotificationsHelper({ id: params.id, projectID: project.id }))![0]!;
            return {
              id: notification.id,
              externalId: notification.externalID,
              status: notification.status.toLowerCase(),
              totalTokens: notification.totalTokens,
              uniqueTokens: notification.uniqueTokens,
              successCount: notification.successCount,
              invalidCount: notification.invalidCount,
              failedCount: notification.failedCount,
              pendingCount: notification.pendingCount,
              createdAt: notification.createdAt,
              startedAt: notification.startedAt,
              finishedAt: notification.finishedAt,
              jobs: await getNotificationJobSummaryHelper(notification.id),
              errors: await getNotificationErrorBreakdownHelper(notification.id),
            };
          })
          .get(
            "/invalid-tokens",
            async ({ params, query }) => {
              const filter = { notificationID: params.id, outcome: "INVALID" as const };
              const limit = query.limit ?? 100;
              const offset = query.offset ?? 0;
              const results = await getTokenResultsHelper({ ...filter, limit, offset });
              return {
                tokens: (results ?? []).map((result) => ({
                  token: result.token,
                  errorCode: result.errorCode,
                })),
                count: await getTokenResultsCountHelper(filter),
                limit,
                offset,
              };
            },
            { query: apiGetInvalidTokensSchema }
          )
          .post("/cancel", async ({ params, project, error }) => {
            const notification = (await getNotificationsHelper({ id: params.id, projectID: project.id }))![0]!;
            if (notification.finishedAt) return error(409, { error: "Notification already finished" });
            const result = await cancelNotificationHelper(notification.id);
            const updated = (await getNotificationsHelper({ id: notification.id }))![0]!;
            return { id: updated.id, status: updated.status.toLowerCase(), ...result };
          })
    )
);

export default apiNotificationsRouter;
