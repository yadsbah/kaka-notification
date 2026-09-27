import type { Job } from "@prisma/client";
import { settleJobHelper } from "../helpers/jobs/jobs.helper";
import { getNotificationsHelper, markNotificationStartedHelper } from "../helpers/notifications/notifications.helper";
import { getProjectSecretsHelper } from "../helpers/projects/projects.helper";
import { logger } from "../logger";
import type { NotificationPayload } from "../models/notifications/notifications.mo";
import { classifyError } from "../services/fcm_errors.service";
import { sendMulticast } from "../services/fcm.service";
import { buildMulticastMessage } from "../utils/fcm_message.utils";
import { decideJobOutcome, type TokenResponse } from "./outcome";

export const processJob = async (job: Job, workerID: string) => {
  const startedAt = Date.now();
  const log = logger.child({ job_id: job.id, notification_id: job.notificationID, project_id: job.projectID });
  const tokens = job.tokens as string[];

  const project = (await getProjectSecretsHelper({ id: job.projectID }))?.[0];
  const notification = (await getNotificationsHelper({ id: job.notificationID }))?.[0];
  // Project or notification deleted mid-flight: the job row went with it (cascade), nothing to settle.
  if (!project || !notification) return;

  await markNotificationStartedHelper(notification.id);

  let responses: TokenResponse[];
  try {
    const message = buildMulticastMessage(notification.payload as NotificationPayload, tokens);
    const batch = await sendMulticast(project, message);
    responses = batch.responses;
  } catch (error) {
    // The whole call failed (network, credential, HTTP/2 session): every token shares that error.
    log.warn({ err: error, attempt: job.attempts }, "sendEachForMulticast threw; applying the error to the whole job");
    responses = tokens.map(() => ({ success: false, error }));
  }

  const outcome = decideJobOutcome(job, tokens, responses);
  const result = await settleJobHelper(job, workerID, Date.now() - startedAt, outcome);

  if (!result.settled) {
    log.warn("Lease lost before settling; results dropped, the requeued job will resend");
    return;
  }
  if (outcome.failNotification) {
    log.error({ error: outcome.failNotification }, "PAYLOAD ERROR: FCM rejected the message body; notification failed. Validation should have caught this.");
  }
  if (outcome.pauseProject) {
    log.error({ error: outcome.pauseProject }, "Credential problem: project paused until the service account is fixed");
  }
  const unknown = responses.filter((r) => !r.success).map((r) => classifyError(r.error)).find((e) => e.category === "UNKNOWN");
  if (unknown) log.warn({ raw_error: unknown }, "Unclassified FCM error; treated as retryable");
  log.info(
    {
      attempt: job.attempts,
      token_count: tokens.length,
      success: outcome.finals.filter((final) => final.outcome === "SUCCESS").length,
      invalid: outcome.finals.filter((final) => final.outcome === "INVALID").length,
      failed: outcome.finals.filter((final) => final.outcome === "FAILED").length,
      retrying: outcome.retry?.tokens.length ?? 0,
      duration_ms: Date.now() - startedAt,
      final_status: result.finalStatus ?? undefined,
    },
    "Job settled"
  );
};
