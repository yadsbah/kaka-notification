import { databaseUrl } from "../src/utils/database_url.utils";

// Usage: bun run scripts/migrate.ts [deploy | dev --name x]
export const runMigrations = (args = ["deploy"]) => {
  const result = Bun.spawnSync(["bunx", "prisma", "migrate", ...args, "--schema=./prisma/schema"], {
    env: { ...process.env, DATABASE_URL: databaseUrl() },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error("Migration failed");
};

if (import.meta.main) {
  const args = process.argv.slice(2);
  runMigrations(args.length ? args : ["deploy"]);
}
