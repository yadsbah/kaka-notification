// Deletes old token results (FCM errors), webhook delivery logs, finished queue jobs and audit entries.
// Usage: bun run cleanup [--days 7] [--notifications]
//   --days N          age cutoff for everything above (default 7)
//   --notifications   also delete finished notifications older than N days (their counters go with them)
// Pending and processing jobs are never touched. Safe to run while the server is up.
import { runRetentionCleanupHelper } from "../src/helpers/retention/retention.helper";
import { initDatabase } from "../src/prisma_client";

const args = process.argv.slice(2);
const daysArg = args.includes("--days") ? args[args.indexOf("--days") + 1] : "7";
const days = Number(daysArg);
if (!Number.isInteger(days) || days < 1) {
  console.error("Usage: bun run cleanup [--days N] [--notifications]   (N is a whole number of days, at least 1)");
  process.exit(1);
}

await initDatabase();
const started = Date.now();
const removed = await runRetentionCleanupHelper({
  results: days,
  jobs: days,
  audit: days,
  ...(args.includes("--notifications") ? { notifications: days } : {}),
});

console.log(`Removed everything older than ${days} days in ${((Date.now() - started) / 1000).toFixed(1)}s:`);
console.table(removed);
