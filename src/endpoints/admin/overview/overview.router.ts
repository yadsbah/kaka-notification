import { CredentialStatus } from "@prisma/client";
import Elysia from "elysia";
import { getQueueDepthHelper } from "../../../helpers/jobs/jobs.helper";
import { getRecentJobErrorsHelper, getSendsLast24hHelper } from "../../../helpers/overview/overview.helper";
import { getProjectsHelper } from "../../../helpers/projects/projects.helper";
import { getWorkersHelper } from "../../../helpers/workers/workers.helper";
import { adminAuther } from "../../../plugins/derives/admin_session.derives";

const adminOverviewRouter = new Elysia({
  tags: ["Admin Overview", "Admin"],
}).group("/overview", (app) =>
  app.use(adminAuther).get("/", async () => {
    const credentialProblems = await getProjectsHelper({ credentialStatus: CredentialStatus.ERROR });
    return {
      queue: await getQueueDepthHelper(),
      last24h: await getSendsLast24hHelper(),
      workers: (await getWorkersHelper()) ?? [],
      recentErrors: (await getRecentJobErrorsHelper()) ?? [],
      credentialProblems: (credentialProblems ?? []).map((project) => ({
        id: project.id,
        name: project.name,
        credentialError: project.credentialError,
        lastErrorAt: project.lastErrorAt,
      })),
    };
  })
);

export default adminOverviewRouter;
