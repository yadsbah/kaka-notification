import type { MulticastMessage } from "firebase-admin/messaging";
import type { NotificationPayload } from "../models/notifications/notifications.mo";

// FCM reserves "from", "message_type", "notification", "collapse_key" and anything starting with google/gcm.
const RESERVED_DATA_KEYS = new Set(["from", "message_type", "notification", "collapse_key"]);
export const isReservedDataKey = (key: string) => {
  const lower = key.toLowerCase();
  return RESERVED_DATA_KEYS.has(lower) || lower.startsWith("google") || lower.startsWith("gcm");
};

export const FCM_MAX_MESSAGE_BYTES = 4096;

export const buildMulticastMessage = (payload: NotificationPayload, tokens: string[]): MulticastMessage => {
  const { notification, data, android, apns, webpush } = payload;
  const message: MulticastMessage = {
    tokens,
    notification: notification && {
      title: notification.title,
      body: notification.body,
      imageUrl: notification.imageUrl,
    },
    data,
    android: android && {
      priority: android.priority,
      ttl: android.ttlSeconds === undefined ? undefined : android.ttlSeconds * 1000,
      collapseKey: android.collapseKey,
      notification: android.channelId ? { channelId: android.channelId } : undefined,
    },
    apns: apns && { payload: { aps: { sound: apns.sound, badge: apns.badge } } },
    webpush: webpush?.link ? { fcmOptions: { link: webpush.link } } : undefined,
  };
  // Drop undefined keys so firebase-admin's validator only sees what the caller set.
  return JSON.parse(JSON.stringify(message));
};

export const estimateMessageBytes = (payload: NotificationPayload) => {
  const { tokens, ...message } = buildMulticastMessage(payload, []);
  return Buffer.byteLength(JSON.stringify(message), "utf8");
};
