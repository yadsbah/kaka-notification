import { hostname } from "node:os";
import { config } from "../config";
import { claimJobHelper, reapExpiredJobsHelper } from "../helpers/jobs/jobs.helper";
import { runRetentionCleanupHelper } from "../helpers/retention/retention.helper";
import { deleteWorkerHelper, upsertWorkerHelper } from "../helpers/workers/workers.helper";
import { logger } from "../logger";
import { newID } from "../utils/ids.utils";
import { processJob } from "./process_job";
import { deliverDueWebhooks } from "./webhooks";

const HEARTBEAT_MS = 10_000;
const REAPER_MS = 30_000;
const WEBHOOK_MS = 5_000;

export const reapExpiredJobs = async () => {
  const reaped = await reapExpiredJobsHelper();
  if (reaped.requeued || reaped.failed) logger.warn(reaped, "Reaper recovered expired jobs");
  return reaped;
};

// Claims and processes jobs one at a time until the queue has nothing runnable. Used by tests and scripts.
export const drainQueue = async (workerID = newID("wrk"), maxJobs = 10_000) => {
  let processed = 0;
  while (processed < maxJobs) {
    const job = await claimJobHelper(workerID);
    if (!job) break;
    await processJob(job, workerID);
    processed++;
  }
  return processed;
};

export const startWorker = async () => {
  const workerID = newID("wrk");
  const log = logger.child({ worker_id: workerID });
  const inFlight = new Set<string>();
  let jobsProcessed = 0;
  let stopping = false;

  const heartbeat = () =>
    upsertWorkerHelper({
      id: workerID,
      hostname: hostname(),
      pid: process.pid,
      jobsProcessed,
      currentJobID: inFlight.size > 0 ? [...inFlight].join(",") : null,
    }).catch((error) => log.error({ err: error }, "Heartbeat failed"));

  // Recover whatever a previous crash left behind before taking new work.
  await reapExpiredJobs();
  await heartbeat();

  const cleanup = () =>
    runRetentionCleanupHelper()
      .then((removed) => log.info({ removed }, "Retention cleanup finished"))
      .catch((error) => log.error({ err: error }, "Retention cleanup failed"));

  // One webhook batch at a time; a slow receiver must not stack up overlapping loops.
  let deliveringWebhooks = false;
  const webhooks = async () => {
    if (deliveringWebhooks) return;
    deliveringWebhooks = true;
    await deliverDueWebhooks()
      .catch((error) => log.error({ err: error }, "Webhook delivery loop failed"))
      .finally(() => (deliveringWebhooks = false));
  };

  const timers = [
    setInterval(heartbeat, HEARTBEAT_MS),
    setInterval(() => reapExpiredJobs().catch((error) => log.error({ err: error }, "Reaper failed")), REAPER_MS),
    setInterval(webhooks, WEBHOOK_MS),
    setInterval(cleanup, config.cleanupIntervalHours * 60 * 60 * 1000),
    setTimeout(cleanup, 60_000), // first run shortly after boot, off the startup path
  ];

  const slot = async () => {
    while (!stopping) {
      let job;
      try {
        job = await claimJobHelper(workerID);
      } catch (error) {
        log.error({ err: error }, "Claim failed");
      }
      if (!job) {
        await Bun.sleep(config.workerPollMs);
        continue;
      }
      inFlight.add(job.id);
      try {
        await processJob(job, workerID);
      } catch (error) {
        // Job stays PROCESSING; the reaper hands it back after the lease expires.
        log.error({ err: error, job_id: job.id }, "Job crashed; leaving it for the reaper");
      } finally {
        inFlight.delete(job.id);
        jobsProcessed++;
      }
    }
  };

  const slots = Array.from({ length: config.workerConcurrency }, slot);
  log.info({ concurrency: config.workerConcurrency, project_concurrency: config.projectConcurrency }, "Worker started");

  return {
    workerID,
    stop: async () => {
      stopping = true;
      log.info({ in_flight: inFlight.size }, "Worker stopping; waiting for in-flight jobs");
      const finished = await Promise.race([
        Promise.all(slots).then(() => true),
        Bun.sleep(config.shutdownTimeoutMs).then(() => false),
      ]);
      timers.forEach(clearTimeout);
      if (!finished) log.warn({ in_flight: [...inFlight] }, "Shutdown timeout; the reaper will recover unfinished jobs");
      await deleteWorkerHelper(workerID);
      log.info("Worker stopped");
    },
  };
};
