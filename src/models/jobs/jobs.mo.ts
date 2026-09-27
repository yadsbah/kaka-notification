import { JobStatus } from "@prisma/client";
import { t, type Static } from "elysia";
import { limit, offset, prefixedID } from "../shared.mo";

export const getJobsSchema = t.Partial(
  t.Object({
    id: prefixedID("job"),
    ids: t.Array(prefixedID("job")),
    notificationID: prefixedID("ntf"),
    projectID: prefixedID("prj"),
    status: t.Enum(JobStatus),
    retriesOnly: t.Boolean(),
    limit,
    offset,
  })
);

export const jobParamsSchema = t.Object({
  id: prefixedID("job"),
});

export type GetJobsSchema = Static<typeof getJobsSchema>;
