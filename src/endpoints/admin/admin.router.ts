import Elysia from "elysia";
import adminAdminsRouter from "./admins/admins.router";
import adminAuditRouter from "./audit/audit.router";
import adminAuthRouter from "./auth/auth.router";
import adminJobsRouter from "./jobs/jobs.router";
import adminNotificationsRouter from "./notifications/notifications.router";
import adminOverviewRouter from "./overview/overview.router";
import adminProjectsRouter from "./projects/projects.router";

// Each feature router applies adminAuther itself; login is the only unauthenticated admin route.
const adminRouter = new Elysia({
  tags: ["Admin"],
}).group("/admin", (app) =>
  app
    .use(adminAuthRouter)
    .use(adminOverviewRouter)
    .use(adminProjectsRouter)
    .use(adminNotificationsRouter)
    .use(adminJobsRouter)
    .use(adminAdminsRouter)
    .use(adminAuditRouter)
);

export default adminRouter;
