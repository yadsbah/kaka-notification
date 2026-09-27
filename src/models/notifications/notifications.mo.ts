import { NotificationStatus, TokenOutcome } from "@prisma/client";
import { t, type Static } from "elysia";
import { config } from "../../config";
import { dateType, externalID, httpsUrl, limit, offset, prefixedID, search } from "../shared.mo";

const strict = { additionalProperties: false };

export const fcmToken = t.String({
  minLength: 1,
  maxLength: 4096,
  examples: ["fcm_token_1"],
});

const notificationContent = t.Object(
  {
    title: t.Optional(t.String({ maxLength: 1024, examples: ["New order"] })),
    body: t.Optional(t.String({ maxLength: 4096, examples: ["Order #123 received"] })),
    imageUrl: t.Optional(httpsUrl),
  },
  strict
);

// FCM only accepts string data values; anything else is rejected, never coerced.
const dataPayload = t.Record(t.String({ minLength: 1, maxLength: 256 }), t.String({ maxLength: 4096 }));

const androidOptions = t.Object(
  {
    priority: t.Optional(t.Union([t.Literal("high"), t.Literal("normal")])),
    ttlSeconds: t.Optional(t.Integer({ minimum: 0, maximum: 2_419_200 })),
    collapseKey: t.Optional(t.String({ minLength: 1, maxLength: 256 })),
    channelId: t.Optional(t.String({ minLength: 1, maxLength: 256 })),
  },
  strict
);

const apnsOptions = t.Object(
  {
    sound: t.Optional(t.String({ minLength: 1, maxLength: 256 })),
    badge: t.Optional(t.Integer({ minimum: 0, maximum: 1_000_000 })),
  },
  strict
);

const webpushOptions = t.Object(
  {
    link: t.Optional(httpsUrl),
  },
  strict
);

export const notificationPayloadSchema = t.Object(
  {
    notification: t.Optional(notificationContent),
    data: t.Optional(dataPayload),
    android: t.Optional(androidOptions),
    apns: t.Optional(apnsOptions),
    webpush: t.Optional(webpushOptions),
  },
  strict
);

export const createNotificationSchema = t.Object(
  {
    tokens: t.Array(fcmToken, { minItems: 1, maxItems: config.maxTokensPerRequest }),
    ...notificationPayloadSchema.properties,
    externalId: t.Optional(externalID),
  },
  strict
);

export const idempotencyHeaderSchema = t.Object({
  "idempotency-key": t.Optional(t.String({ minLength: 1, maxLength: 255 })),
});

export const getNotificationsSchema = t.Partial(
  t.Object({
    id: prefixedID("ntf"),
    ids: t.Array(prefixedID("ntf")),
    projectID: prefixedID("prj"),
    status: t.Enum(NotificationStatus),
    externalID,
    createdFrom: dateType,
    createdTo: dateType,
    limit,
    offset,
  })
);

export const getTokenResultsSchema = t.Partial(
  t.Object({
    notificationID: prefixedID("ntf"),
    outcome: t.Enum(TokenOutcome),
    errorCode: t.String({ maxLength: 100 }),
    search,
    limit,
    offset,
  })
);

export const notificationParamsSchema = t.Object({
  id: prefixedID("ntf"),
});

export type NotificationPayload = Static<typeof notificationPayloadSchema>;
export type CreateNotificationSchema = Static<typeof createNotificationSchema>;
export type GetNotificationsSchema = Static<typeof getNotificationsSchema>;
export type GetTokenResultsSchema = Static<typeof getTokenResultsSchema>;

////////////api////////////
export const apiGetInvalidTokensSchema = t.Partial(
  t.Object({
    limit: t.Numeric({ minimum: 1, maximum: 1000, examples: [100] }),
    offset,
  })
);

//////////admin///////////
// Same payload as the public API, plus which project to send as (the API gets that from the key).
export const adminCreateNotificationSchema = t.Object(
  {
    projectID: prefixedID("prj"),
    ...createNotificationSchema.properties,
  },
  strict
);

export const adminGetTokenResultsSchema = t.Partial(
  t.Object({
    outcome: t.Enum(TokenOutcome),
    errorCode: t.String({ maxLength: 100 }),
    search,
    limit,
    offset,
  })
);

export const tokenResultParamsSchema = t.Object({
  id: prefixedID("ntf"),
  resultID: t.Numeric({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }),
});
