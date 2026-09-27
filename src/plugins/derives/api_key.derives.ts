import bearer from "@elysiajs/bearer";
import Elysia from "elysia";
import { config } from "../../config";
import { getProjectSecretsHelper } from "../../helpers/projects/projects.helper";
import { parseApiKeyPublicID, verifyApiKey } from "../../utils/api_key.utils";
import { takeRateLimit } from "../../utils/rate_limit.utils";

// Resolves the calling project from `Authorization: Bearer nm_<publicId>_<secret>`.
// 401 missing/invalid key, 403 disabled project, 429 over the per-key rate limit.
// Deliberately unnamed: Elysia dedupes named plugins, which would skip the guard on later routers.
export const projectAuther = new Elysia()
  .use(bearer())
  .derive({ as: "scoped" }, async ({ bearer, error, set }) => {
    if (!bearer) return error(401, { error: "API key required" });

    const publicID = parseApiKeyPublicID(bearer);
    if (!publicID) return error(401, { error: "Invalid API key" });

    const project = (await getProjectSecretsHelper({ apiKeyPublicID: publicID }))?.[0];
    if (!project?.apiKeyHash || !verifyApiKey(bearer, project.apiKeyHash)) {
      return error(401, { error: "Invalid API key" });
    }
    if (!project.enabled) return error(403, { error: "Project is disabled" });

    const limit = takeRateLimit(publicID, config.apiRateLimitPerMin);
    if (!limit.allowed) {
      set.headers["retry-after"] = String(limit.retryAfterSeconds);
      return error(429, { error: "Rate limit exceeded" });
    }

    const { apiKeyHash, credentialEncrypted, webhookSecretEncrypted, ...safeProject } = project;
    return { project: safeProject };
  });
