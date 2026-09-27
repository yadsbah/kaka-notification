import db from "../../prisma_client";

export const getSendsLast24hHelper = async () => {
  try {
    const totals = await db.notification.aggregate({
      where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      _sum: { successCount: true, invalidCount: true, failedCount: true, pendingCount: true },
      _count: { _all: true },
    });
    return {
      notifications: totals._count._all,
      success: totals._sum.successCount ?? 0,
      invalid: totals._sum.invalidCount ?? 0,
      failed: totals._sum.failedCount ?? 0,
      pending: totals._sum.pendingCount ?? 0,
    };
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getRecentJobErrorsHelper = async (take = 10) => {
  try {
    const jobs = await db.job.findMany({
      where: { lastErrorCode: { not: null, notIn: ["canceled"] } },
      select: {
        id: true,
        notificationID: true,
        status: true,
        attempts: true,
        lastErrorCode: true,
        lastErrorMessage: true,
        updatedAt: true,
        Project: { select: { id: true, name: true } },
      },
      take,
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    if (jobs.length === 0) return null;
    return jobs;
  } catch (error) {
    console.error(error);
    throw error;
  }
};
