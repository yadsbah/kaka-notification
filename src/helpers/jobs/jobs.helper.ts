import { CredentialStatus, ErrorCategory, JobStatus, NotificationStatus, TokenOutcome, type Job, type Prisma } from "@prisma/client";
import { config } from "../../config";
import type { GetJobsSchema } from "../../models/jobs/jobs.mo";
import db from "../../prisma_client";
import { retryDelayMs } from "../../utils/backoff.utils";
import { chunkTokens } from "../../utils/chunk.utils";
import { newID } from "../../utils/ids.utils";
import { failPendingJobsHelper, finalizeNotificationIfDoneHelper } from "../notifications/notifications.helper";

const jobInclude = {
  Project: { select: { id: true, name: true } },
} satisfies Prisma.JobInclude;

const buildJobsWhere = (params: GetJobsSchema & { parentJobID?: null }): Prisma.JobWhereInput => ({
  id: { equals: params.id, in: params.ids },
  notificationID: { equals: params.notificationID },
  projectID: { equals: params.projectID },
  status: { equals: params.status },
  parentJobID: params.retriesOnly ? { not: null } : params.parentJobID === null ? null : undefined,
});

export const getJobsHelper = async (params: GetJobsSchema) => {
  try {
    const jobs = await db.job.findMany({
      where: buildJobsWhere(params),
      include: jobInclude,
      take: params.limit === 0 ? undefined : params.limit,
      skip: params.offset,
      orderBy: [{ createdAt: "desc" }, { chunkIndex: "asc" }, { id: "desc" }],
    });
    if (jobs.length === 0) return null;
    return jobs;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getJobsCountHelper = async (params: GetJobsSchema & { parentJobID?: null }) => {
  try {
    const count = await db.job.count({ where: buildJobsWhere(params), select: { id: true } });
    return count.id;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getQueueDepthHelper = async () => {
  try {
    const groups = await db.job.groupBy({
      by: ["status"],
      where: { status: { in: [JobStatus.PENDING, JobStatus.PROCESSING] } },
      _count: { _all: true },
    });
    const count = (status: JobStatus) => groups.find((group) => group.status === status)?._count._all ?? 0;
    return { pending: count(JobStatus.PENDING), processing: count(JobStatus.PROCESSING) };
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export type TokenFinal = {
  token: string;
  outcome: TokenOutcome;
  category?: ErrorCategory;
  code?: string;
  message?: string;
  messageID?: string;
};

export type JobOutcome = {
  finals: TokenFinal[];
  retry?: { tokens: string[]; runAfter: Date };
  jobStatus: typeof JobStatus.COMPLETED | typeof JobStatus.FAILED;
  lastError?: { code: string; message: string };
  pauseProject?: { code: string; message: string };
  failNotification?: { code: string; message: string };
};

// Atomically claims the next runnable job. Skips disabled projects, projects paused by a credential
// problem, and projects already at PROJECT_CONCURRENCY in-flight jobs so one big send can't starve others.
export const claimJobHelper = async (workerID: string) => {
  try {
    const now = Date.now();
    const claimed = await db.$queryRaw<{ id: string }[]>`
      UPDATE "Job" SET "status" = 'PROCESSING', "lockedBy" = ${workerID},
        "lockedUntil" = ${now + config.leaseSeconds * 1000}, "attempts" = "attempts" + 1,
        "startedAt" = ${now}, "updatedAt" = ${now}
      WHERE "id" = (
        SELECT j."id" FROM "Job" j JOIN "Project" p ON p."id" = j."projectID"
        WHERE j."status" = 'PENDING' AND j."runAfter" <= ${now}
          AND p."enabled" = 1 AND p."credentialStatus" = 'OK'
          AND (SELECT COUNT(*) FROM "Job" r WHERE r."projectID" = j."projectID" AND r."status" = 'PROCESSING')
            < ${config.projectConcurrency}
        ORDER BY j."priority" DESC, j."createdAt" ASC, j."id" ASC
        LIMIT 1
      ) AND "status" = 'PENDING'
      RETURNING "id"`;
    if (claimed.length === 0) return null;
    return await db.job.findUnique({ where: { id: claimed[0]!.id } });
  } catch (error) {
    console.error(error);
    throw error;
  }
};

type SettlingJob = Pick<Job, "id" | "notificationID" | "projectID" | "attempts" | "maxAttempts" | "chunkIndex" | "priority">;

// Writes final token results, counters, the retry job and project flags, then finalizes. Runs inside the
// caller's transaction, after the caller proved it still owns the job.
const applyJobOutcome = async (tx: Prisma.TransactionClient, job: SettlingJob, outcome: JobOutcome) => {
  const count = (outcome_: TokenOutcome) => outcome.finals.filter((final) => final.outcome === outcome_).length;

  if (outcome.finals.length > 0) {
    await tx.tokenResult.createMany({
      data: outcome.finals.map((final) => ({
        jobID: job.id,
        notificationID: job.notificationID,
        token: final.token,
        outcome: final.outcome,
        errorCategory: final.category,
        errorCode: final.code,
        errorMessage: final.message,
        messageID: final.messageID,
        attempt: job.attempts,
      })),
    });
  }
  await tx.notification.update({
    where: { id: job.notificationID },
    data: {
      successCount: { increment: count(TokenOutcome.SUCCESS) },
      invalidCount: { increment: count(TokenOutcome.INVALID) },
      failedCount: { increment: count(TokenOutcome.FAILED) },
      pendingCount: { decrement: outcome.finals.length },
    },
  });

  if (outcome.retry) {
    await tx.job.create({
      data: {
        id: newID("job"),
        notificationID: job.notificationID,
        projectID: job.projectID,
        parentJobID: job.id,
        chunkIndex: job.chunkIndex,
        priority: job.priority,
        tokens: outcome.retry.tokens,
        tokenCount: outcome.retry.tokens.length,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        runAfter: outcome.retry.runAfter,
      },
    });
  }

  if (outcome.lastError) {
    await tx.project.update({
      where: { id: job.projectID },
      data: {
        lastError: `${outcome.lastError.code}: ${outcome.lastError.message}`.slice(0, 1000),
        lastErrorAt: new Date(),
        ...(outcome.pauseProject && {
          credentialStatus: CredentialStatus.ERROR,
          credentialError: `${outcome.pauseProject.code}: ${outcome.pauseProject.message}`.slice(0, 1000),
        }),
      },
    });
  }

  if (outcome.failNotification) {
    await failPendingJobsHelper(tx, job.notificationID, {
      category: ErrorCategory.PAYLOAD_ERROR,
      ...outcome.failNotification,
    });
  }

  return finalizeNotificationIfDoneHelper(tx, job.notificationID);
};

// Returns false when the lease was lost (reaper requeued the job): the results are dropped and the unique
// (notificationID, token) index keeps any later attempt from double-counting.
export const settleJobHelper = async (job: SettlingJob, workerID: string, durationMs: number, outcome: JobOutcome) => {
  try {
    return await db.$transaction(async (tx) => {
      const owned = await tx.job.updateMany({
        where: { id: job.id, status: JobStatus.PROCESSING, lockedBy: workerID },
        data: {
          status: outcome.jobStatus,
          finishedAt: new Date(),
          durationMs,
          lockedUntil: null,
          lastErrorCode: outcome.lastError?.code ?? null,
          lastErrorMessage: outcome.lastError?.message ?? null,
        },
      });
      if (owned.count === 0) return { settled: false as const };
      const finalStatus = await applyJobOutcome(tx, job, outcome);
      return { settled: true as const, finalStatus };
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
};

// Jobs whose lease ran out (worker crashed or hung) go back to PENDING with backoff, or fail with
// lease_expired once they've used every attempt.
export const reapExpiredJobsHelper = async () => {
  try {
    const now = new Date();
    const expired = await db.job.findMany({
      where: { status: JobStatus.PROCESSING, lockedUntil: { lt: now } },
    });
    const stale = { status: JobStatus.PROCESSING, lockedUntil: { lt: now } };
    let requeued = 0;
    let failed = 0;

    for (const job of expired) {
      if (job.attempts < job.maxAttempts) {
        const updated = await db.job.updateMany({
          where: { id: job.id, ...stale },
          data: {
            status: JobStatus.PENDING,
            lockedBy: null,
            lockedUntil: null,
            runAfter: new Date(now.getTime() + retryDelayMs(job.attempts, config.retryBackoffSeconds)),
            lastErrorCode: "lease_expired",
            lastErrorMessage: `Worker ${job.lockedBy} did not finish within ${config.leaseSeconds}s`,
          },
        });
        requeued += updated.count;
        continue;
      }

      const message = `Lease expired on the final attempt (${job.attempts}/${job.maxAttempts})`;
      await db.$transaction(async (tx) => {
        const owned = await tx.job.updateMany({
          where: { id: job.id, ...stale },
          data: { status: JobStatus.FAILED, finishedAt: now, lockedUntil: null, lastErrorCode: "lease_expired", lastErrorMessage: message },
        });
        if (owned.count === 0) return;
        failed++;
        await applyJobOutcome(tx, job, {
          jobStatus: JobStatus.FAILED,
          finals: (job.tokens as string[]).map((token) => ({
            token,
            outcome: TokenOutcome.FAILED,
            category: ErrorCategory.RETRYABLE,
            code: "lease_expired",
            message,
          })),
        });
      });
    }
    return { requeued, failed };
  } catch (error) {
    console.error(error);
    throw error;
  }
};

// Admin action for a stuck job: fail it now (pending or processing) and record its tokens as failed.
// A worker still holding it will lose the settle guard and drop its results.
export const failJobManuallyHelper = async (jobID: string, reason: string) => {
  try {
    return await db.$transaction(async (tx) => {
      const job = await tx.job.findUnique({ where: { id: jobID } });
      if (!job) return { failed: false as const };
      const owned = await tx.job.updateMany({
        where: { id: jobID, status: { in: [JobStatus.PENDING, JobStatus.PROCESSING] } },
        data: { status: JobStatus.FAILED, finishedAt: new Date(), lockedUntil: null, lastErrorCode: "manually_failed", lastErrorMessage: reason },
      });
      if (owned.count === 0) return { failed: false as const };
      await applyJobOutcome(tx, job, {
        jobStatus: JobStatus.FAILED,
        finals: (job.tokens as string[]).map((token) => ({
          token,
          outcome: TokenOutcome.FAILED,
          category: ErrorCategory.UNKNOWN,
          code: "manually_failed",
          message: reason,
        })),
      });
      return { failed: true as const };
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
};

// Re-sends tokens that ended FAILED (never INVALID): their results are removed, counters reopened, and
// fresh jobs created. Scoped to one job when jobID is given (the "requeue failed job" action).
export const retryFailedTokensHelper = async (params: { notificationID: string; jobID?: string }) => {
  try {
    return await db.$transaction(async (tx) => {
      const failed = await tx.tokenResult.findMany({
        where: { notificationID: params.notificationID, outcome: TokenOutcome.FAILED, jobID: params.jobID },
        select: { id: true, token: true },
        orderBy: { id: "asc" },
      });
      if (failed.length === 0) return { tokens: 0, jobs: 0 };
      const { projectID } = await tx.notification.findUniqueOrThrow({
        where: { id: params.notificationID },
        select: { projectID: true },
      });

      await tx.tokenResult.deleteMany({ where: { id: { in: failed.map((result) => result.id) } } });
      const chunks = chunkTokens(failed.map((result) => result.token), config.chunkSize);
      const now = new Date();
      await tx.job.createMany({
        data: chunks.map((tokens, chunkIndex) => ({
          id: newID("job"),
          notificationID: params.notificationID,
          projectID,
          parentJobID: params.jobID ?? null,
          chunkIndex,
          tokens,
          tokenCount: tokens.length,
          maxAttempts: config.maxAttempts,
          runAfter: now,
        })),
      });
      await tx.notification.update({
        where: { id: params.notificationID },
        data: {
          status: NotificationStatus.PROCESSING,
          finishedAt: null,
          failedCount: { decrement: failed.length },
          pendingCount: { increment: failed.length },
        },
      });
      return { tokens: failed.length, jobs: chunks.length };
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
};
