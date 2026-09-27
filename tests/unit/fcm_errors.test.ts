import { describe, expect, test } from "bun:test";
import { classifyError, isRetryableCategory } from "../../src/services/fcm_errors.service";

const fcm = (code: string, message = "boom") => ({ errorInfo: { code, message }, code, message });

describe("FCM error classification", () => {
  const cases: [string, unknown, string][] = [
    ["not registered", fcm("messaging/registration-token-not-registered"), "INVALID_TOKEN"],
    ["invalid registration token", fcm("messaging/invalid-registration-token"), "INVALID_TOKEN"],
    ["invalid recipient", fcm("messaging/invalid-recipient"), "INVALID_TOKEN"],
    [
      "invalid-argument about the token",
      fcm("messaging/invalid-argument", "The registration token is not a valid FCM registration token"),
      "INVALID_TOKEN",
    ],
    ["invalid-argument about the body", fcm("messaging/invalid-argument", "Invalid JSON payload received. Unknown name"), "PAYLOAD_ERROR"],
    ["server unavailable", fcm("messaging/server-unavailable"), "RETRYABLE"],
    ["internal error", fcm("messaging/internal-error"), "RETRYABLE"],
    ["message rate exceeded", fcm("messaging/message-rate-exceeded"), "RETRYABLE"],
    ["device message rate exceeded", fcm("messaging/device-message-rate-exceeded"), "RETRYABLE"],
    ["quota exceeded", fcm("messaging/quota-exceeded"), "RETRYABLE"],
    ["app network error", fcm("app/network-error"), "RETRYABLE"],
    ["app network timeout", fcm("app/network-timeout"), "RETRYABLE"],
    ["ECONNRESET", Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }), "RETRYABLE"],
    ["ETIMEDOUT", Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }), "RETRYABLE"],
    ["HTTP/2 GOAWAY code", Object.assign(new Error("session closed"), { code: "ERR_HTTP2_GOAWAY_SESSION" }), "RETRYABLE"],
    ["GOAWAY in message", new Error("New streams cannot be created after receiving a GOAWAY"), "RETRYABLE"],
    ["max concurrent streams", fcm("messaging/unknown-error", "exceeded_max_concurrent_streams"), "RETRYABLE"],
    ["socket hang up", new Error("socket hang up"), "RETRYABLE"],
    ["lease expired", { code: "lease_expired", message: "Lease expired" }, "RETRYABLE"],
    ["send timeout", { code: "send_timeout", message: "FCM did not answer" }, "RETRYABLE"],
    ["mismatched credential", fcm("messaging/mismatched-credential"), "CONFIG_ERROR"],
    ["third party auth", fcm("messaging/third-party-auth-error"), "CONFIG_ERROR"],
    ["authentication error", fcm("messaging/authentication-error"), "CONFIG_ERROR"],
    ["revoked service account", fcm("app/invalid-credential", "invalid_grant: Invalid JWT Signature"), "CONFIG_ERROR"],
    ["credential parse failure", { code: "credential/parse-failed", message: "bad json" }, "CONFIG_ERROR"],
    ["payload too large", fcm("messaging/payload-size-limit-exceeded"), "PAYLOAD_ERROR"],
    ["invalid data key", fcm("messaging/invalid-data-payload-key"), "PAYLOAD_ERROR"],
    ["unknown firebase code", fcm("messaging/unknown-error", "Raw server response"), "UNKNOWN"],
    ["plain error", new Error("something odd"), "UNKNOWN"],
    ["non-error value", "string thrown", "UNKNOWN"],
    ["null", null, "UNKNOWN"],
  ];

  for (const [name, error, category] of cases) {
    test(`${name} → ${category}`, () => {
      expect(classifyError(error).category).toBe(category as any);
    });
  }

  test("keeps the original code and message", () => {
    expect(classifyError(fcm("messaging/server-unavailable", "try later"))).toMatchObject({
      code: "messaging/server-unavailable",
      message: "try later",
    });
  });

  test("reads Retry-After seconds when the error exposes a response", () => {
    const error = { ...fcm("messaging/message-rate-exceeded"), httpResponse: { headers: { "retry-after": "120" } } };
    expect(classifyError(error).retryAfterSeconds).toBe(120);
  });

  test("reads Retry-After HTTP dates", () => {
    const at = new Date(Date.now() + 90_000).toUTCString();
    const error = { ...fcm("messaging/server-unavailable"), response: { headers: { "retry-after": at } } };
    expect(classifyError(error).retryAfterSeconds).toBeWithin(85, 91);
  });

  test("unknown is retried like retryable, others are not", () => {
    expect(isRetryableCategory("UNKNOWN")).toBe(true);
    expect(isRetryableCategory("RETRYABLE")).toBe(true);
    expect(isRetryableCategory("INVALID_TOKEN")).toBe(false);
    expect(isRetryableCategory("CONFIG_ERROR")).toBe(false);
    expect(isRetryableCategory("PAYLOAD_ERROR")).toBe(false);
  });
});
