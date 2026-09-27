import Elysia from "elysia";
import { getQueueDepthHelper } from "../helpers/jobs/jobs.helper";
import { getWorkersHelper } from "../helpers/workers/workers.helper";
import db from "../prisma_client";

const healthRouter = new Elysia({
  tags: ["Health"],
}).get("/health", async ({ set }) => {
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    set.status = 503;
    return { status: "error", database: false };
  }
  const workers = (await getWorkersHelper()) ?? [];
  const alive = workers.filter((worker) => worker.alive);
  return {
    status: "ok",
    database: true,
    worker: {
      alive: alive.length > 0,
      aliveCount: alive.length,
      lastHeartbeat: workers[0]?.lastSeen ?? null,
    },
    queue: await getQueueDepthHelper(),
  };
});

export default healthRouter;
