import {
  ErrorCategory,
  JobStatus,
  NotificationStatus,
  TokenOutcome,
  type Prisma,
} from "@prisma/client";
import { config } from "../../config";
import type {
  GetNotificationsSchema,
  GetTokenResultsSchema,
  NotificationPayload,
} from "../../models/notifications/notifications.mo";
import db from "../../prisma_client";
import { chunkTokens } from "../../utils/chunk.utils";
import { newID } from "../../utils/ids.utils";

const notificationInclude = {
  Project: { select: { id: true, name: true } },
} satisfies Prisma.NotificationInclude;

type NotificationsFilter = GetNotificationsSchema & { idempotencyKey?: string };

const buildNotificationsWhere = (params: NotificationsFilter): Prisma.NotificationWhereInput => ({
  id: { equals: params.id, in: params.ids },
  projectID: { equals: params.projectID },
  status: { equals: params.status },
  externalID: { equals: params.externalID },
  idempotencyKey: { equals: params.idempotencyKey },
  createdAt: {
    gte: params.createdFrom ? new Date(params.createdFrom) : undefined,
    lte: params.createdTo ? new Date(params.createdTo) : undefined,
  },
});

const buildTokenResultsWhere = (params: GetTokenResultsSchema): Prisma.TokenResultWhereInput => ({
  notificationID: { equals: params.notificationID },
  outcome: { equals: params.outcome },
  errorCode: { equals: params.errorCode },
  token: { contains: params.search },
});

export const createNotificationHelper = async (params: {
  projectID: string;
  payload: NotificationPayload;
  externalID?: string;
  idempotencyKey?: string;
  requestHash: string;
  totalTokens: number;
  tokens: string[];
}) => {
  try {
    const chunks = chunkTokens(params.tokens, config.chunkSize);
    const createdAt = new Date();
    const notification = await db.$transaction(async (tx) => {
      const created = await tx.notification.create({
        data: {
          id: newID("ntf"),
          projectID: params.projectID,
          externalID: params.externalID,
          idempotencyKey: params.idempotencyKey,
          requestHash: params.requestHash,
          payload: params.payload,
          totalTokens: params.totalTokens,
          uniqueTokens: params.tokens.length,
          pendingCount: params.tokens.length,
        },
        include: notificationInclude,
      });
      await tx.job.createMany({
        data: chunks.map((tokens, chunkIndex) => ({
          id: newID("job"),
          notificationID: created.id,
          projectID: params.projectID,
          chunkIndex,
          tokens,
          tokenCount: tokens.length,
          maxAttempts: config.maxAttempts,
          runAfter: createdAt,
        })),
      });
      return created;
    });
    return { notification, jobs: chunks.length };
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getNotificationsHelper = async (params: NotificationsFilter) => {
  try {
    const notifications = await db.notification.findMany({
      where: buildNotificationsWhere(params),
      include: notificationInclude,
      take: params.limit === 0 ? undefined : params.limit,
      skip: params.offset,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (notifications.length === 0) return null;
    return notifications;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getNotificationsCountHelper = async (params: NotificationsFilter) => {
  try {
    const count = await db.notification.count({
      where: buildNotificationsWhere(params),
      select: { id: true },
    });
    return count.id;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

// Keys are only honoured for 24h; after that the key is released so it can be reused.
export const releaseIdempotencyKeyHelper = async (id: string) => {
  try {
    await db.notification.update({ where: { id }, data: { idempotencyKey: null } });
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getNotificationJobSummaryHelper = async (notificationID: string) => {
  try {
    const groups = await db.job.groupBy({
      by: ["status"],
      where: { notificationID },
      _count: { _all: true },
    });
    return Object.fromEntries(
      Object.values(JobStatus).map((status) => [
        status.toLowerCase(),
        groups.find((group) => group.status === status)?._count._all ?? 0,
      ])
    ) as Record<Lowercase<JobStatus>, number>;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getNotificationErrorBreakdownHelper = async (notificationID: string) => {
  try {
    const groups = await db.tokenResult.groupBy({
      by: ["errorCode", "errorCategory", "outcome"],
      where: { notificationID, outcome: { not: TokenOutcome.SUCCESS } },
      _count: { _all: true },
    });
    return groups
      .map((group) => ({
        code: group.errorCode,
        category: group.errorCategory,
        outcome: group.outcome,
        count: group._count._all,
      }))
      .sort((a, b) => b.count - a.count);
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getTokenResultsHelper = async (params: GetTokenResultsSchema) => {
  try {
    const results = await db.tokenResult.findMany({
      where: buildTokenResultsWhere(params),
      take: params.limit === 0 ? undefined : params.limit,
      skip: params.offset,
      orderBy: [{ id: "asc" }],
    });
    if (results.length === 0) return null;
    return results;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getTokenResultsCountHelper = async (params: GetTokenResultsSchema) => {
  try {
    const count = await db.tokenResult.count({
      where: buildTokenResultsWhere(params),
      select: { id: true },
    });
    return count.id;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

// Sets the final status once no token is pending. Must run inside the same transaction as the
// counter update that may have brought pendingCount to zero. Returns the new status, or null.
export const finalizeNotificationIfDoneHelper = async (tx: Prisma.TransactionClient, notificationID: string) => {
  const notification = await tx.notification.findUnique({
    where: { id: notificationID },
    include: { Project: { select: { webhookUrl: true } } },
  });
  if (!notification || notification.finishedAt || notification.pendingCount > 0) return null;

  const active = await tx.job.count({
    where: { notificationID, status: { in: [JobStatus.PENDING, JobStatus.PROCESSING] } },
  });
  if (active > 0) return null;

  const status =
    notification.status === NotificationStatus.CANCELED
      ? NotificationStatus.CANCELED
      : notification.failedCount === 0
        ? NotificationStatus.COMPLETED
        : notification.successCount === 0
          ? NotificationStatus.FAILED
          : NotificationStatus.PARTIALLY_FAILED;

  await tx.notification.update({
    where: { id: notificationID },
    data: { status, finishedAt: new Date() },
  });
  if (notification.Project.webhookUrl) {
    await tx.webhookDelivery.create({ data: { notificationID, attempt: 1, runAfter: new Date() } });
  }
  return status;
};

// Pending jobs are flipped in one UPDATE ... RETURNING so a worker can't claim one halfway through.
// Their tokens get a final FAILED result with the given reason. Must run inside a transaction.
export const failPendingJobsHelper = async (
  tx: Prisma.TransactionClient,
  notificationID: string,
  reason: { category: ErrorCategory; code: string; message: string }
) => {
  const now = Date.now();
  const failed = await tx.$queryRaw<{ id: string; tokens: string[]; attempts: number }[]>`
    UPDATE "Job" SET "status" = ${reason.category === ErrorCategory.CANCELED ? "CANCELED" : "FAILED"},
      "finishedAt" = ${now}, "updatedAt" = ${now},
      "lastErrorCode" = ${reason.code}, "lastErrorMessage" = ${reason.message}
    WHERE "notificationID" = ${notificationID} AND "status" = 'PENDING'
    RETURNING "id", "tokens", "attempts"`;

  const results = failed.flatMap((job) =>
    job.tokens.map((token) => ({
      jobID: job.id,
      notificationID,
      outcome: TokenOutcome.FAILED,
      errorCategory: reason.category,
      errorCode: reason.code,
      errorMessage: reason.message,
      token,
      attempt: Number(job.attempts),
    }))
  );
  if (results.length > 0) await tx.tokenResult.createMany({ data: results });
  await tx.notification.update({
    where: { id: notificationID },
    data: {
      pendingCount: { decrement: results.length },
      failedCount: { increment: results.length },
    },
  });
  return { jobs: failed.length, tokens: results.length };
};

// In-flight jobs keep running and finalize the notification when they finish.
export const cancelNotificationHelper = async (notificationID: string) => {
  try {
    return await db.$transaction(async (tx) => {
      await tx.notification.update({ where: { id: notificationID }, data: { status: NotificationStatus.CANCELED } });
      const canceled = await failPendingJobsHelper(tx, notificationID, {
        category: ErrorCategory.CANCELED,
        code: "canceled",
        message: "Canceled before sending",
      });
      await finalizeNotificationIfDoneHelper(tx, notificationID);
      return { canceledJobs: canceled.jobs, canceledTokens: canceled.tokens };
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const markNotificationStartedHelper = async (notificationID: string) => {
  try {
    await db.notification.updateMany({
      where: { id: notificationID, status: NotificationStatus.QUEUED },
      data: { status: NotificationStatus.PROCESSING, startedAt: new Date() },
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
};
