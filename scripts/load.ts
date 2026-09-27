// Load test against the mocked FCM: 50k tokens across 3 projects, 8 concurrent workers, random
// retryable/invalid failures. Asserts every token ends with exactly one final result and that no token
// was ever successfully delivered twice. Uses its own DB file: bun run load
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";

process.env.DATABASE_PATH = "./data/load-test.db";
process.env.RETRY_BACKOFF_SECONDS = "0";
process.env.PROJECT_CONCURRENCY = "4";
process.env.API_RATE_LIMIT_PER_MIN = "100000";
process.env.LOG_LEVEL = "silent";

const TOKENS_PER_PROJECT = [25_000, 15_000, 10_000];
const TOKENS_PER_REQUEST = 5_000;
const WORKERS = 8;

const file = resolve(process.env.DATABASE_PATH);
mkdirSync(dirname(file), { recursive: true });
for (const suffix of ["", "-wal", "-shm", "-journal"]) if (existsSync(file + suffix)) unlinkSync(file + suffix);

const { runMigrations } = await import("./migrate");
runMigrations(["deploy"]);
const { default: db, initDatabase } = await import("../src/prisma_client");
await initDatabase();
const { buildApp } = await import("../src/app");
const { createProjectHelper } = await import("../src/helpers/projects/projects.helper");
const { generateApiKey } = await import("../src/utils/api_key.utils");
const { encrypt } = await import("../src/utils/crypto.utils");
const { setFcmSender } = await import("../src/services/fcm.service");
const { claimJobHelper } = await import("../src/helpers/jobs/jobs.helper");
const { processJob } = await import("../src/worker/process_job");

// Fake FCM: 2% invalid, 5% fail retryably on their first attempt, small random latency.
const delivered = new Map<string, number>();
const failedOnce = new Set<string>();
setFcmSender(async (_project, message) => {
  await Bun.sleep(Math.random() * 20);
  const responses = message.tokens.map((token) => {
    const n = Number(token.split("-").pop());
    if (n % 50 === 0) return { success: false, error: { code: "messaging/registration-token-not-registered", message: "gone" } };
    if (n % 20 === 1 && !failedOnce.has(token)) {
      failedOnce.add(token);
      return { success: false, error: { code: "messaging/server-unavailable", message: "try later" } };
    }
    delivered.set(token, (delivered.get(token) ?? 0) + 1);
    return { success: true, messageId: `m-${token}` };
  });
  return { responses, successCount: 0, failureCount: 0 } as any;
});

const app = buildApp();
const started = performance.now();
const notificationIDs: string[] = [];
let expectedTokens = 0;

for (const [index, count] of TOKENS_PER_PROJECT.entries()) {
  const { key, publicID, hash } = generateApiKey();
  await createProjectHelper({
    name: `Load ${index}`,
    apiKeyPublicID: publicID,
    apiKeyHash: hash,
    credentialStatus: "OK",
    credentialEncrypted: encrypt("{}"),
  });
  for (let offset = 0; offset < count; offset += TOKENS_PER_REQUEST) {
    const tokens = Array.from({ length: Math.min(TOKENS_PER_REQUEST, count - offset) }, (_, i) => `p${index}-tok-${offset + i}`);
    const response = await app.handle(
      new Request("http://localhost/api/v1/notifications", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ tokens, notification: { title: "Load test" } }),
      })
    );
    if (response.status !== 202) throw new Error(`Enqueue failed: ${response.status} ${await response.text()}`);
    notificationIDs.push(((await response.json()) as { id: string }).id);
    expectedTokens += tokens.length;
  }
}
const enqueuedAt = performance.now();
console.log(`Enqueued ${expectedTokens} tokens in ${notificationIDs.length} notifications in ${((enqueuedAt - started) / 1000).toFixed(1)}s`);

let jobs = 0;
const worker = async (id: number) => {
  let idle = 0;
  while (idle < 3) {
    const job = await claimJobHelper(`wrk_load_${id}`);
    if (!job) {
      idle++;
      await Bun.sleep(50);
      continue;
    }
    idle = 0;
    await processJob(job, `wrk_load_${id}`);
    jobs++;
  }
};
await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i)));
const doneAt = performance.now();

const results = await db.tokenResult.count();
const notifications = await db.notification.findMany();
const duplicates = await db.$queryRawUnsafe<{ n: bigint }[]>(
  `SELECT COUNT(*) AS n FROM (SELECT "notificationID", "token" FROM "TokenResult" GROUP BY 1, 2 HAVING COUNT(*) > 1)`
);
const doubleDelivered = [...delivered.values()].filter((count) => count > 1).length;
const unfinished = notifications.filter((n) => !n.finishedAt || n.pendingCount !== 0);
const counterMismatch = notifications.filter((n) => n.successCount + n.invalidCount + n.failedCount !== n.uniqueTokens);
const totals = notifications.reduce(
  (acc, n) => ({ success: acc.success + n.successCount, invalid: acc.invalid + n.invalidCount, failed: acc.failed + n.failedCount }),
  { success: 0, invalid: 0, failed: 0 }
);

console.log(`Processed ${jobs} jobs with ${WORKERS} workers in ${((doneAt - enqueuedAt) / 1000).toFixed(1)}s`);
console.log(`Results: ${results} rows | success ${totals.success}, invalid ${totals.invalid}, failed ${totals.failed}`);

const checks: [string, boolean][] = [
  ["every token has exactly one final result", results === expectedTokens && Number(duplicates[0]?.n) === 0],
  ["no token delivered twice", doubleDelivered === 0],
  ["every notification finished with pending = 0", unfinished.length === 0],
  ["counters add up per notification", counterMismatch.length === 0],
  ["retryable tokens were retried and delivered", totals.failed === 0 && failedOnce.size > 0],
];
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
process.exit(checks.every(([, ok]) => ok) ? 0 : 1);
