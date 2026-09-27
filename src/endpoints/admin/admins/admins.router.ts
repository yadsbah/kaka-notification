import { Prisma } from "@prisma/client";
import Elysia, { t } from "elysia";
import {
  createAdminHelper,
  deleteAdminHelper,
  getAdminsCountHelper,
  getAdminsHelper,
  hashPassword,
  updateAdminHelper,
} from "../../../helpers/admins/admins.helper";
import { createAuditLogHelper } from "../../../helpers/audit/audit.helper";
import { deleteSessionsHelper } from "../../../helpers/sessions/sessions.helper";
import { createAdminSchema, getAdminsSchema, updateAdminPasswordSchema } from "../../../models/admins/admins.mo";
import { id } from "../../../models/shared.mo";
import { adminAuther } from "../../../plugins/derives/admin_session.derives";

const adminAdminsRouter = new Elysia({
  tags: ["Admin Admins", "Admin"],
}).group("/admins", (app) =>
  app
    .use(adminAuther)
    .get(
      "/",
      async ({ query }) => ({
        admins: (await getAdminsHelper(query)) ?? [],
        count: await getAdminsCountHelper({ ...query, limit: undefined, offset: undefined }),
      }),
      { query: getAdminsSchema }
    )
    .post(
      "/",
      async ({ body, admin, error }) => {
        try {
          const created = await createAdminHelper(body);
          await createAuditLogHelper({
            adminID: admin.id,
            action: "admin.created",
            targetType: "admin",
            targetID: String(created.id),
            details: { email: created.email },
          });
          return created;
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            return error(409, { error: "An admin with this email already exists" });
          }
          throw err;
        }
      },
      { body: createAdminSchema }
    )
    .group(
      "/:id",
      {
        params: t.Object({ id }),
        beforeHandle: async ({ params, error }) => {
          const target = await getAdminsHelper({ id: params.id });
          if (!target) return error(404, { error: "Admin not found" });
        },
      },
      (app) =>
        app
          .patch(
            "/password",
            async ({ params, body, admin, session }) => {
              const updated = await updateAdminHelper(params.id, {
                passwordHash: await hashPassword(body.password),
                failedLogins: 0,
                lockedUntil: null,
              });
              // Sign the target out everywhere, except the session making the change.
              await deleteSessionsHelper({ adminID: params.id, keepSessionID: session.id });
              await createAuditLogHelper({
                adminID: admin.id,
                action: "admin.password_changed",
                targetType: "admin",
                targetID: String(params.id),
              });
              return { id: updated.id, email: updated.email };
            },
            { body: updateAdminPasswordSchema }
          )
          .delete("/", async ({ params, admin, error }) => {
            if (params.id === admin.id) return error(400, { error: "You can't delete your own account" });
            if ((await getAdminsCountHelper({})) <= 1) return error(400, { error: "Can't delete the last admin" });
            const deleted = await deleteAdminHelper(params.id);
            await createAuditLogHelper({
              adminID: admin.id,
              action: "admin.deleted",
              targetType: "admin",
              targetID: String(deleted.id),
              details: { email: deleted.email },
            });
            return { id: deleted.id, deleted: true };
          })
    )
);

export default adminAdminsRouter;
