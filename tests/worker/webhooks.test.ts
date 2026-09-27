import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import db from "../../src/prisma_client";
import { signWebhook } from "../../src/services/webhook.service";
import { decrypt } from "../../src/utils/crypto.utils";
import { deliverDueWebhooks } from "../../src/worker/webhooks";
import { drainQueue } from "../../src/worker/worker";
import { installFcmMock, resetFcmMock } from "../helpers/fcm_mock";
import { api } from "../helpers/request";
import { createTestProject } from "../helpers/seed";

type Received = { headers: Headers; body: string };
const received: Received[] = [];
let respondWith = 200;

const receiver = Bun.serve({
  port: 0,
  async fetch(request) {
    received.push({ headers: request.headers, body: await request.text() });
    return new Response(respondWith === 200 ? "thanks" : "nope", { status: respondWith });
  },
});
const hookUrl = `http://localhost:${receiver.port}/hook`;

const finishNotification = async (apiKey: string, tokens: string[]) => {
  const { data } = await api("POST", "/api/v1/notifications", {
    token: apiKey,
    body: { tokens, notification: { title: "Hi" } },
  });
  await drainQueue();
  return data.id as string;
};

beforeAll(() => {
  installFcmMock((token) => (token.startsWith("bad") ? { code: "messaging/registration-token-not-registered" } : { ok: true }));
});

beforeEach(async () => {
  received.length = 0;
  respondWith = 200;
  await db.job.updateMany({ where: { status: { in: ["PENDING", "PROCESSING"] } }, data: { status: "CANCELED" } });
  await db.webhookDelivery.updateMany({ where: { status: "PENDING" }, data: { status: "FAILED" } });
});

afterAll(() => {
  receiver.stop(true);
  resetFcmMock();
});

describe("Webhooks", () => {
  test("posts a signed summary with invalid tokens when a notification finishes", async () => {
    const { project, apiKey } = await createTestProject("Webhook App", { webhookUrl: hookUrl });
    const id = await finishNotification(apiKey, ["ok-1", "bad-1", "bad-2"]);
    expect(await deliverDueWebhooks()).toBe(1);

    expect(received).toHaveLength(1);
    const { headers, body } = received[0]!;
    const secret = decrypt((await db.project.findUniqueOrThrow({ where: { id: project.id } })).webhookSecretEncrypted!);
    expect(headers.get("x-signature")).toBe(signWebhook(secret, headers.get("x-timestamp")!, body));

    expect(JSON.parse(body)).toMatchObject({
      event: "notification.finished",
      id,
      projectId: project.id,
      status: "completed",
      successCount: 1,
      invalidCount: 2,
      invalidTokens: ["bad-1", "bad-2"],
      invalidTokensTruncated: false,
    });
    const delivery = await db.webhookDelivery.findFirstOrThrow({ where: { notificationID: id } });
    expect(delivery).toMatchObject({ status: "SUCCEEDED", statusCode: 200, responseSnippet: "thanks", attempt: 1 });
  });

  test("a failing receiver is retried with backoff, 4 attempts total, and never touches the notification", async () => {
    respondWith = 500;
    const { apiKey } = await createTestProject("Flaky Hook App", { webhookUrl: hookUrl });
    const id = await finishNotification(apiKey, ["ok-1"]);

    for (let attempt = 1; attempt <= 5; attempt++) {
      await deliverDueWebhooks();
      await db.webhookDelivery.updateMany({ where: { notificationID: id, status: "PENDING" }, data: { runAfter: new Date(0) } });
    }

    const deliveries = await db.webhookDelivery.findMany({ where: { notificationID: id }, orderBy: { attempt: "asc" } });
    expect(deliveries.map((d) => [d.attempt, d.status, d.statusCode])).toEqual([
      [1, "FAILED", 500],
      [2, "FAILED", 500],
      [3, "FAILED", 500],
      [4, "FAILED", 500],
    ]);
    expect(received).toHaveLength(4);
    expect((await db.notification.findUniqueOrThrow({ where: { id } })).status).toBe("COMPLETED");
  });

  test("the next attempt is scheduled in the future, not immediately", async () => {
    respondWith = 503;
    const { apiKey } = await createTestProject("Later Hook App", { webhookUrl: hookUrl });
    const id = await finishNotification(apiKey, ["ok-1"]);
    await deliverDueWebhooks();
    const next = await db.webhookDelivery.findFirstOrThrow({ where: { notificationID: id, status: "PENDING" } });
    expect(next.attempt).toBe(2);
    expect(next.runAfter.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(await deliverDueWebhooks()).toBe(0);
  });

  test("an unreachable receiver is recorded as a failed attempt", async () => {
    const { apiKey } = await createTestProject("Dead Hook App", { webhookUrl: "http://127.0.0.1:1/hook" });
    const id = await finishNotification(apiKey, ["ok-1"]);
    await deliverDueWebhooks();
    const delivery = await db.webhookDelivery.findFirstOrThrow({ where: { notificationID: id, attempt: 1 } });
    expect(delivery.status).toBe("FAILED");
    expect(delivery.statusCode).toBeNull();
    expect(delivery.responseSnippet).toBeTruthy();
  });

  test("no webhook row for projects without a webhook URL", async () => {
    const { apiKey } = await createTestProject("No Hook App");
    const id = await finishNotification(apiKey, ["ok-1"]);
    expect(await db.webhookDelivery.count({ where: { notificationID: id } })).toBe(0);
  });
});

describe("Example client", () => {
  test("examples/client.ts verifyWebhook accepts the server's signature and rejects tampering", async () => {
    const { verifyWebhook } = await import("../../examples/client");
    const body = JSON.stringify({ id: "ntf_x", status: "completed" });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signWebhook("s3cret", timestamp, body);
    expect(verifyWebhook(body, timestamp, signature, "s3cret")).toBe(true);
    expect(verifyWebhook(body + " ", timestamp, signature, "s3cret")).toBe(false);
    expect(verifyWebhook(body, timestamp, signature, "wrong")).toBe(false);
    expect(verifyWebhook(body, String(Number(timestamp) - 3600), signWebhook("s3cret", String(Number(timestamp) - 3600), body), "s3cret")).toBe(false);
  });
});
