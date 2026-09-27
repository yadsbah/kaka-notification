import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import db from "../../src/prisma_client";
import { setFcmSender } from "../../src/services/fcm.service";
import { drainQueue, startWorker } from "../../src/worker/worker";
import { resetFcmMock } from "../helpers/fcm_mock";
import { api } from "../helpers/request";
import { createTestProject } from "../helpers/seed";

// Reproduces the production incident: firebase-admin calls that never settle (wedged HTTP/2 session).
const hangFor = (predicate: (tokens: string[]) => boolean) =>
  setFcmSender(async (_project, message) => {
    if (predicate(message.tokens)) return new Promise(() => {}); // never resolves
    return {
      responses: message.tokens.map((token) => ({ success: true, messageId: `m-${token}` })),
      successCount: message.tokens.length,
      failureCount: 0,
    };
  });

const send = async (apiKey: string, tokens: string[]) => {
  const { status, data } = await api("POST", "/api/v1/notifications", {
    token: apiKey,
    body: { tokens, notification: { title: "t" } },
  });
  expect(status).toBe(202);
  return data.id as string;
};

beforeEach(async () => {
  await db.job.updateMany({ where: { status: { in: ["PENDING", "PROCESSING"] } }, data: { status: "CANCELED" } });
});
afterAll(() => resetFcmMock());

describe("Hung FCM sends", () => {
  test("a send that never answers times out, frees the slot, and retries its tokens", async () => {
    hangFor(() => true);
    const { apiKey } = await createTestProject("Hang Once App");
    const id = await send(apiKey, ["h-1", "h-2"]);

    expect(await drainQueue()).toBe(1); // returns instead of hanging forever

    const [first, retry] = await db.job.findMany({ where: { notificationID: id }, orderBy: { createdAt: "asc" } });
    expect(first).toMatchObject({ status: "COMPLETED", lastErrorCode: "send_timeout" });
    expect(retry).toMatchObject({ status: "PENDING", attempts: 1, tokenCount: 2 });

    hangFor(() => false);
    await db.job.updateMany({ where: { id: retry!.id }, data: { runAfter: new Date(0) } });
    await drainQueue();
    expect(await db.notification.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "COMPLETED", successCount: 2 });
  });

  test("hung sends on every worker slot no longer block the rest of the queue", async () => {
    hangFor((tokens) => tokens[0]!.startsWith("hang"));
    // More hung jobs than WORKER_CONCURRENCY (4), spread over projects so the per-project cap isn't the limit.
    for (let i = 0; i < 3; i++) {
      const { apiKey } = await createTestProject(`Hang App ${i}`);
      await send(apiKey, [`hang-${i}-a`]);
      await send(apiKey, [`hang-${i}-b`]);
    }
    const healthy = await createTestProject("Healthy App");
    const id = await send(healthy.apiKey, ["fine-1"]);

    const worker = await startWorker();
    try {
      const deadline = Date.now() + 5000;
      let status = "QUEUED";
      while (Date.now() < deadline && status !== "COMPLETED") {
        await Bun.sleep(100);
        status = (await db.notification.findUniqueOrThrow({ where: { id } })).status;
      }
      expect(status).toBe("COMPLETED");
      expect(await db.job.count({ where: { lastErrorCode: "send_timeout" } })).toBeGreaterThanOrEqual(4);
    } finally {
      await worker.stop();
    }
  });
});
