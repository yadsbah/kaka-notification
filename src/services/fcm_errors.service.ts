import { ErrorCategory } from "@prisma/client";

export type ClassifiedError = {
  category: ErrorCategory;
  code: string;
  message: string;
  retryAfterSeconds?: number;
};

const INVALID_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-recipient",
]);

const RETRYABLE_CODES = new Set([
  "messaging/server-unavailable",
  "messaging/internal-error",
  "messaging/message-rate-exceeded",
  "messaging/device-message-rate-exceeded",
  "messaging/topics-message-rate-exceeded",
  "messaging/quota-exceeded",
  "app/network-error",
  "app/network-timeout",
  "app/unable-to-parse-response",
  "lease_expired",
  "send_timeout",
]);

const CONFIG_CODES = new Set([
  "messaging/mismatched-credential",
  "messaging/third-party-auth-error",
  "messaging/authentication-error",
  "messaging/invalid-credential",
  "app/invalid-credential",
  "credential/parse-failed",
  "credential/missing",
]);

const PAYLOAD_CODES = new Set([
  "messaging/payload-size-limit-exceeded",
  "messaging/invalid-payload",
  "messaging/invalid-data-payload-key",
  "messaging/invalid-options",
  "messaging/invalid-package-name",
]);

const NETWORK_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ERR_HTTP2_GOAWAY_SESSION",
  "ERR_HTTP2_SESSION_ERROR",
  "ERR_HTTP2_STREAM_ERROR",
  "ERR_HTTP2_STREAM_CANCEL",
  "ERR_HTTP2_ERROR",
]);

const NETWORK_MESSAGE = /GOAWAY|exceeded_max_concurrent_streams|ECONNRESET|ETIMEDOUT|socket hang up|network timeout|timed out/i;

// FCM reports a bad token as INVALID_ARGUMENT too; only the message tells token problems from body problems.
const TOKEN_MESSAGE = /registration token|not a valid FCM registration token|invalid token/i;

const readRetryAfter = (error: any) => {
  const raw = error?.httpResponse?.headers?.["retry-after"] ?? error?.response?.headers?.["retry-after"];
  if (raw === undefined || raw === null) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(String(raw));
  return Number.isNaN(date) ? undefined : Math.max(0, Math.ceil((date - Date.now()) / 1000));
};

// The one place that decides what an FCM / network / credential error means for a token.
export const classifyError = (error: unknown): ClassifiedError => {
  const err = error as { code?: unknown; message?: unknown; errorInfo?: { code?: string; message?: string } } | null;
  const code = String(err?.errorInfo?.code ?? err?.code ?? "unknown");
  const message = String(err?.errorInfo?.message ?? err?.message ?? error ?? "Unknown error").slice(0, 1000);
  const retryAfterSeconds = readRetryAfter(error);
  const result = (category: ErrorCategory): ClassifiedError => ({ category, code, message, retryAfterSeconds });

  if (INVALID_TOKEN_CODES.has(code)) return result(ErrorCategory.INVALID_TOKEN);
  if (code === "messaging/invalid-argument") {
    return result(TOKEN_MESSAGE.test(message) ? ErrorCategory.INVALID_TOKEN : ErrorCategory.PAYLOAD_ERROR);
  }
  if (RETRYABLE_CODES.has(code) || NETWORK_CODES.has(code) || NETWORK_MESSAGE.test(message)) {
    return result(ErrorCategory.RETRYABLE);
  }
  if (CONFIG_CODES.has(code)) return result(ErrorCategory.CONFIG_ERROR);
  if (PAYLOAD_CODES.has(code)) return result(ErrorCategory.PAYLOAD_ERROR);
  return result(ErrorCategory.UNKNOWN);
};

export const isRetryableCategory = (category: ErrorCategory) =>
  category === ErrorCategory.RETRYABLE || category === ErrorCategory.UNKNOWN;
