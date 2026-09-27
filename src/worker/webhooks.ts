import { config } from "../config";
import {
  claimWebhookDeliveryHelper,
  getInvalidTokensForWebhookHelper,
  recordWebhookAttemptHelper,
  WEBHOOK_INVALID_TOKENS_LIMIT,
} from "../helpers/webhooks/webhooks.helper";
import { logger } from "../logger";
import { postWebhook } from "../services/webhook.service";
import { decrypt } from "../utils/crypto.utils";

// Sends every due webhook delivery. Failures only ever touch WebhookDelivery rows, never the notification.
export const deliverDueWebhooks = async (max = 20) => {
  let sent = 0;
  while (sent < max) {
    const delivery = await claimWebhookDeliveryHelper();
    if (!delivery) break;
    sent++;

    const { Notification: notification } = delivery;
    const project = notification.Project;
    const log = logger.child({ notification_id: notification.id, project_id: project.id, attempt: delivery.attempt });

    if (!project.webhookUrl || !project.webhookSecretEncrypted) {
      await recordWebhookAttemptHelper(
        delivery,
        { ok: false, statusCode: null, snippet: "Webhook URL or secret removed before delivery" },
        { retry: false }
      );
      continue;
    }

    const invalidTokens = await getInvalidTokensForWebhookHelper(notification.id);
    const payload = {
      event: "notification.finished",
      id: notification.id,
      externalId: notification.externalID,
      projectId: project.id,
      status: notification.status.toLowerCase(),
      totalTokens: notification.totalTokens,
      uniqueTokens: notification.uniqueTokens,
      successCount: notification.successCount,
      invalidCount: notification.invalidCount,
      failedCount: notification.failedCount,
      createdAt: notification.createdAt,
      finishedAt: notification.finishedAt,
      invalidTokens,
      invalidTokensTruncated: notification.invalidCount > WEBHOOK_INVALID_TOKENS_LIMIT,
      invalidTokensUrl: `${config.publicUrl}/api/v1/notifications/${notification.id}/invalid-tokens`,
    };

    const result = await postWebhook(project.webhookUrl, decrypt(project.webhookSecretEncrypted), payload);
    await recordWebhookAttemptHelper(delivery, result);
    if (result.ok) log.info({ status_code: result.statusCode }, "Webhook delivered");
    else log.warn({ status_code: result.statusCode, response: result.snippet }, "Webhook delivery failed");
  }
  return sent;
};
