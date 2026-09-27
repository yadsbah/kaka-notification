import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import db from "../../src/prisma_client";
import { fcmError, installFcmMock, resetFcmMock } from "../helpers/fcm_mock";
import { adminApi, loginAs, type AdminSession } from "../helpers/admin_session";
import { api } from "../helpers/request";
import { fixtures } from "../setup";

let session: AdminSession;
const realKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }) as string;

const serviceAccount = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "service_account",
    project_id: "orders-app-prod",
    private_key_id: "abc",
    private_key: realKey,
    client_email: "firebase-adminsdk@orders-app-prod.iam.gserviceaccount.com",
    ...overrides,
  });

const SECRET_FIELDS = ["credentialEncrypted", "apiKeyHash", "webhookSecretEncrypted", "private_key", "privateKey"];
const expectNoSecrets = (data: unknown) => {
  const text = JSON.stringify(data);
  for (const field of SECRET_FIELDS) expect(text).not.toContain(field);
  expect(text).not.toContain("PRIVATE KEY");
};

const createProject = async (name: string) => (await adminApi(session, "POST", "/projects", { body: { name } })).data;

beforeAll(async () => {
  session = await loginAs(fixtures.adminEmail, fixtures.adminPassword);
});
afterAll(() => resetFcmMock());

describe("Admin projects", () => {
  test("create, list, get, update — never exposing secrets", async () => {
    const created = await createProject("Admin Created");
    expect(created).toMatchObject({ name: "Admin Created", enabled: true, credentialStatus: "MISSING", apiKeyPrefix: null });
    expectNoSecrets(created);

    const list = await adminApi(session, "GET", "/projects", { query: { search: "Admin Created" } });
    expect(list.data.count).toBe(1);
    expect(list.data.projects[0]).toHaveProperty("last24h");
    expectNoSecrets(list.data);

    const updated = await adminApi(session, "PATCH", `/projects/${created.id}`, {
      body: { enabled: false, webhookUrl: "https://example.com/hook" },
    });
    expect(updated.data).toMatchObject({ enabled: false, webhookUrl: "https://example.com/hook" });
    expectNoSecrets((await adminApi(session, "GET", `/projects/${created.id}`)).data);
  });

  test("rejects http webhook URLs", async () => {
    const created = await createProject("Http Hook");
    const { status } = await adminApi(session, "PATCH", `/projects/${created.id}`, { body: { webhookUrl: "http://example.com" } });
    expect(status).toBe(400);
  });

  test("uploading a service account validates it and stores it encrypted", async () => {
    const created = await createProject("Credential App");
    const bad = [
      ["not json", "{nope"],
      ["wrong type", serviceAccount({ type: "authorized_user" })],
      ["missing client_email", serviceAccount({ client_email: undefined })],
      ["broken private key", serviceAccount({ private_key: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n" })],
    ];
    for (const [, file] of bad) {
      const { status, data } = await adminApi(session, "PUT", `/projects/${created.id}/credential`, { body: { serviceAccount: file } });
      expect(status).toBe(400);
      expect(data.fields.length).toBeGreaterThan(0);
    }

    const { status, data } = await adminApi(session, "PUT", `/projects/${created.id}/credential`, {
      body: { serviceAccount: serviceAccount() },
    });
    expect(status).toBe(200);
    expect(data).toMatchObject({
      credentialStatus: "OK",
      firebaseProjectID: "orders-app-prod",
      clientEmail: "firebase-adminsdk@orders-app-prod.iam.gserviceaccount.com",
    });
    expectNoSecrets(data);

    const stored = await db.project.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.credentialEncrypted).toStartWith("v1.");
    expect(stored.credentialEncrypted).not.toContain("PRIVATE KEY");
  });

  test("API key is shown once; rotation invalidates the old key immediately", async () => {
    const created = await createProject("Key App");
    await adminApi(session, "PUT", `/projects/${created.id}/credential`, { body: { serviceAccount: serviceAccount() } });

    const first = await adminApi(session, "POST", `/projects/${created.id}/api-key`);
    expect(first.data.apiKey).toMatch(/^nm_[a-f0-9]{16}_/);
    expect(first.data.project.apiKeyPrefix).toBe(`nm_${first.data.apiKey.split("_")[1]}_…`);
    expect(JSON.stringify((await adminApi(session, "GET", `/projects/${created.id}`)).data)).not.toContain(first.data.apiKey);

    const body = { tokens: ["t"], notification: { title: "x" } };
    expect((await api("POST", "/api/v1/notifications", { token: first.data.apiKey, body })).status).toBe(202);

    const second = await adminApi(session, "POST", `/projects/${created.id}/api-key`);
    expect((await api("POST", "/api/v1/notifications", { token: first.data.apiKey, body })).status).toBe(401);
    expect((await api("POST", "/api/v1/notifications", { token: second.data.apiKey, body })).status).toBe(202);
  });

  test("webhook secret regeneration returns the new secret once", async () => {
    const created = await createProject("Secret App");
    const before = (await db.project.findUniqueOrThrow({ where: { id: created.id } })).webhookSecretEncrypted;
    const { data } = await adminApi(session, "POST", `/projects/${created.id}/webhook-secret`);
    expect(data.webhookSecret).toHaveLength(43);
    expect((await db.project.findUniqueOrThrow({ where: { id: created.id } })).webhookSecretEncrypted).not.toBe(before);
  });

  test("test send reports per-token results and honours dryRun", async () => {
    const calls = installFcmMock((token) => (token === "dead" ? { code: "messaging/registration-token-not-registered" } : { ok: true }));
    const { status, data } = await adminApi(session, "POST", `/projects/${fixtures.projectId}/test-send`, {
      body: { tokens: ["alive", "dead"], title: "Test", dryRun: true },
    });
    expect(status).toBe(200);
    expect(calls.at(-1)).toMatchObject({ dryRun: true, tokens: ["alive", "dead"] });
    expect(data.results).toEqual([
      { token: "alive", success: true, messageId: "projects/x/messages/alive" },
      expect.objectContaining({ token: "dead", success: false, category: "INVALID_TOKEN" }),
    ]);
  });

  test("test send flags a broken credential and clears it once it works again", async () => {
    const created = await createProject("Flag App");
    await adminApi(session, "PUT", `/projects/${created.id}/credential`, { body: { serviceAccount: serviceAccount() } });

    installFcmMock(undefined, { throws: () => fcmError("app/invalid-credential", "invalid_grant") });
    const broken = await adminApi(session, "POST", `/projects/${created.id}/test-send`, {
      body: { tokens: ["a"], title: "t", dryRun: true },
    });
    expect(broken.data.credentialStatus).toBe("ERROR");

    installFcmMock();
    const fixed = await adminApi(session, "POST", `/projects/${created.id}/test-send`, {
      body: { tokens: ["a"], title: "t", dryRun: true },
    });
    expect(fixed.data.credentialStatus).toBe("OK");
  });

  test("test send needs a credential and some content", async () => {
    const created = await createProject("Empty App");
    expect((await adminApi(session, "POST", `/projects/${created.id}/test-send`, { body: { tokens: ["a"], title: "t", dryRun: true } })).status).toBe(409);
    expect((await adminApi(session, "POST", `/projects/${fixtures.projectId}/test-send`, { body: { tokens: ["a"], dryRun: true } })).status).toBe(400);
  });

  test("deleting a project removes its notifications, jobs and results", async () => {
    const created = await createProject("Doomed App");
    await adminApi(session, "PUT", `/projects/${created.id}/credential`, { body: { serviceAccount: serviceAccount() } });
    const { data: keyData } = await adminApi(session, "POST", `/projects/${created.id}/api-key`);
    const sent = await api("POST", "/api/v1/notifications", {
      token: keyData.apiKey,
      body: { tokens: ["a", "b"], notification: { title: "x" } },
    });

    expect((await adminApi(session, "DELETE", `/projects/${created.id}`)).status).toBe(200);
    expect(await db.notification.findUnique({ where: { id: sent.data.id } })).toBeNull();
    expect(await db.job.count({ where: { projectID: created.id } })).toBe(0);
    expect((await adminApi(session, "GET", `/projects/${created.id}`)).status).toBe(404);
  });

  test("admin actions are audited", async () => {
    const created = await createProject("Audited App");
    await adminApi(session, "POST", `/projects/${created.id}/api-key`);
    await adminApi(session, "PUT", `/projects/${created.id}/credential`, { body: { serviceAccount: serviceAccount() } });
    await adminApi(session, "DELETE", `/projects/${created.id}`);

    const { data } = await adminApi(session, "GET", "/audit", { query: { targetID: created.id } });
    expect(data.logs.map((log: { action: string }) => log.action).sort()).toEqual([
      "project.api_key_rotated",
      "project.created",
      "project.credential_replaced",
      "project.deleted",
    ]);
    expect(data.logs[0].Admin.email).toBe(fixtures.adminEmail);
    expectNoSecrets(data);
  });
});
