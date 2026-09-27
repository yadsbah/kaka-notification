import { TokenOutcome, WebhookStatus, type Prisma } from "@prisma/client";
import db from "../../prisma_client";

export const WEBHOOK_MAX_ATTEMPTS = 4; // first try + 3 retries
export const WEBHOOK_RETRY_SECONDS = [30, 120, 600];
export const WEBHOOK_INVALID_TOKENS_LIMIT = 1000;
const CLAIM_LEASE_MS = 60_000;

const webhookDeliveryInclude = {
  Notification: {
    include: {
      Project: { select: { id: true, webhookUrl: true, webhookSecretEncrypted: true } },
    },
  },
} satisfies Prisma.WebhookDeliveryInclude;

// Pushing runAfter forward is the lease: another process won't pick the row up, and if this one dies
// mid-request the row becomes due again after CLAIM_LEASE_MS.
export const claimWebhookDeliveryHelper = async () => {
  try {
    const now = Date.now();
    const claimed = await db.$queryRaw<{ id: number }[]>`
      UPDATE "WebhookDelivery" SET "runAfter" = ${now + CLAIM_LEASE_MS}, "updatedAt" = ${now}
      WHERE "id" = (
        SELECT "id" FROM "WebhookDelivery"
        WHERE "status" = 'PENDING' AND "runAfter" <= ${now}
        ORDER BY "runAfter" ASC, "id" ASC LIMIT 1
      ) AND "status" = 'PENDING'
      RETURNING "id"`;
    if (claimed.length === 0) return null;
    return await db.webhookDelivery.findUnique({
      where: { id: Number(claimed[0]!.id) },
      include: webhookDeliveryInclude,
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getInvalidTokensForWebhookHelper = async (notificationID: string) => {
  try {
    const results = await db.tokenResult.findMany({
      where: { notificationID, outcome: TokenOutcome.INVALID },
      select: { token: true },
      take: WEBHOOK_INVALID_TOKENS_LIMIT,
      orderBy: [{ id: "asc" }],
    });
    return results.map((result) => result.token);
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const recordWebhookAttemptHelper = async (
  delivery: { id: number; notificationID: string; attempt: number },
  result: { ok: boolean; statusCode: number | null; snippet: string },
  options: { retry?: boolean } = {}
) => {
  try {
    await db.$transaction(async (tx) => {
      await tx.webhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: result.ok ? WebhookStatus.SUCCEEDED : WebhookStatus.FAILED,
          statusCode: result.statusCode,
          responseSnippet: result.snippet,
        },
      });
      if (!result.ok && options.retry !== false && delivery.attempt < WEBHOOK_MAX_ATTEMPTS) {
        const delaySeconds = WEBHOOK_RETRY_SECONDS[delivery.attempt - 1] ?? WEBHOOK_RETRY_SECONDS.at(-1)!;
        await tx.webhookDelivery.create({
          data: {
            notificationID: delivery.notificationID,
            attempt: delivery.attempt + 1,
            runAfter: new Date(Date.now() + delaySeconds * 1000),
          },
        });
      }
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const getWebhookDeliveriesHelper = async (params: { notificationID?: string; limit?: number; offset?: number }) => {
  try {
    const deliveries = await db.webhookDelivery.findMany({
      where: { notificationID: { equals: params.notificationID } },
      take: params.limit === 0 ? undefined : params.limit,
      skip: params.offset,
      orderBy: [{ attempt: "asc" }, { id: "asc" }],
    });
    if (deliveries.length === 0) return null;
    return deliveries;
  } catch (error) {
    console.error(error);
    throw error;
  }
};
