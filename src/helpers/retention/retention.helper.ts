import { config } from "../../config";
import db from "../../prisma_client";

const BATCH = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Small batches keep each write lock short so the API and worker keep flowing during cleanup.
const deleteInBatches = async (table: string, where: string, cutoff: number) => {
  let total = 0;
  for (;;) {
    const deleted = await db.$executeRawUnsafe(
      `DELETE FROM "${table}" WHERE "id" IN (SELECT "id" FROM "${table}" WHERE ${where} LIMIT ${BATCH})`,
      cutoff
    );
    total += deleted;
    if (deleted < BATCH) return total;
  }
};

export type RetentionDays = { results: number; jobs: number; audit: number; notifications: number };

// Days come from config unless overridden (the `bun run cleanup --days N` script). 0 = keep forever,
// except results and jobs, which config requires to be at least 1 day.
export const runRetentionCleanupHelper = async (overrides: Partial<RetentionDays> = {}, now = Date.now()) => {
  try {
    const days: RetentionDays = {
      results: config.resultRetentionDays,
      jobs: config.jobRetentionDays,
      audit: config.auditRetentionDays,
      notifications: config.notificationRetentionDays,
      ...overrides,
    };
    const resultsCutoff = now - days.results * DAY_MS;
    const jobsCutoff = now - days.jobs * DAY_MS;

    const removed = {
      tokenResults: await deleteInBatches("TokenResult", `"createdAt" < ?`, resultsCutoff),
      webhookDeliveries: await deleteInBatches("WebhookDelivery", `"createdAt" < ? AND "status" != 'PENDING'`, resultsCutoff),
      jobs: await deleteInBatches("Job", `"finishedAt" < ? AND "status" IN ('COMPLETED', 'FAILED', 'CANCELED')`, jobsCutoff),
      auditLogs: 0,
      notifications: 0,
      idempotencyKeys: 0,
      sessions: 0,
      workers: 0,
    };

    if (days.audit > 0) {
      removed.auditLogs = await deleteInBatches("AuditLog", `"createdAt" < ?`, now - days.audit * DAY_MS);
    }

    if (days.notifications > 0) {
      removed.notifications = await deleteInBatches("Notification", `"finishedAt" < ?`, now - days.notifications * DAY_MS);
    }

    removed.idempotencyKeys = await db.$executeRawUnsafe(
      `UPDATE "Notification" SET "idempotencyKey" = NULL WHERE "idempotencyKey" IS NOT NULL AND "createdAt" < ?`,
      now - DAY_MS
    );
    removed.sessions = (await db.session.deleteMany({ where: { expiresAt: { lt: new Date(now) } } })).count;
    removed.workers = (await db.worker.deleteMany({ where: { lastSeen: { lt: new Date(now - DAY_MS) } } })).count;

    await db.$queryRawUnsafe("PRAGMA incremental_vacuum");
    return removed;
  } catch (error) {
    console.error(error);
    throw error;
  }
};
