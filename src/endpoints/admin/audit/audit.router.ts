import Elysia from "elysia";
import { getAuditLogsCountHelper, getAuditLogsHelper } from "../../../helpers/audit/audit.helper";
import { getAuditLogsSchema } from "../../../models/audit/audit.mo";
import { adminAuther } from "../../../plugins/derives/admin_session.derives";

const adminAuditRouter = new Elysia({
  tags: ["Admin Audit", "Admin"],
}).group("/audit", (app) =>
  app.use(adminAuther).get(
    "/",
    async ({ query }) => ({
      logs: (await getAuditLogsHelper(query)) ?? [],
      count: await getAuditLogsCountHelper({ ...query, limit: undefined, offset: undefined }),
    }),
    { query: getAuditLogsSchema }
  )
);

export default adminAuditRouter;
