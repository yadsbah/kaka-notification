import { ErrorCategory, JobStatus, TokenOutcome } from "@prisma/client";
import { config } from "../config";
import type { JobOutcome, TokenFinal } from "../helpers/jobs/jobs.helper";
import { classifyError, isRetryableCategory, type ClassifiedError } from "../services/fcm_errors.service";
import { retryDelayMs } from "../utils/backoff.utils";

export type TokenResponse = { success: boolean; messageId?: string; error?: unknown };

const mostCommon = (errors: ClassifiedError[]) => {
  const counts = new Map<string, { error: ClassifiedError; count: number }>();
  for (const error of errors) {
    const entry = counts.get(error.code) ?? { error, count: 0 };
    entry.count++;
    counts.set(error.code, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)[0]?.error;
};

// Pure: turns one sendEachForMulticast result into what should happen to each token.
export const decideJobOutcome = (
  job: { attempts: number; maxAttempts: number },
  tokens: string[],
  responses: TokenResponse[],
  now = Date.now()
): JobOutcome => {
  const classified = tokens.map((_, i) => {
    const response = responses[i];
    if (!response) return classifyError({ code: "missing-response", message: "FCM returned no response for this token" });
    return response.success ? null : classifyError(response.error);
  });
  const errors = classified.filter((error): error is ClassifiedError => error !== null);

  // Only a config error on *every* token is a project problem. A few tokens failing with SENDER_ID_MISMATCH
  // or an APNs auth error while others succeed must not pause the whole project.
  const projectConfigError =
    errors.length === tokens.length && errors.every((error) => error.category === ErrorCategory.CONFIG_ERROR)
      ? errors[0]
      : undefined;
  const payloadError = errors.find((error) => error.category === ErrorCategory.PAYLOAD_ERROR);
  const canRetry = !payloadError && job.attempts < job.maxAttempts;

  const finals: TokenFinal[] = [];
  const retryTokens: string[] = [];
  let retryAfterSeconds = 0;

  tokens.forEach((token, i) => {
    const error = classified[i];
    if (!error) {
      finals.push({ token, outcome: TokenOutcome.SUCCESS, messageID: responses[i]?.messageId });
      return;
    }
    const detail = { token, category: error.category, code: error.code, message: error.message };
    if (error.category === ErrorCategory.INVALID_TOKEN) {
      finals.push({ ...detail, outcome: TokenOutcome.INVALID });
    } else if (isRetryableCategory(error.category) && canRetry) {
      retryTokens.push(token);
      retryAfterSeconds = Math.max(retryAfterSeconds, error.retryAfterSeconds ?? 0);
    } else {
      finals.push({ ...detail, outcome: TokenOutcome.FAILED });
    }
  });

  const lastError = mostCommon(errors);
  return {
    finals,
    retry:
      retryTokens.length > 0
        ? {
            tokens: retryTokens,
            runAfter: new Date(now + retryDelayMs(job.attempts, config.retryBackoffSeconds, retryAfterSeconds || undefined)),
          }
        : undefined,
    jobStatus: finals.some((final) => final.outcome === TokenOutcome.FAILED) ? JobStatus.FAILED : JobStatus.COMPLETED,
    lastError: lastError && { code: lastError.code, message: lastError.message },
    pauseProject: projectConfigError && { code: projectConfigError.code, message: projectConfigError.message },
    failNotification: payloadError && { code: payloadError.code, message: payloadError.message },
  };
};
