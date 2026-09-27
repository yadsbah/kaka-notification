import { PrismaClient } from "@prisma/client";
import { databaseUrl } from "./utils/database_url.utils";

const db = new PrismaClient({ datasourceUrl: databaseUrl() });

export const initDatabase = async () => {
  await db.$queryRawUnsafe("PRAGMA journal_mode=WAL");
  await db.$queryRawUnsafe("PRAGMA busy_timeout=5000");
  await db.$executeRawUnsafe("PRAGMA synchronous=NORMAL");
  await db.$executeRawUnsafe("PRAGMA foreign_keys=ON");

  // auto_vacuum only takes effect after a VACUUM; cheap on a fresh DB, done once.
  const [row] = await db.$queryRawUnsafe<{ auto_vacuum: bigint }[]>("PRAGMA auto_vacuum");
  if (Number(row?.auto_vacuum) !== 2) {
    await db.$executeRawUnsafe("PRAGMA auto_vacuum=INCREMENTAL");
    await db.$executeRawUnsafe("VACUUM");
  }
};

export default db;
