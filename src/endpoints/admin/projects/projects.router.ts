import { CredentialStatus, ErrorCategory, type Project } from "@prisma/client";
import Elysia from "elysia";
import { createAuditLogHelper } from "../../../helpers/audit/audit.helper";
import {
  createProjectHelper,
  deleteProjectHelper,
  getProjectSecretsHelper,
  getProjectsCountHelper,
  getProjectsHelper,
  getProjectsLast24hHelper,
  updateProjectHelper,
} from "../../../helpers/projects/projects.helper";
import {
  adminTestSendSchema,
  adminUploadCredentialSchema,
  createProjectSchema,
  getProjectsSchema,
  projectParamsSchema,
  updateProjectSchema,
} from "../../../models/projects/projects.mo";
import { adminAuther } from "../../../plugins/derives/admin_session.derives";
import { classifyError } from "../../../services/fcm_errors.service";
import { invalidateFcmApp, sendMulticast } from "../../../services/fcm.service";
import { generateApiKey } from "../../../utils/api_key.utils";
import { normalizeTokens } from "../../../utils/chunk.utils";
import { encrypt, randomToken } from "../../../utils/crypto.utils";
import { buildMulticastMessage } from "../../../utils/fcm_message.utils";
import { parseServiceAccount } from "../../../utils/service_account.utils";

type SafeProject = Omit<Project, "credentialEncrypted" | "apiKeyHash" | "webhookSecretEncrypted">;
type Last24h = { notifications: number; success: number; invalid: number; failed: number };

// Never exposes the credential, key hash or webhook secret; the API key only as its public prefix.
const toAdminProject = (project: SafeProject, last24h?: Last24h) => ({
  id: project.id,
  name: project.name,
  enabled: project.enabled,
  firebaseProjectID: project.firebaseProjectID,
  clientEmail: project.clientEmail,
  credentialStatus: project.credentialStatus,
  credentialError: project.credentialError,
  apiKeyPrefix: project.apiKeyPublicID ? `nm_${project.apiKeyPublicID}_…` : null,
  apiKeyCreatedAt: project.apiKeyCreatedAt,
  webhookUrl: project.webhookUrl,
  lastError: project.lastError,
  lastErrorAt: project.lastErrorAt,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  last24h: last24h ?? { notifications: 0, success: 0, invalid: 0, failed: 0 },
});

const adminProjectsRouter = new Elysia({
  tags: ["Admin Projects", "Admin"],
}).group("/projects", (app) =>
  app
    .use(adminAuther)
    .get(
      "/",
      async ({ query }) => {
        const projects = (await getProjectsHelper(query)) ?? [];
        const stats = await getProjectsLast24hHelper(projects.map((project) => project.id));
        return {
          projects: projects.map((project) => toAdminProject(project, stats.get(project.id))),
          count: await getProjectsCountHelper({ ...query, limit: undefined, offset: undefined }),
        };
      },
      { query: getProjectsSchema }
    )
    .post(
      "/",
      async ({ body, admin }) => {
        const project = await createProjectHelper(body);
        await createAuditLogHelper({
          adminID: admin.id,
          action: "project.created",
          targetType: "project",
          targetID: project.id,
          details: { name: project.name },
        });
        return toAdminProject(project);
      },
      { body: createProjectSchema }
    )
    .group(
      "/:id",
      {
        params: projectParamsSchema,
        beforeHandle: async ({ params, error }) => {
          const project = await getProjectsHelper({ id: params.id });
          if (!project) return error(404, { error: "Project not found" });
        },
      },
      (app) =>
        app
          .get("/", async ({ params }) => {
            const project = (await getProjectsHelper({ id: params.id }))![0]!;
            const stats = await getProjectsLast24hHelper([project.id]);
            return toAdminProject(project, stats.get(project.id));
          })
          .patch(
            "/",
            async ({ params, body, admin }) => {
              const project = await updateProjectHelper(params.id, body);
              await createAuditLogHelper({
                adminID: admin.id,
                action: "project.updated",
                targetType: "project",
                targetID: project.id,
                details: body,
              });
              return toAdminProject(project);
            },
            { body: updateProjectSchema }
          )
          .delete("/", async ({ params, admin }) => {
            const project = await deleteProjectHelper(params.id);
            invalidateFcmApp(project.id);
            await createAuditLogHelper({
              adminID: admin.id,
              action: "project.deleted",
              targetType: "project",
              targetID: project.id,
              details: { name: project.name },
            });
            return { id: project.id, deleted: true };
          })
          .put(
            "/credential",
            async ({ params, body, admin, error }) => {
              const parsed = parseServiceAccount(body.serviceAccount);
              if ("errors" in parsed) return error(400, { error: "Invalid service account file", fields: parsed.errors });

              const project = await updateProjectHelper(params.id, {
                credentialEncrypted: encrypt(JSON.stringify(parsed.account)),
                firebaseProjectID: parsed.account.project_id,
                clientEmail: parsed.account.client_email,
                credentialStatus: CredentialStatus.OK,
                credentialError: null,
              });
              invalidateFcmApp(project.id);
              await createAuditLogHelper({
                adminID: admin.id,
                action: "project.credential_replaced",
                targetType: "project",
                targetID: project.id,
                details: { firebaseProjectID: parsed.account.project_id, clientEmail: parsed.account.client_email },
              });
              return toAdminProject(project);
            },
            { body: adminUploadCredentialSchema }
          )
          .post("/api-key", async ({ params, admin }) => {
            // Rotation replaces the hash, so the previous key stops working on its very next request.
            const { key, publicID, hash } = generateApiKey();
            const project = await updateProjectHelper(params.id, {
              apiKeyPublicID: publicID,
              apiKeyHash: hash,
              apiKeyCreatedAt: new Date(),
            });
            await createAuditLogHelper({
              adminID: admin.id,
              action: "project.api_key_rotated",
              targetType: "project",
              targetID: project.id,
              details: { apiKeyPrefix: `nm_${publicID}_…` },
            });
            return { apiKey: key, project: toAdminProject(project) };
          })
          .post("/webhook-secret", async ({ params, admin }) => {
            const secret = randomToken(32);
            const project = await updateProjectHelper(params.id, { webhookSecretEncrypted: encrypt(secret) });
            await createAuditLogHelper({
              adminID: admin.id,
              action: "project.webhook_secret_rotated",
              targetType: "project",
              targetID: project.id,
            });
            return { webhookSecret: secret, project: toAdminProject(project) };
          })
          .post(
            "/test-send",
            async ({ params, body, admin, error }) => {
              const project = (await getProjectSecretsHelper({ id: params.id }))![0]!;
              if (project.credentialStatus === CredentialStatus.MISSING) {
                return error(409, { error: "Upload a service account first" });
              }
              if (!body.title && !body.body) {
                return error(400, { error: "Validation failed", fields: [{ path: "/title", message: "Provide a title or a body" }] });
              }

              const tokens = normalizeTokens(body.tokens).filter((token) => token !== "");
              const message = buildMulticastMessage({ notification: { title: body.title, body: body.body } }, tokens);
              let responses: { success: boolean; messageId?: string; error?: unknown }[];
              try {
                responses = (await sendMulticast(project, message, body.dryRun)).responses;
              } catch (err) {
                responses = tokens.map(() => ({ success: false, error: err }));
              }

              const results = tokens.map((token, i) => {
                const response = responses[i];
                if (response?.success) return { token, success: true, messageId: response.messageId ?? null };
                const classified = classifyError(response?.error);
                return { token, success: false, category: classified.category, code: classified.code, message: classified.message };
              });

              // A test send doubles as a credential check: all-auth-failures flags it, anything else clears a flag.
              const allConfig = results.every((result) => !result.success && result.category === ErrorCategory.CONFIG_ERROR);
              let credentialStatus = project.credentialStatus;
              if (allConfig) {
                credentialStatus = CredentialStatus.ERROR;
                const first = results[0] as { code: string; message: string };
                await updateProjectHelper(project.id, {
                  credentialStatus,
                  credentialError: `${first.code}: ${first.message}`.slice(0, 1000),
                });
              } else if (project.credentialStatus === CredentialStatus.ERROR) {
                credentialStatus = CredentialStatus.OK;
                await updateProjectHelper(project.id, { credentialStatus, credentialError: null });
              }

              await createAuditLogHelper({
                adminID: admin.id,
                action: "project.test_send",
                targetType: "project",
                targetID: project.id,
                details: { dryRun: body.dryRun, tokens: tokens.length, delivered: results.filter((r) => r.success).length },
              });
              return { dryRun: body.dryRun, credentialStatus, results };
            },
            { body: adminTestSendSchema }
          )
    )
);

export default adminProjectsRouter;
