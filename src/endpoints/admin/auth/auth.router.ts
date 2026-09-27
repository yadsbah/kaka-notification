import Elysia from "elysia";
import { config } from "../../../config";
import { getAdminCredentialsHelper, hashPassword, updateAdminHelper } from "../../../helpers/admins/admins.helper";
import { createSessionHelper, deleteSessionsHelper } from "../../../helpers/sessions/sessions.helper";
import { loginSchema } from "../../../models/admins/admins.mo";
import { adminAuther, SESSION_COOKIE } from "../../../plugins/derives/admin_session.derives";
import { takeRateLimit } from "../../../utils/rate_limit.utils";

const MAX_FAILED_LOGINS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// Verified against when the email doesn't exist, so response time doesn't reveal which emails are admins.
let dummyHash: Promise<string> | null = null;

const adminAuthRouter = new Elysia({
  tags: ["Admin Auth", "Admin"],
}).group("/auth", (app) =>
  app
    .post(
      "/login",
      async ({ body, cookie, error, request, server }) => {
        const ip = server?.requestIP(request)?.address ?? "unknown";
        if (!takeRateLimit(`login:${ip}`, config.loginRateLimitPerMin).allowed) {
          return error(429, { error: "Too many login attempts, try again in a minute" });
        }

        const admin = (await getAdminCredentialsHelper(body.email))?.[0];
        if (admin?.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
          return error(429, { error: "Too many failed attempts, try again later" });
        }

        dummyHash ??= hashPassword("not-a-real-password");
        const valid = await Bun.password.verify(body.password, admin?.passwordHash ?? (await dummyHash));
        if (!admin || !valid) {
          if (admin) {
            const failures = admin.failedLogins + 1;
            await updateAdminHelper(admin.id, {
              failedLogins: failures >= MAX_FAILED_LOGINS ? 0 : failures,
              lockedUntil: failures >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : undefined,
            });
          }
          return error(401, { error: "Invalid email or password" });
        }

        await updateAdminHelper(admin.id, { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() });
        const session = await createSessionHelper(admin.id, config.sessionTtlHours);
        cookie[SESSION_COOKIE]!.set({
          value: session.cookieValue,
          httpOnly: true,
          secure: config.cookieSecure,
          sameSite: "lax",
          path: "/",
          expires: session.expiresAt,
        });
        return { admin: { id: admin.id, email: admin.email }, csrfToken: session.csrfToken, expiresAt: session.expiresAt };
      },
      { body: loginSchema }
    )
    .use(adminAuther)
    .get("/me", ({ admin, session }) => ({
      admin: { id: admin.id, email: admin.email, lastLoginAt: admin.lastLoginAt },
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    }))
    .post("/logout", async ({ cookie }) => {
      await deleteSessionsHelper({ cookieValue: cookie[SESSION_COOKIE]!.value as string });
      cookie[SESSION_COOKIE]!.remove();
      return { ok: true };
    })
);

export default adminAuthRouter;
