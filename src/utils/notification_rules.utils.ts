import type { NotificationPayload } from "../models/notifications/notifications.mo";
import { estimateMessageBytes, FCM_MAX_MESSAGE_BYTES, isReservedDataKey } from "./fcm_message.utils";

export type FieldError = { path: string; message: string };

// Business rules the TypeBox schema can't express. Empty array = valid.
export const notificationRuleErrors = (body: NotificationPayload & { tokens?: string[] }): FieldError[] => {
  const errors: FieldError[] = [];

  body.tokens?.forEach((token, index) => {
    if (token.trim() === "" && errors.length < 20) {
      errors.push({ path: `/tokens/${index}`, message: "Token must not be blank" });
    }
  });

  const hasContent = Boolean(body.notification?.title || body.notification?.body);
  const hasData = Object.keys(body.data ?? {}).length > 0;
  if (!hasContent && !hasData) {
    errors.push({ path: "/notification", message: "Provide notification.title or notification.body, or a non-empty data object" });
  }

  for (const key of Object.keys(body.data ?? {})) {
    if (isReservedDataKey(key)) {
      errors.push({ path: `/data/${key}`, message: `"${key}" is reserved by FCM (from, message_type, notification, collapse_key, google*, gcm*)` });
    }
  }

  const size = estimateMessageBytes(body);
  if (size > FCM_MAX_MESSAGE_BYTES) {
    errors.push({ path: "/", message: `Message is ${size} bytes without tokens; FCM allows ${FCM_MAX_MESSAGE_BYTES}` });
  }

  return errors;
};
