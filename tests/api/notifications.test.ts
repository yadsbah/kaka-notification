import { describe, expect, test } from "bun:test";
import db from "../../src/prisma_client";
import { api } from "../helpers/request";
import { fixtures } from "../setup";

const send = (body: unknown, headers?: Record<string, string>, token = fixtures.apiKey) =>
  api("POST", "/api/v1/notifications", { token, body, headers });

const valid = (overrides: Record<string, unknown> = {}) => ({
  tokens: ["token-a", "token-b"],
  notification: { title: "New order", body: "Order #123 received" },
  ...overrides,
});

const tokens = (n: number, prefix = "tok") => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

describe("API authentication", () => {
  test("POST /api/v1/notifications returns 401 without a key", async () => {
    const { status } = await api("POST", "/api/v1/notifications", { body: valid() });
    expect(status).toBe(401);
  });

  test("returns 401 for a malformed key", async () => {
    const { status } = await send(valid(), undefined, "nope");
    expect(status).toBe(401);
  });

  test("returns 401 for a known publicId with the wrong secret", async () => {
    const forged = fixtures.apiKey.slice(0, -4) + "AAAA";
    const { status } = await send(valid(), undefined, forged);
    expect(status).toBe(401);
  });

  test("returns 403 for a disabled project", async () => {
    const { status } = await send(valid(), undefined, fixtures.disabledApiKey);
    expect(status).toBe(403);
  });

  test("returns 409 when the project has no service account yet", async () => {
    const { status } = await send(valid(), undefined, fixtures.noCredentialApiKey);
    expect(status).toBe(409);
  });
});

describe("API Notifications: create", () => {
  test("POST /api/v1/notifications queues without sending, dedupes and trims tokens", async () => {
    const { status, data } = await send(valid({ tokens: [" a ", "a", "b", "b "], externalId: "order-1" }));
    expect(status).toBe(202);
    expect(data).toMatchObject({ status: "queued", totalTokens: 4, uniqueTokens: 2, jobs: 1 });
    expect(data.id).toMatch(/^ntf_[a-f0-9]{32}$/);

    const stored = await db.notification.findUnique({ where: { id: data.id } });
    expect(stored).toMatchObject({ externalID: "order-1", pendingCount: 2, projectID: fixtures.projectId });
    expect(stored!.payload).toEqual({ notification: { title: "New order", body: "Order #123 received" } });
  });

  test("splits into ceil(n / CHUNK_SIZE) jobs in chunk order", async () => {
    const { status, data } = await send(valid({ tokens: tokens(450) }));
    expect(status).toBe(202);
    expect(data.jobs).toBe(3);

    const jobs = await db.job.findMany({ where: { notificationID: data.id }, orderBy: { chunkIndex: "asc" } });
    expect(jobs.map((job) => job.tokenCount)).toEqual([200, 200, 50]);
    expect(jobs.flatMap((job) => job.tokens as string[])).toEqual(tokens(450));
    expect(jobs.every((job) => job.status === "PENDING" && job.attempts === 0)).toBe(true);
  });

  test("accepts data-only messages", async () => {
    const { status } = await send({ tokens: ["x"], data: { orderId: "123" } });
    expect(status).toBe(202);
  });
});

describe("API Notifications: validation", () => {
  const rejects: [string, unknown][] = [
    ["missing tokens", { notification: { title: "t" } }],
    ["empty tokens", valid({ tokens: [] })],
    ["non-string token", valid({ tokens: ["ok", 5] })],
    ["empty-string token", valid({ tokens: [""] })],
    ["whitespace-only token", valid({ tokens: ["   "] })],
    ["neither notification nor data", { tokens: ["x"] }],
    ["notification without title or body", { tokens: ["x"], notification: {} }],
    ["numeric data value", valid({ data: { count: 5 } })],
    ["boolean data value", valid({ data: { flag: true } })],
    ["reserved data key from", valid({ data: { from: "x" } })],
    ["reserved data key google.*", valid({ data: { "google.c.a": "x" } })],
    ["reserved data key gcm.*", valid({ data: { "gcm.n.e": "x" } })],
    ["http imageUrl", valid({ notification: { title: "t", imageUrl: "http://example.com/a.png" } })],
    ["garbage imageUrl", valid({ notification: { title: "t", imageUrl: "not a url" } })],
    ["http webpush link", valid({ webpush: { link: "http://example.com" } })],
    ["negative ttl", valid({ android: { ttlSeconds: -1 } })],
    ["ttl over 28 days", valid({ android: { ttlSeconds: 2_419_201 } })],
    ["bad priority", valid({ android: { priority: "urgent" } })],
    ["message over 4096 bytes", valid({ data: { blob: "x".repeat(4096) } })],
    ["unknown top-level field", valid({ titel: "typo" })],
    ["unknown nested field", valid({ notification: { title: "t", sound: "x" } })],
    ["unknown android field", valid({ android: { prority: "high" } })],
  ];

  for (const [name, body] of rejects) {
    test(`rejects ${name} with 400 and field errors`, async () => {
      const { status, data } = await send(body);
      expect(status).toBe(400);
      expect(data.error).toBeString();
      expect(data.fields.length).toBeGreaterThan(0);
      expect(data.fields[0]).toHaveProperty("path");
    });
  }

  test("accepts ttl and priority at the edges", async () => {
    const { status } = await send(valid({ android: { ttlSeconds: 2_419_200, priority: "normal" } }));
    expect(status).toBe(202);
  });

  test("rejects more than MAX_TOKENS_PER_REQUEST tokens", async () => {
    const { status } = await send(valid({ tokens: tokens(100_001) }));
    expect(status).toBe(400);
  });

  test("rejects bodies over MAX_BODY_SIZE with 413", async () => {
    const { status } = await api("POST", "/api/v1/notifications", {
      token: fixtures.apiKey,
      rawBody: "{}",
      headers: { "content-length": String(11 * 1024 * 1024) },
    });
    expect(status).toBe(413);
  });

  test("rejects invalid JSON with 400", async () => {
    const { status } = await api("POST", "/api/v1/notifications", { token: fixtures.apiKey, rawBody: "{nope" });
    expect(status).toBe(400);
  });

  test("nothing is stored for a rejected request", async () => {
    const before = await db.notification.count();
    await send(valid({ data: { from: "x" } }));
    expect(await db.notification.count()).toBe(before);
  });
});

describe("API Notifications: idempotency", () => {
  test("same key and same body returns the original notification with 200", async () => {
    const headers = { "Idempotency-Key": "idem-same" };
    const first = await send(valid({ data: { a: "1", b: "2" } }), headers);
    const second = await send({ data: { b: "2", a: "1" }, ...valid() }, headers);
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.data.id).toBe(first.data.id);
    expect(await db.notification.count({ where: { idempotencyKey: "idem-same" } })).toBe(1);
  });

  test("same key with a different body returns 409", async () => {
    const headers = { "Idempotency-Key": "idem-diff" };
    await send(valid(), headers);
    const { status } = await send(valid({ tokens: ["other"] }), headers);
    expect(status).toBe(409);
  });

  test("keys are scoped per project", async () => {
    const headers = { "Idempotency-Key": "idem-scope" };
    const mine = await send(valid(), headers);
    const theirs = await send(valid(), headers, fixtures.otherApiKey);
    expect(theirs.status).toBe(202);
    expect(theirs.data.id).not.toBe(mine.data.id);
  });

  test("keys older than 24h are released and can be reused", async () => {
    const headers = { "Idempotency-Key": "idem-old" };
    const first = await send(valid(), headers);
    await db.notification.update({
      where: { id: first.data.id },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    const second = await send(valid({ tokens: ["new"] }), headers);
    expect(second.status).toBe(202);
    expect(second.data.id).not.toBe(first.data.id);
  });
});

describe("API Notifications: read and cancel", () => {
  test("GET /api/v1/notifications/:id returns counts, job summary and error breakdown", async () => {
    const created = await send(valid({ tokens: tokens(250) }));
    const { status, data } = await api("GET", `/api/v1/notifications/${created.data.id}`, { token: fixtures.apiKey });
    expect(status).toBe(200);
    expect(data).toMatchObject({
      status: "queued",
      uniqueTokens: 250,
      pendingCount: 250,
      successCount: 0,
      jobs: { pending: 2, processing: 0, completed: 0, failed: 0, canceled: 0 },
      errors: [],
    });
  });

  test("another project's notification is 404", async () => {
    const created = await send(valid());
    const { status } = await api("GET", `/api/v1/notifications/${created.data.id}`, { token: fixtures.otherApiKey });
    expect(status).toBe(404);
  });

  test("GET /invalid-tokens paginates tokens FCM reported invalid", async () => {
    const created = await send(valid({ tokens: tokens(5, "inv") }));
    await db.tokenResult.createMany({
      data: tokens(5, "inv").map((token, i) => ({
        notificationID: created.data.id,
        token,
        attempt: 1,
        outcome: i < 3 ? ("INVALID" as const) : ("SUCCESS" as const),
        errorCode: i < 3 ? "messaging/registration-token-not-registered" : null,
      })),
    });
    const page = await api("GET", `/api/v1/notifications/${created.data.id}/invalid-tokens`, {
      token: fixtures.apiKey,
      query: { limit: 2, offset: 0 },
    });
    expect(page.status).toBe(200);
    expect(page.data.count).toBe(3);
    expect(page.data.tokens.map((t: { token: string }) => t.token)).toEqual(["inv-0", "inv-1"]);
  });

  test("POST /cancel cancels pending jobs and finalizes as canceled", async () => {
    const created = await send(valid({ tokens: tokens(300) }));
    const { status, data } = await api("POST", `/api/v1/notifications/${created.data.id}/cancel`, { token: fixtures.apiKey });
    expect(status).toBe(200);
    expect(data).toMatchObject({ status: "canceled", canceledJobs: 2, canceledTokens: 300 });

    const stored = await db.notification.findUnique({ where: { id: created.data.id } });
    expect(stored).toMatchObject({ pendingCount: 0, failedCount: 300, status: "CANCELED" });
    expect(stored!.finishedAt).not.toBeNull();
    expect(await db.tokenResult.count({ where: { notificationID: created.data.id, errorCode: "canceled" } })).toBe(300);

    const again = await api("POST", `/api/v1/notifications/${created.data.id}/cancel`, { token: fixtures.apiKey });
    expect(again.status).toBe(409);
  });

  test("cancel leaves in-flight jobs alone", async () => {
    const created = await send(valid({ tokens: tokens(300) }));
    const [first] = await db.job.findMany({ where: { notificationID: created.data.id }, orderBy: { chunkIndex: "asc" } });
    await db.job.update({ where: { id: first!.id }, data: { status: "PROCESSING" } });

    const { data } = await api("POST", `/api/v1/notifications/${created.data.id}/cancel`, { token: fixtures.apiKey });
    expect(data).toMatchObject({ canceledJobs: 1, canceledTokens: 100 });
    const stored = await db.notification.findUnique({ where: { id: created.data.id } });
    expect(stored).toMatchObject({ pendingCount: 200, finishedAt: null });
  });
});

describe("Health", () => {
  test("GET /health reports database, worker and queue depth", async () => {
    const { status, data } = await api("GET", "/health");
    expect(status).toBe(200);
    expect(data).toMatchObject({ status: "ok", database: true, worker: { alive: false } });
    expect(data.queue.pending).toBeGreaterThan(0);
  });
});

describe("Routing", () => {
  test("unknown API paths are JSON 404s, not the dashboard", async () => {
    const { status, data } = await api("GET", "/api/v1/nope");
    expect(status).toBe(404);
    expect(data).toEqual({ error: "Not found" });
  });

  test("dashboard routes fall back to index.html, and traversal is refused", async () => {
    const page = await api("GET", "/projects/prj_123");
    expect(page.status).toBe(200);
    expect(String(page.data)).toContain('<div id="root">');
    const traversal = await api("GET", "/..%2F..%2Fpackage.json");
    expect(String(traversal.data)).not.toContain('"dependencies"');
  });
});
