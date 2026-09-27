import { CredentialStatus } from "@prisma/client";
import { t, type Static } from "elysia";
import { httpsUrl, limit, name, offset, prefixedID, search } from "../shared.mo";

export const createProjectSchema = t.Object({
  name,
  enabled: t.Optional(t.Boolean()),
  webhookUrl: t.Optional(t.Union([httpsUrl, t.Null()])),
});

export const updateProjectSchema = t.Partial(
  t.Object({
    name,
    enabled: t.Boolean(),
    webhookUrl: t.Union([httpsUrl, t.Null()]),
  })
);

export const getProjectsSchema = t.Partial(
  t.Object({
    id: prefixedID("prj"),
    ids: t.Array(prefixedID("prj")),
    apiKeyPublicID: t.String({ pattern: "^[a-f0-9]{16}$" }),
    enabled: t.Boolean(),
    credentialStatus: t.Enum(CredentialStatus),
    search,
    limit,
    offset,
  })
);

export const projectParamsSchema = t.Object({
  id: prefixedID("prj"),
});

export type CreateProjectSchema = Static<typeof createProjectSchema>;
export type UpdateProjectSchema = Static<typeof updateProjectSchema>;
export type GetProjectsSchema = Static<typeof getProjectsSchema>;

//////////admin///////////
// The service-account file is read client-side and sent as its raw JSON text; it is parsed and checked
// in the route's beforeHandle so errors can name the missing field.
export const adminUploadCredentialSchema = t.Object({
  serviceAccount: t.String({ minLength: 2, maxLength: 20_000 }),
});

export const adminTestSendSchema = t.Object(
  {
    tokens: t.Array(t.String({ minLength: 1, maxLength: 4096 }), { minItems: 1, maxItems: 100 }),
    title: t.Optional(t.String({ maxLength: 1024 })),
    body: t.Optional(t.String({ maxLength: 4096 })),
    dryRun: t.Boolean(),
  },
  { additionalProperties: false }
);
