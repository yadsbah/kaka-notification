import { JobStatus } from "@prisma/client";
import Elysia, { t } from "elysia";
import { createAuditLogHelper } from "../../../helpers/audit/audit.helper";
import {
  failJobManuallyHelper,
  getJobsCountHelper,
  getJobsHelper,
  retryFailedTokensHelper,
} from "../../../helpers/jobs/jobs.helper";
import { getJobsSchema, jobParamsSchema } from "../../../models/jobs/jobs.mo";
import { adminAuther } from "../../../plugins/derives/admin_session.derives";
import { toAdminJob } from "../notifications/notifications.router";

const adminJobsRouter = new Elysia({
  tags: ["Admin Jobs", "Admin"],
}).group("/jobs", (app) =>
  app
    .use(adminAuther)
    .get(
      "/",
      async ({ query }) => ({
        jobs: ((await getJobsHelper(query)) ?? []).map(toAdminJob),
        count: await getJobsCountHelper({ ...query, limit: undefined, offset: undefined }),
      }),
      { query: getJobsSchema }
    )
    .group(
      "/:id",
      {
        params: jobParamsSchema,
        beforeHandle: async ({ params, error }) => {
          const job = await getJobsHelper({ id: params.id });
          if (!job) return error(404, { error: "Job not found" });
        },
      },
      (app) =>
        app
          .post("/requeue", async ({ params, admin, error }) => {
            const job = (await getJobsHelper({ id: params.id }))![0]!;
            if (job.status !== JobStatus.FAILED) return error(409, { error: "Only failed jobs can be requeued" });
            const result = await retryFailedTokensHelper({ notificationID: job.notificationID, jobID: job.id });
            if (result.tokens === 0) {
              return error(409, { error: "This job has no failed tokens left to retry (results may have expired)" });
            }
            await createAuditLogHelper({
              adminID: admin.id,
              action: "job.requeued",
              targetType: "job",
              targetID: job.id,
              details: result,
            });
            return result;
          })
          .post(
            "/fail",
            async ({ params, body, admin, error }) => {
              const reason = body?.reason ?? "Failed manually by an admin";
              const result = await failJobManuallyHelper(params.id, reason);
              if (!result.failed) return error(409, { error: "Only pending or processing jobs can be failed" });
              await createAuditLogHelper({
                adminID: admin.id,
                action: "job.failed_manually",
                targetType: "job",
                targetID: params.id,
                details: { reason },
              });
              return result;
            },
            { body: t.Optional(t.Object({ reason: t.Optional(t.String({ maxLength: 500 })) })) }
          )
    )
);

export default adminJobsRouter;
