// Drop-in client for your other servers. Uses only fetch + node:crypto (Node 18+, Bun, Deno).
import { createHmac, timingSafeEqual } from "node:crypto";

const NOTIFY_URL = process.env.NOTIFY_URL ?? "https://notify.example.com";
const NOTIFY_API_KEY = process.env.NOTIFY_API_KEY!; // nm_<publicId>_<secret>, from the project page

export type SendInput = {
  tokens: string[];
  notification?: { title?: string; body?: string; imageUrl?: string };
  data?: Record<string, string>; // FCM only accepts string values
  android?: { priority?: "high" | "normal"; ttlSeconds?: number; collapseKey?: string; channelId?: string };
  apns?: { sound?: string; badge?: number };
  webpush?: { link?: string };
  externalId?: string;
};

// Returns as soon as the notification is queued; delivery happens in the background.
export async function sendPush(input: SendInput, idempotencyKey?: string) {
  const response = await fetch(`${NOTIFY_URL}/api/v1/notifications`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${NOTIFY_API_KEY}`,
      "content-type": "application/json",
      ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
    },
    body: JSON.stringify(input),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`Push rejected (${response.status}): ${JSON.stringify(body)}`);
  return body as { id: string; status: string; totalTokens: number; uniqueTokens: number; jobs: number };
}

export async function getNotification(id: string) {
  const response = await fetch(`${NOTIFY_URL}/api/v1/notifications/${id}`, {
    headers: { authorization: `Bearer ${NOTIFY_API_KEY}` },
  });
  if (!response.ok) throw new Error(`Status lookup failed (${response.status})`);
  return response.json();
}

// Tokens FCM reported as unregistered/invalid: delete them from your database.
export async function getInvalidTokens(id: string) {
  const tokens: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await fetch(`${NOTIFY_URL}/api/v1/notifications/${id}/invalid-tokens?limit=1000&offset=${offset}`, {
      headers: { authorization: `Bearer ${NOTIFY_API_KEY}` },
    });
    const page = (await response.json()) as { tokens: { token: string }[]; count: number };
    tokens.push(...page.tokens.map((t) => t.token));
    if (page.tokens.length === 0 || tokens.length >= page.count) return tokens;
  }
}

// Webhook receiver: verify against the RAW request body, with the X-Timestamp and X-Signature headers.
export function verifyWebhook(rawBody: string, timestamp: string, signature: string, secret: string, maxAgeSeconds = 300) {
  if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > maxAgeSeconds) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  return expected.length === signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

// Example:
// const { id } = await sendPush(
//   {
//     tokens: userTokens,
//     notification: { title: "New order", body: "Order #123 received" },
//     data: { orderId: "123", type: "order_created" },
//     android: { priority: "high", channelId: "orders" },
//     externalId: "order-123",
//   },
//   "order-123-created" // retries of the same request won't send twice
// );
