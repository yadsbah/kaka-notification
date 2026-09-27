import swagger from "@elysiajs/swagger";
import { buildApp } from "./app";
import { config } from "./config";
import { ensureInitialAdminHelper } from "./helpers/admins/admins.helper";
import { logger } from "./logger";
import { initDatabase } from "./prisma_client";
import { startWorker } from "./worker/worker";

await initDatabase();

const initialAdmin = await ensureInitialAdminHelper(config.adminEmail, config.adminPassword);
if (initialAdmin) logger.info({ email: initialAdmin.email }, "Created the first admin from ADMIN_EMAIL / ADMIN_PASSWORD");

const app = buildApp()
  .use(
    swagger({
      path: "/docs",
      scalarVersion: "1.24.8",
      exclude: [/^\/api\/admin/],
    })
  )
  .listen({ port: config.port, maxRequestBodySize: config.maxBodySize });

logger.info(`🦊 Notification manager on http://${app.server?.hostname}:${app.server?.port} (docs at /docs)`);

const worker = config.workerEnabled ? await startWorker() : null;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, async () => {
    logger.info({ signal }, "Shutting down");
    await app.stop();
    await worker?.stop();
    process.exit(0);
  });
}
