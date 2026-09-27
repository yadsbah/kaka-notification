import { resolve } from "node:path";

// Prisma resolves relative sqlite paths against the schema folder, so always hand it an absolute one.
// connection_limit=1: one connection per process, so PRAGMAs set on boot stick and in-process writers never contend.
export const databaseUrl = () =>
  `file:${resolve(process.cwd(), Bun.env.DATABASE_PATH || "./data/app.db")}?connection_limit=1&socket_timeout=5`;
