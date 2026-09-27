import Elysia from "elysia";
import { getSessionsHelper } from "../../helpers/sessions/sessions.helper";
import { safeEqual } from "../../utils/crypto.utils";

export const SESSION_COOKIE = "nm_session";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Session cookie → admin. Every state-changing request must echo the session's CSRF token in
// X-CSRF-Token (the SPA gets it from /api/admin/auth/me). Unnamed on purpose, see api_key.derives.ts.
export const adminAuther = new Elysia().derive({ as: "scoped" }, async ({ cookie, request, headers, error }) => {
  const value = cookie[SESSION_COOKIE]?.value;
  if (!value || typeof value !== "string") return error(401, { error: "Not signed in" });

  const session = (await getSessionsHelper({ cookieValue: value }))?.[0];
  if (!session) return error(401, { error: "Session expired, sign in again" });

  if (!SAFE_METHODS.has(request.method)) {
    const csrf = headers["x-csrf-token"];
    if (!csrf || !safeEqual(csrf, session.csrfToken)) return error(403, { error: "Invalid CSRF token" });
  }

  return { admin: session.Admin, session };
});
