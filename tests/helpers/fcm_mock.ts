import type { BatchResponse } from "firebase-admin/messaging";
import { setFcmSender } from "../../src/services/fcm.service";

export type MockTokenResult = { ok: true } | { code: string; message?: string };
export type FcmCall = { projectID: string; tokens: string[]; dryRun: boolean };

export const fcmError = (code: string, message = code) => ({ code, message, errorInfo: { code, message } });

// Replaces firebase-admin: `behavior` decides each token's result; `throws` makes the whole call reject.
export function installFcmMock(
  behavior: (token: string) => MockTokenResult = () => ({ ok: true }),
  options: { throws?: (call: FcmCall) => unknown } = {}
) {
  const calls: FcmCall[] = [];
  setFcmSender(async (project, message, dryRun = false) => {
    const call = { projectID: project.id, tokens: message.tokens, dryRun };
    calls.push(call);
    const thrown = options.throws?.(call);
    if (thrown) throw thrown;
    const responses = message.tokens.map((token) => {
      const result = behavior(token);
      return "ok" in result
        ? { success: true, messageId: `projects/x/messages/${token}` }
        : { success: false, error: fcmError(result.code, result.message) as any };
    });
    return {
      responses,
      successCount: responses.filter((r) => r.success).length,
      failureCount: responses.filter((r) => !r.success).length,
    } satisfies BatchResponse;
  });
  return calls;
}

export const resetFcmMock = () => setFcmSender();
