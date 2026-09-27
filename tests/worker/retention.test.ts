import { describe, expect, test } from "bun:test";
import { runRetentionCleanupHelper } from "../../src/helpers/retention/retention.helper";
import db from "../../src/prisma_client";
import { newID } from "../../src/utils/ids.utils";
import { fixtures } from "../setup";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY);

const seedFinishedNotification = async (ageDays: number, idempotencyKey?: string) => {
  const notification = await db.notification.create({
    data: {
      id: newID("ntf"),
      projectID: fixtures.projectId,
      requestHash: "x",
      payload: {},
      totalTokens: 1,
      uniqueTokens: 1,
      pendingCount: 0,
      successCount: 1,
      status: "COMPLETED",
      idempotencyKey,
      createdAt: daysAgo(ageDays),
      finishedAt: daysAgo(ageDays),
    },
  });
  const job = await db.job.create({
    data: {
      id: newID("job"),
      notificationID: notification.id,
      projectID: fixtures.projectId,
      chunkIndex: 0,
      tokens: ["t"],
      tokenCount: 1,
      maxAttempts: 5,
      status: "COMPLETED",
      runAfter: daysAgo(ageDays),
      finishedAt: daysAgo(ageDays),
    },
  });
  await db.tokenResult.create({
    data: { notificationID: notification.id, jobID: job.id, token: "t", outcome: "SUCCESS", attempt: 1, createdAt: daysAgo(ageDays) },
  });
  return { notification, job };
};

describe("Retention cleanup", () => {
  test("deletes old results and finished jobs, keeps notifications and recent data", async () => {
    const old = await seedFinishedNotification(40, "old-key");
    const middle = await seedFinishedNotification(20);
    const recent = await seedFinishedNotification(1);
    const pendingOld = await db.job.create({
      data: {
        id: newID("job"),
        notificationID: old.notification.id,
        projectID: fixtures.projectId,
        chunkIndex: 1,
        tokens: ["p"],
        tokenCount: 1,
        maxAttempts: 5,
        runAfter: daysAgo(40),
      },
    });

    const removed = await runRetentionCleanupHelper();
    expect(removed.tokenResults).toBeGreaterThanOrEqual(2);
    expect(removed.jobs).toBeGreaterThanOrEqual(1);

    // Results: 14 days
    expect(await db.tokenResult.count({ where: { notificationID: old.notification.id } })).toBe(0);
    expect(await db.tokenResult.count({ where: { notificationID: middle.notification.id } })).toBe(0);
    expect(await db.tokenResult.count({ where: { notificationID: recent.notification.id } })).toBe(1);
    // Jobs: 30 days, finished only
    expect(await db.job.findUnique({ where: { id: old.job.id } })).toBeNull();
    expect(await db.job.findUnique({ where: { id: middle.job.id } })).not.toBeNull();
    expect(await db.job.findUnique({ where: { id: pendingOld.id } })).not.toBeNull();
    // Notifications kept forever by default, counters intact; expired idempotency key released
    const kept = await db.notification.findUniqueOrThrow({ where: { id: old.notification.id } });
    expect(kept).toMatchObject({ successCount: 1, idempotencyKey: null });
  });

  test("clears expired sessions and long-dead workers", async () => {
    const admin = await db.admin.create({ data: { email: "retention@example.com", passwordHash: "x" } });
    await db.session.create({ data: { id: "expired-session", adminID: admin.id, csrfToken: "c", expiresAt: daysAgo(1) } });
    await db.session.create({ data: { id: "live-session", adminID: admin.id, csrfToken: "c", expiresAt: new Date(Date.now() + DAY) } });
    await db.worker.create({ data: { id: "wrk_gone", hostname: "h", pid: 1, lastSeen: daysAgo(3) } });

    await runRetentionCleanupHelper();
    expect(await db.session.findUnique({ where: { id: "expired-session" } })).toBeNull();
    expect(await db.session.findUnique({ where: { id: "live-session" } })).not.toBeNull();
    expect(await db.worker.findUnique({ where: { id: "wrk_gone" } })).toBeNull();
    await db.admin.delete({ where: { id: admin.id } });
  });
});

describe("Retention overrides (bun run cleanup)", () => {
  test("a 7-day override removes week-old results, finished jobs and audit logs; keeps newer ones", async () => {
    const weekOld = await seedFinishedNotification(8);
    const fresh = await seedFinishedNotification(2);
    const admin = await db.admin.create({ data: { email: "audit-retention@example.com", passwordHash: "x" } });
    const oldAudit = await db.auditLog.create({ data: { adminID: admin.id, action: "old", createdAt: daysAgo(8) } });
    const newAudit = await db.auditLog.create({ data: { adminID: admin.id, action: "new", createdAt: daysAgo(2) } });

    const removed = await runRetentionCleanupHelper({ results: 7, jobs: 7, audit: 7 });
    expect(removed.auditLogs).toBeGreaterThanOrEqual(1);

    expect(await db.tokenResult.count({ where: { notificationID: weekOld.notification.id } })).toBe(0);
    expect(await db.job.findUnique({ where: { id: weekOld.job.id } })).toBeNull();
    expect(await db.auditLog.findUnique({ where: { id: oldAudit.id } })).toBeNull();

    expect(await db.tokenResult.count({ where: { notificationID: fresh.notification.id } })).toBe(1);
    expect(await db.job.findUnique({ where: { id: fresh.job.id } })).not.toBeNull();
    expect(await db.auditLog.findUnique({ where: { id: newAudit.id } })).not.toBeNull();
    // Notifications are kept unless asked for.
    expect(await db.notification.findUnique({ where: { id: weekOld.notification.id } })).not.toBeNull();

    await runRetentionCleanupHelper({ results: 7, jobs: 7, audit: 7, notifications: 7 });
    expect(await db.notification.findUnique({ where: { id: weekOld.notification.id } })).toBeNull();
    expect(await db.notification.findUnique({ where: { id: fresh.notification.id } })).not.toBeNull();
  });

  test("audit logs follow AUDIT_RETENTION_DAYS (90) by default", async () => {
    const admin = await db.admin.create({ data: { email: "audit-default@example.com", passwordHash: "x" } });
    const recent = await db.auditLog.create({ data: { adminID: admin.id, action: "month-old", createdAt: daysAgo(30) } });
    const ancient = await db.auditLog.create({ data: { adminID: admin.id, action: "ancient", createdAt: daysAgo(100) } });
    await runRetentionCleanupHelper();
    expect(await db.auditLog.findUnique({ where: { id: recent.id } })).not.toBeNull();
    expect(await db.auditLog.findUnique({ where: { id: ancient.id } })).toBeNull();
  });
});
