import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import db from "../../src/prisma_client";
import { claimJobHelper, reapExpiredJobsHelper, settleJobHelper } from "../../src/helpers/jobs/jobs.helper";
import { drainQueue } from "../../src/worker/worker";
import { fcmError, installFcmMock, resetFcmMock } from "../helpers/fcm_mock";
import { api } from "../helpers/request";
import { createTestProject } from "../helpers/seed";
import { fixtures } from "../setup";

const tokens = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => `${prefix}-${i}`);

const send = async (tokenList: string[], apiKey = fixtures.apiKey) => {
  const { status, data } = await api("POST", "/api/v1/notifications", {
    token: apiKey,
    body: { tokens: tokenList, notification: { title: "Hi", body: "There" } },
  });
  expect(status).toBe(202);
  return data.id as string;
};

const notification = (id: string) => db.notification.findUniqueOrThrow({ where: { id } });

// Retry jobs are scheduled in the future; pull them forward instead of waiting.
const fastForwardRetries = () => db.job.updateMany({ where: { status: "PENDING" }, data: { runAfter: new Date(0) } });

const expectExactlyOneResultPerToken = async (id: string) => {
  const n = await notification(id);
  const results = await db.tokenResult.count({ where: { notificationID: id } });
  expect(results).toBe(n.uniqueTokens);
  expect(n.successCount + n.invalidCount + n.failedCount + n.pendingCount).toBe(n.uniqueTokens);
  expect(n.pendingCount).toBe(0);
};

beforeEach(async () => {
  // Other test files leave queued jobs behind; park them so each test only drains its own work.
  await db.job.updateMany({ where: { status: { in: ["PENDING", "PROCESSING"] } }, data: { status: "CANCELED" } });
});

afterAll(() => resetFcmMock());

describe("Worker: delivery", () => {
  test("POST → jobs → worker sends → results stored → counters correct", async () => {
    const calls = installFcmMock();
    const id = await send(tokens(450, "ok"));
    expect(await drainQueue()).toBe(3);

    expect(calls.map((call) => call.tokens.length)).toEqual([200, 200, 50]);
    const n = await notification(id);
    expect(n).toMatchObject({ status: "COMPLETED", successCount: 450, invalidCount: 0, failedCount: 0, pendingCount: 0 });
    expect(n.startedAt).not.toBeNull();
    expect(n.finishedAt).not.toBeNull();
    expect(await db.job.count({ where: { notificationID: id, status: "COMPLETED" } })).toBe(3);
    const sample = await db.tokenResult.findFirst({ where: { notificationID: id, token: "ok-7" } });
    expect(sample).toMatchObject({ outcome: "SUCCESS", attempt: 1, messageID: "projects/x/messages/ok-7" });
    await expectExactlyOneResultPerToken(id);
  });

  test("mixed per-token results; invalid tokens count as completed", async () => {
    installFcmMock((token) =>
      token.startsWith("bad") ? { code: "messaging/registration-token-not-registered" } : { ok: true }
    );
    const id = await send([...tokens(3, "ok"), ...tokens(2, "bad")]);
    await drainQueue();
    expect(await notification(id)).toMatchObject({ status: "COMPLETED", successCount: 3, invalidCount: 2, failedCount: 0 });
    await expectExactlyOneResultPerToken(id);
  });

  test("all tokens invalid is still completed, not failed", async () => {
    installFcmMock(() => ({ code: "messaging/invalid-registration-token" }));
    const id = await send(tokens(4, "bad"));
    await drainQueue();
    expect(await notification(id)).toMatchObject({ status: "COMPLETED", invalidCount: 4, successCount: 0 });
  });
});

describe("Worker: retries", () => {
  test("retryable failure → retry job with only the failed tokens → success", async () => {
    const seen = new Set<string>();
    const calls = installFcmMock((token) => {
      if (token.startsWith("flaky") && !seen.has(token)) {
        seen.add(token);
        return { code: "messaging/server-unavailable" };
      }
      return { ok: true };
    });
    const id = await send([...tokens(5, "ok"), ...tokens(3, "flaky")]);
    await drainQueue();

    const retry = await db.job.findFirstOrThrow({ where: { notificationID: id, parentJobID: { not: null } } });
    expect(retry.tokens).toEqual(tokens(3, "flaky"));
    expect(retry).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(retry.runAfter.getTime()).toBeGreaterThan(Date.now() + 20_000);
    expect(await notification(id)).toMatchObject({ status: "PROCESSING", successCount: 5, pendingCount: 3 });

    expect(await drainQueue()).toBe(0); // not due yet
    await fastForwardRetries();
    expect(await drainQueue()).toBe(1);

    expect(calls.at(-1)!.tokens).toEqual(tokens(3, "flaky"));
    expect(await notification(id)).toMatchObject({ status: "COMPLETED", successCount: 8 });
    const flaky = await db.tokenResult.findFirstOrThrow({ where: { notificationID: id, token: "flaky-0" } });
    expect(flaky.attempt).toBe(2);
    await expectExactlyOneResultPerToken(id);
  });

  test("after MAX_ATTEMPTS the tokens are marked failed", async () => {
    installFcmMock(() => ({ code: "messaging/message-rate-exceeded" }));
    const id = await send(tokens(2, "slow"));
    for (let i = 0; i < 6; i++) {
      await fastForwardRetries();
      await drainQueue();
    }
    expect(await db.job.count({ where: { notificationID: id } })).toBe(5);
    expect(await notification(id)).toMatchObject({ status: "FAILED", failedCount: 2, successCount: 0 });
    const result = await db.tokenResult.findFirstOrThrow({ where: { notificationID: id } });
    expect(result).toMatchObject({ outcome: "FAILED", errorCategory: "RETRYABLE", attempt: 5, errorCode: "messaging/message-rate-exceeded" });
    await expectExactlyOneResultPerToken(id);
  });

  test("some delivered and some exhausted → partially_failed", async () => {
    installFcmMock((token) => (token.startsWith("down") ? { code: "messaging/internal-error" } : { ok: true }));
    const id = await send([...tokens(3, "ok"), ...tokens(1, "down")]);
    for (let i = 0; i < 6; i++) {
      await fastForwardRetries();
      await drainQueue();
    }
    expect(await notification(id)).toMatchObject({ status: "PARTIALLY_FAILED", successCount: 3, failedCount: 1 });
  });

  test("unknown errors are retried like retryable ones", async () => {
    let first = true;
    installFcmMock(() => {
      if (first) {
        first = false;
        return { code: "messaging/unknown-error" };
      }
      return { ok: true };
    });
    const id = await send(["only"]);
    await drainQueue();
    await fastForwardRetries();
    await drainQueue();
    expect(await notification(id)).toMatchObject({ status: "COMPLETED", successCount: 1 });
  });

  test("a thrown sendEachForMulticast (ECONNRESET) retries the whole job", async () => {
    let fail = true;
    installFcmMock(undefined, {
      throws: () => {
        if (!fail) return undefined;
        fail = false;
        return Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
      },
    });
    const id = await send(tokens(4, "net"));
    await drainQueue();
    const retry = await db.job.findFirstOrThrow({ where: { notificationID: id, parentJobID: { not: null } } });
    expect(retry.tokenCount).toBe(4);
    await fastForwardRetries();
    await drainQueue();
    expect(await notification(id)).toMatchObject({ status: "COMPLETED", successCount: 4 });
  });
});

describe("Worker: config and payload errors", () => {
  test("config_error on every token pauses the project; its other jobs wait", async () => {
    const { project, apiKey } = await createTestProject("Paused App");
    installFcmMock(() => ({ code: "messaging/third-party-auth-error", message: "APNs certificate rejected" }));
    const first = await send(tokens(2, "cfg"), apiKey);
    const second = await send(tokens(2, "cfg2"), apiKey);

    expect(await drainQueue()).toBe(1);
    const paused = await db.project.findUniqueOrThrow({ where: { id: project.id } });
    expect(paused.credentialStatus).toBe("ERROR");
    expect(paused.credentialError).toContain("third-party-auth-error");
    expect(await notification(first)).toMatchObject({ status: "FAILED", failedCount: 2 });
    expect(await db.job.findFirst({ where: { notificationID: first } })).toMatchObject({ status: "FAILED", attempts: 1 });

    // Paused: not claimed, attempts untouched.
    expect(await drainQueue()).toBe(0);
    const waiting = await db.job.findFirstOrThrow({ where: { notificationID: second } });
    expect(waiting).toMatchObject({ status: "PENDING", attempts: 0 });

    // Fixing the credential resumes it.
    installFcmMock();
    await db.project.update({ where: { id: project.id }, data: { credentialStatus: "OK", credentialError: null } });
    expect(await drainQueue()).toBe(1);
    expect(await notification(second)).toMatchObject({ status: "COMPLETED", successCount: 2 });
  });

  test("a credential failure thrown by firebase-admin pauses the project", async () => {
    const { project, apiKey } = await createTestProject("Revoked App");
    installFcmMock(undefined, { throws: () => fcmError("app/invalid-credential", "invalid_grant: account not found") });
    await send(["x"], apiKey);
    await drainQueue();
    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).credentialStatus).toBe("ERROR");
  });

  test("config_error on some tokens fails only those tokens and does not pause", async () => {
    const { project, apiKey } = await createTestProject("Mixed Sender App");
    installFcmMock((token) => (token === "foreign" ? { code: "messaging/mismatched-credential", message: "SenderId mismatch" } : { ok: true }));
    const id = await send(["mine-1", "mine-2", "foreign"], apiKey);
    await drainQueue();
    expect((await db.project.findUniqueOrThrow({ where: { id: project.id } })).credentialStatus).toBe("OK");
    expect(await notification(id)).toMatchObject({ status: "PARTIALLY_FAILED", successCount: 2, failedCount: 1, invalidCount: 0 });
    const foreign = await db.tokenResult.findFirstOrThrow({ where: { notificationID: id, token: "foreign" } });
    expect(foreign).toMatchObject({ outcome: "FAILED", errorCategory: "CONFIG_ERROR" });
  });

  test("payload_error fails the whole notification, including jobs not yet sent", async () => {
    const calls = installFcmMock(() => ({ code: "messaging/invalid-argument", message: "Invalid JSON payload received" }));
    const id = await send(tokens(450, "pl"));
    expect(await drainQueue()).toBe(1);
    expect(calls).toHaveLength(1);
    expect(await notification(id)).toMatchObject({ status: "FAILED", failedCount: 450, pendingCount: 0 });
    expect(await db.job.count({ where: { notificationID: id, status: "FAILED" } })).toBe(3);
    expect(await db.tokenResult.count({ where: { notificationID: id, errorCategory: "PAYLOAD_ERROR" } })).toBe(450);
    await expectExactlyOneResultPerToken(id);
  });
});

describe("Worker: leases, fairness, cancel", () => {
  test("the reaper recovers a stuck job with backoff", async () => {
    installFcmMock();
    const id = await send(["stuck"]);
    const job = (await claimJobHelper("wrk_crashed"))!;
    expect(job.status).toBe("PROCESSING");
    await db.job.update({ where: { id: job.id }, data: { lockedUntil: new Date(Date.now() - 1000) } });

    expect(await reapExpiredJobsHelper()).toEqual({ requeued: 1, failed: 0 });
    const requeued = await db.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(requeued).toMatchObject({ status: "PENDING", attempts: 1, lockedBy: null, lastErrorCode: "lease_expired" });
    expect(requeued.runAfter.getTime()).toBeGreaterThan(Date.now());

    // The crashed worker waking up late can't settle a job it no longer owns.
    const late = await settleJobHelper(job, "wrk_crashed", 10, { finals: [], jobStatus: "COMPLETED" });
    expect(late.settled).toBe(false);

    await fastForwardRetries();
    await drainQueue();
    expect(await notification(id)).toMatchObject({ status: "COMPLETED", successCount: 1 });
    await expectExactlyOneResultPerToken(id);
  });

  test("the reaper fails a stuck job on its last attempt with lease_expired", async () => {
    const id = await send(["dead"]);
    const job = (await claimJobHelper("wrk_crashed"))!;
    await db.job.update({
      where: { id: job.id },
      data: { attempts: job.maxAttempts, lockedUntil: new Date(Date.now() - 1000) },
    });
    expect(await reapExpiredJobsHelper()).toEqual({ requeued: 0, failed: 1 });
    expect(await notification(id)).toMatchObject({ status: "FAILED", failedCount: 1, pendingCount: 0 });
    const result = await db.tokenResult.findFirstOrThrow({ where: { notificationID: id } });
    expect(result.errorCode).toBe("lease_expired");
  });

  test("per-project concurrency cap lets other projects through", async () => {
    const big = await createTestProject("Big App");
    const small = await createTestProject("Small App");
    await send(tokens(600, "big"), big.apiKey); // 3 jobs
    await send(["small"], small.apiKey); // created later
    const claimed = [await claimJobHelper("w1"), await claimJobHelper("w1"), await claimJobHelper("w1")];
    expect(claimed.map((job) => job?.projectID)).toEqual([big.project.id, big.project.id, small.project.id]);
    expect(await claimJobHelper("w1")).toBeNull(); // big is capped at 2 in flight
  });

  test("disabled projects' jobs are not claimed", async () => {
    const { project, apiKey } = await createTestProject("Soon Disabled");
    await send(["x"], apiKey);
    await db.project.update({ where: { id: project.id }, data: { enabled: false } });
    expect(await drainQueue()).toBe(0);
  });

  test("cancel while a job is in flight: the job finishes and the notification ends canceled", async () => {
    installFcmMock();
    const id = await send(tokens(300, "cx"));
    const job = (await claimJobHelper("w-cancel"))!;
    const cancel = await api("POST", `/api/v1/notifications/${id}/cancel`, { token: fixtures.apiKey });
    expect(cancel.data).toMatchObject({ canceledJobs: 1, canceledTokens: 100 });

    const { processJob } = await import("../../src/worker/process_job");
    await processJob(job, "w-cancel");
    expect(await notification(id)).toMatchObject({ status: "CANCELED", successCount: 200, failedCount: 100, pendingCount: 0 });
    await expectExactlyOneResultPerToken(id);
  });

  test("a final status queues a webhook delivery when the project has a webhook", async () => {
    installFcmMock();
    const { apiKey } = await createTestProject("Hooked App", { webhookUrl: "https://example.com/hook" });
    const id = await send(["w"], apiKey);
    await drainQueue();
    expect(await db.webhookDelivery.count({ where: { notificationID: id, status: "PENDING", attempt: 1 } })).toBe(1);
  });
});
