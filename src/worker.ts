// Standalone worker process: `bun run worker`. Same DB file as the API (WAL allows concurrent readers).
import { logger } from "./logger";
import { initDatabase } from "./prisma_client";
import { startWorker } from "./worker/worker";

await initDatabase();
const worker = await startWorker();

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    logger.info({ signal }, "Shutting down");
    await worker.stop();
    process.exit(0);
  });
}
