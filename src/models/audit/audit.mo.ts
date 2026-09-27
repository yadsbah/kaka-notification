import { t, type Static } from "elysia";
import { dateType, id, limit, offset } from "../shared.mo";

export const getAuditLogsSchema = t.Partial(
  t.Object({
    adminID: id,
    action: t.String({ maxLength: 100 }),
    targetType: t.String({ maxLength: 50 }),
    targetID: t.String({ maxLength: 100 }),
    createdFrom: dateType,
    createdTo: dateType,
    limit,
    offset,
  })
);

export type GetAuditLogsSchema = Static<typeof getAuditLogsSchema>;
