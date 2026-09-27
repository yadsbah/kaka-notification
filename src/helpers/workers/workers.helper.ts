import db from "../../prisma_client";

// A worker heartbeats every 10s; three missed beats = dead.
export const WORKER_ALIVE_MS = 30_000;

export const getWorkersHelper = async () => {
  try {
    const workers = await db.worker.findMany({ orderBy: [{ lastSeen: "desc" }, { id: "desc" }] });
    if (workers.length === 0) return null;
    return workers.map((worker) => ({
      ...worker,
      alive: Date.now() - worker.lastSeen.getTime() < WORKER_ALIVE_MS,
    }));
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const upsertWorkerHelper = async (params: {
  id: string;
  hostname: string;
  pid: number;
  jobsProcessed: number;
  currentJobID: string | null;
}) => {
  try {
    const now = new Date();
    return await db.worker.upsert({
      where: { id: params.id },
      create: { ...params, startedAt: now, lastSeen: now },
      update: { jobsProcessed: params.jobsProcessed, currentJobID: params.currentJobID, lastSeen: now },
    });
  } catch (error) {
    console.error(error);
    throw error;
  }
};

export const deleteWorkerHelper = async (id: string) => {
  try {
    await db.worker.deleteMany({ where: { id } });
  } catch (error) {
    console.error(error);
    throw error;
  }
};
