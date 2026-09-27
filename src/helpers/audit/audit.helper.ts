import type { Prisma } from "@prisma/client";
import type { GetAuditLogsSchema } from "../../models/audit/audit.mo";
import db from "../../prisma_client";

const auditLogInclude = {
  Admin: { select: { id: true, email: true } },
} satisfies Prisma.AuditLogInclude;

const buildAuditLogsWhere = (params: GetAuditLogsSchema): Prisma.AuditLogWhereInput => ({
  adminID: { equals: params.adminID },
  action: { equals: params.action },
  targetType: { equals: params.targetType },
  targetID: { equals: params.targetID },
  createdAt: {
    gte: params.createdFrom ? new Date(params.createdFrom) : undefined,
    lte: params.createdTo ? new Date(params.createdTo) : undefined,
  },
});

export const createAuditLogHelper = async (params: {
  adminID: number;
  action: string;
  targetType?: string;
  targetID?: string;
  details?: Prisma.InputJsonValue;
}) => {
  try {
    return await db.auditLog.create({ data: params, include: auditLogInclude });
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getAuditLogsHelper = async (params: GetAuditLogsSchema) => {
  try {
    const logs = await db.auditLog.findMany({
      where: buildAuditLogsWhere(params),
      include: auditLogInclude,
      take: params.limit === 0 ? undefined : params.limit,
      skip: params.offset,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (logs.length === 0) return null;
    return logs;
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getAuditLogsCountHelper = async (params: GetAuditLogsSchema) => {
  try {
    const count = await db.auditLog.count({ where: buildAuditLogsWhere(params), select: { id: true } });
    return count.id;
  } catch (error) {
    console.error(error);
    throw error;
  }
};
