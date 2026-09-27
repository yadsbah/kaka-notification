import Elysia from "elysia";
import { config } from "./config";
import adminRouter from "./endpoints/admin/admin.router";
import apiRouter from "./endpoints/api/api.router";
import healthRouter from "./endpoints/health.router";
import webRouter from "./endpoints/web.router";
import { logger } from "./logger";

export function buildApp() {
  // normalize: false — strict schemas must reject unknown fields, not silently strip them.
  return new Elysia({ normalize: false })
    .onRequest(({ request, set }) => {
      set.headers["x-content-type-options"] = "nosniff";
      set.headers["x-frame-options"] = "DENY";
      set.headers["referrer-policy"] = "no-referrer";
      set.headers["cross-origin-opener-policy"] = "same-origin";
      if (config.cookieSecure) set.headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
      // The Swagger page loads its UI from a CDN; everything else is same-origin only.
      if (!new URL(request.url).pathname.startsWith("/docs")) {
        set.headers["content-security-policy"] =
          "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
      }

      const length = Number(request.headers.get("content-length") ?? 0);
      if (length > config.maxBodySize) {
        set.status = 413;
        return { error: `Request body exceeds ${config.maxBodySize} bytes` };
      }
    })
    .onError({ as: "global" }, ({ code, error, set, request }) => {
      if (code === "VALIDATION") {
        set.status = 400;
        return {
          error: "Validation failed",
          fields: error.all.map((issue) => ({
            path: "path" in issue ? issue.path : "",
            message: ("message" in issue && issue.message) || issue.summary || "Invalid value",
          })),
        };
      }
      if (code === "PARSE") {
        set.status = 400;
        return { error: "Request body is not valid JSON" };
      }
      if (code === "NOT_FOUND") {
        set.status = 404;
        return { error: "Not found" };
      }
      logger.error({ err: error, method: request.method, url: request.url }, "Unhandled error");
      set.status = 500;
      return { error: "Internal server error" };
    })
    .use(healthRouter)
    .group("/api", (app) => app.use(apiRouter).use(adminRouter))
    .use(webRouter);
}
