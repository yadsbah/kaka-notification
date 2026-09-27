import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import db from "../../src/prisma_client";
import { drainQueue } from "../../src/worker/worker";
import { adminApi, loginAs, type AdminSession } from "../helpers/admin_session";
import { installFcmMock, resetFcmMock } from "../helpers/fcm_mock";
import { api } from "../helpers/request";
import { createTestProject } from "../helpers/seed";
import { fixtures } from "../setup";

let session: AdminSession;
const longToken = (name: string) => `${name}-${"x".repeat(140)}`;

const send = async (tokens: string[], apiKey = fixtures.apiKey, externalId?: string) => {
  const { data } = await api("POST", "/api/v1/notifications", {
    token: apiKey,
    body: { tokens, notification: { title: "Hi" }, externalId },
  });
  return data.id as string;
};

beforeAll(async () => {
  session = await loginAs(fixtures.adminEmail, fixtures.adminPassword);
});
beforeEach(async () => {
  await db.job.updateMany({ where: { status: { in: ["PENDING", "PROCESSING"] } }, data: { status: "CANCELED" } });
});
afterAll(() => resetFcmMock());

describe("Admin notifications", () => {
  test("list filters by project, status and externalId", async () => {
    const { project, apiKey } = await createTestProject("Listing App");
    installFcmMock();
    const done = await send(["a"], apiKey, "ext-done");
    await drainQueue();
    await send(["b"], apiKey, "ext-queued");

    const byProject = await adminApi(session, "GET", "/notifications", { query: { projectID: project.id } });
    expect(byProject.data.count).toBe(2);
    expect(byProject.data.notifications[0].payload).toBeUndefined();

    const completed = await adminApi(session, "GET", "/notifications", { query: { projectID: project.id, status: "COMPLETED" } });
    expect(completed.data.notifications.map((n: { id: string }) => n.id)).toEqual([done]);

    const byExternal = await adminApi(session, "GET", "/notifications", { query: { externalID: "ext-queued" } });
    expect(byExternal.data.count).toBe(1);
  });

  test("detail has payload, jobs without token arrays, error breakdown and webhook deliveries", async () => {
    installFcmMock((token) => (token.startsWith("bad") ? { code: "messaging/registration-token-not-registered" } : { ok: true }));
    const id = await send(["ok-1", "bad-1", "bad-2"]);
    await drainQueue();
    const { status, data } = await adminApi(session, "GET", `/notifications/${id}`);
    expect(status).toBe(200);
    expect(data.payload).toEqual({ notification: { title: "Hi" } });
    expect(data.jobs).toHaveLength(1);
    expect(data.jobs[0].tokens).toBeUndefined();
    expect(data.jobs[0]).toMatchObject({ status: "COMPLETED", tokenCount: 3, attempts: 1 });
    expect(data.errors).toEqual([
      { code: "messaging/registration-token-not-registered", category: "INVALID_TOKEN", outcome: "INVALID", count: 2 },
    ]);
    expect(data.requestHash).toBeUndefined();
  });

  test("token results are masked in the list and full in the detail", async () => {
    installFcmMock();
    const token = longToken("detail");
    const id = await send([token]);
    await drainQueue();
    const list = await adminApi(session, "GET", `/notifications/${id}/results`, { query: { outcome: "SUCCESS" } });
    expect(list.data.count).toBe(1);
    expect(list.data.results[0].token).toBe(`${token.slice(0, 8)}…`);

    const one = await adminApi(session, "GET", `/notifications/${id}/results/${list.data.results[0].id}`);
    expect(one.data.token).toBe(token);
  });

  test("invalid tokens download as CSV", async () => {
    installFcmMock(() => ({ code: "messaging/invalid-registration-token", message: 'bad "token"' }));
    const id = await send(["dead-1", "dead-2"]);
    await drainQueue();
    const { status, headers, data } = await adminApi(session, "GET", `/notifications/${id}/invalid-tokens.csv`);
    expect(status).toBe(200);
    expect(headers.get("content-type")).toContain("text/csv");
    expect(headers.get("content-disposition")).toContain(`${id}-invalid-tokens.csv`);
    expect(data.split("\n")).toEqual([
      "token,error_code,error_message",
      '"dead-1","messaging/invalid-registration-token","bad ""token"""',
      '"dead-2","messaging/invalid-registration-token","bad ""token"""',
    ]);
  });

  test("retry failed tokens resends only failed ones, never invalid ones", async () => {
    installFcmMock((token) =>
      token.startsWith("bad") ? { code: "messaging/registration-token-not-registered" } : { code: "messaging/third-party-auth-error" }
    );
    const { apiKey, project } = await createTestProject("Retry App");
    const id = await send(["fail-1", "fail-2", "bad-1"], apiKey);
    await drainQueue();
    expect(await db.notification.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "FAILED", failedCount: 2, invalidCount: 1 });

    const retried = await adminApi(session, "POST", `/notifications/${id}/retry-failed`);
    expect(retried.data).toEqual({ tokens: 2, jobs: 1 });
    expect(await db.notification.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "PROCESSING",
      failedCount: 0,
      pendingCount: 2,
      finishedAt: null,
    });

    const calls = installFcmMock();
    await db.project.update({ where: { id: project.id }, data: { credentialStatus: "OK" } });
    await drainQueue();
    expect(calls.at(-1)!.tokens).toEqual(["fail-1", "fail-2"]);
    expect(await db.notification.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "COMPLETED", successCount: 2, invalidCount: 1 });

    expect((await adminApi(session, "POST", `/notifications/${id}/retry-failed`)).status).toBe(409);
    const audit = await adminApi(session, "GET", "/audit", { query: { targetID: id } });
    expect(audit.data.logs[0].action).toBe("notification.retried");
  });

  test("cancel from the dashboard is audited", async () => {
    const id = await send(["c-1"]);
    expect((await adminApi(session, "POST", `/notifications/${id}/cancel`)).data).toMatchObject({ canceledTokens: 1 });
    const audit = await adminApi(session, "GET", "/audit", { query: { targetID: id } });
    expect(audit.data.logs[0].action).toBe("notification.canceled");
  });
});

describe("Admin jobs", () => {
  test("lists jobs by status without token arrays", async () => {
    await send(["q-1"]);
    const { data } = await adminApi(session, "GET", "/jobs", { query: { status: "PENDING" } });
    expect(data.count).toBeGreaterThan(0);
    expect(data.jobs[0].tokens).toBeUndefined();
    expect(data.jobs[0].Project).toHaveProperty("name");
  });

  test("fail a stuck job, then requeue it", async () => {
    const id = await send(["stuck-1", "stuck-2"]);
    const job = await db.job.findFirstOrThrow({ where: { notificationID: id } });
    await db.job.update({ where: { id: job.id }, data: { status: "PROCESSING", lockedBy: "wrk_hung" } });

    const failed = await adminApi(session, "POST", `/jobs/${job.id}/fail`, { body: { reason: "Hung worker" } });
    expect(failed.data).toEqual({ failed: true });
    expect(await db.notification.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "FAILED", failedCount: 2 });
    expect((await adminApi(session, "POST", `/jobs/${job.id}/fail`)).status).toBe(409);

    installFcmMock();
    const requeued = await adminApi(session, "POST", `/jobs/${job.id}/requeue`);
    expect(requeued.data).toEqual({ tokens: 2, jobs: 1 });
    await drainQueue();
    expect(await db.notification.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "COMPLETED", successCount: 2 });
  });

  test("only failed jobs can be requeued", async () => {
    const id = await send(["p-1"]);
    const job = await db.job.findFirstOrThrow({ where: { notificationID: id } });
    expect((await adminApi(session, "POST", `/jobs/${job.id}/requeue`)).status).toBe(409);
  });
});

describe("Admin overview", () => {
  test("shows queue depth, 24h sends, workers, recent errors and credential problems", async () => {
    await createTestProject("Broken Cred App").then(({ project }) =>
      db.project.update({ where: { id: project.id }, data: { credentialStatus: "ERROR", credentialError: "invalid_grant" } })
    );
    const { status, data } = await adminApi(session, "GET", "/overview");
    expect(status).toBe(200);
    expect(data.queue).toHaveProperty("pending");
    expect(data.last24h.success).toBeGreaterThan(0);
    expect(Array.isArray(data.workers)).toBe(true);
    expect(data.recentErrors.length).toBeGreaterThan(0);
    expect(data.credentialProblems.map((p: { name: string }) => p.name)).toContain("Broken Cred App");
  });
});

describe("Admin: send notification from the dashboard", () => {
  test("queues through the normal pipeline and stores results", async () => {
    const calls = installFcmMock((token) => (token === "dead" ? { code: "messaging/registration-token-not-registered" } : { ok: true }));
    const { status, data } = await adminApi(session, "POST", "/notifications", {
      body: {
        projectID: fixtures.projectId,
        tokens: [" live-1", "live-1", "live-2", "dead"],
        notification: { title: "From the dashboard", body: "Hello" },
        data: { source: "admin" },
        android: { priority: "high" },
        externalId: "dash-1",
      },
    });
    expect(status).toBe(200);
    expect(data).toMatchObject({ status: "queued", totalTokens: 4, uniqueTokens: 3, jobs: 1 });
    expect(await db.job.count({ where: { notificationID: data.id, status: "PENDING" } })).toBe(1);

    await drainQueue();
    expect(calls.at(-1)!.tokens).toEqual(["live-1", "live-2", "dead"]);
    const stored = await db.notification.findUniqueOrThrow({ where: { id: data.id } });
    expect(stored).toMatchObject({ projectID: fixtures.projectId, externalID: "dash-1", status: "COMPLETED", successCount: 2, invalidCount: 1 });
    expect(stored.payload).toEqual({ notification: { title: "From the dashboard", body: "Hello" }, data: { source: "admin" }, android: { priority: "high" } });
    expect(await db.tokenResult.count({ where: { notificationID: data.id } })).toBe(3);

    const audit = await adminApi(session, "GET", "/audit", { query: { targetID: data.id } });
    expect(audit.data.logs[0]).toMatchObject({ action: "notification.sent", Admin: { email: fixtures.adminEmail } });
  });

  test("applies the same validation as the public API", async () => {
    const bad = [
      { projectID: fixtures.projectId, tokens: ["x"] },
      { projectID: fixtures.projectId, tokens: ["x"], data: { from: "me" } },
      { projectID: fixtures.projectId, tokens: ["x"], data: { n: 1 } },
      { projectID: fixtures.projectId, tokens: ["x"], notification: { title: "t" }, typo: true },
      { tokens: ["x"], notification: { title: "t" } },
    ];
    for (const body of bad) {
      const { status, data } = await adminApi(session, "POST", "/notifications", { body });
      expect(status).toBe(400);
      expect(data.fields.length).toBeGreaterThan(0);
    }
  });

  test("refuses unknown, disabled and credential-less projects", async () => {
    const body = { tokens: ["x"], notification: { title: "t" } };
    expect((await adminApi(session, "POST", "/notifications", { body: { ...body, projectID: "prj_00000000000000000000000000000000" } })).status).toBe(404);
    const disabled = await createTestProject("Dash Disabled", { enabled: false });
    expect((await adminApi(session, "POST", "/notifications", { body: { ...body, projectID: disabled.project.id } })).status).toBe(409);
    const empty = await createTestProject("Dash No Cred", { credential: false });
    expect((await adminApi(session, "POST", "/notifications", { body: { ...body, projectID: empty.project.id } })).status).toBe(409);
  });

  test("needs the CSRF token", async () => {
    const { status } = await adminApi(session, "POST", "/notifications", {
      body: { projectID: fixtures.projectId, tokens: ["x"], notification: { title: "t" } },
      csrf: false,
    });
    expect(status).toBe(403);
  });
});
