import { createHmac } from "node:crypto";

export const WEBHOOK_TIMEOUT_MS = 10_000;

// Receivers verify: hex(HMAC_SHA256(secret, `${X-Timestamp}.${rawBody}`)) === X-Signature (after "sha256=").
export const signWebhook = (secret: string, timestamp: string, body: string) =>
  `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

export const postWebhook = async (url: string, secret: string, payload: unknown) => {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": "notification-manager-webhook/1",
        "x-timestamp": timestamp,
        "x-signature": signWebhook(secret, timestamp, body),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    const text = await response.text().catch(() => "");
    return { ok: response.ok, statusCode: response.status, snippet: text.slice(0, 500) };
  } catch (error) {
    return { ok: false, statusCode: null, snippet: String((error as Error).message ?? error).slice(0, 500) };
  }
};
