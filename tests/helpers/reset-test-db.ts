import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runMigrations } from "../../scripts/migrate";
import { initDatabase } from "../../src/prisma_client";
import { seedTestDatabase } from "./seed";
import { assertSafeTestDatabase } from "./test-db-guard";

// Fresh file per run: faster and simpler than truncating, and it proves migrations apply from zero.
export async function resetTestDatabase() {
  assertSafeTestDatabase();

  const file = resolve(process.cwd(), process.env.DATABASE_PATH!);
  mkdirSync(dirname(file), { recursive: true });
  for (const suffix of ["", "-wal", "-shm", "-journal"]) {
    if (existsSync(file + suffix)) unlinkSync(file + suffix);
  }

  console.log("[tests] Migrating test database...");
  runMigrations(["deploy"]);
  await initDatabase();

  console.log("[tests] Seeding test database...");
  return seedTestDatabase();
}
