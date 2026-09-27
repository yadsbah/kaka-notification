const int = (name: string, fallback: number, min: number, max: number) => {
  const raw = Bun.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Config: ${name} must be an integer between ${min} and ${max}`);
  }
  return value;
};

const bool = (name: string, fallback: boolean) => {
  const raw = Bun.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "true" || raw === "1";
};

const bytes = (name: string, fallback: string) => {
  const raw = (Bun.env[name] || fallback).toLowerCase().trim();
  const match = raw.match(/^(\d+)(b|kb|mb)?$/);
  if (!match) throw new Error(`Config: ${name} must look like 10mb, 512kb or 1048576`);
  const unit = { b: 1, kb: 1024, mb: 1024 * 1024 }[(match[2] ?? "b") as "b" | "kb" | "mb"];
  return Number(match[1]) * unit;
};

const intList = (name: string, fallback: string) => {
  const values = (Bun.env[name] || fallback).split(",").map((v) => Number(v.trim()));
  if (values.length === 0 || values.some((v) => !Number.isInteger(v) || v < 0)) {
    throw new Error(`Config: ${name} must be a comma separated list of seconds`);
  }
  return values;
};

// MASTER_KEY encrypts service-account files and webhook secrets. Generate with: openssl rand -base64 32
export const parseMasterKey = (raw: string | undefined) => {
  if (!raw) throw new Error("Config: MASTER_KEY is required (openssl rand -base64 32)");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("Config: MASTER_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)");
  }
  if (new Set(key).size < 16) {
    throw new Error("Config: MASTER_KEY is too weak, generate a random one (openssl rand -base64 32)");
  }
  return key;
};

export const config = {
  port: int("PORT", 8080, 1, 65535),
  masterKey: parseMasterKey(Bun.env.MASTER_KEY),
  adminEmail: Bun.env.ADMIN_EMAIL,
  adminPassword: Bun.env.ADMIN_PASSWORD,
  cookieSecure: bool("COOKIE_SECURE", true),
  sessionTtlHours: int("SESSION_TTL_HOURS", 12, 1, 24 * 30),
  publicUrl: Bun.env.PUBLIC_URL || "",
  chunkSize: int("CHUNK_SIZE", 200, 1, 500),
  maxTokensPerRequest: int("MAX_TOKENS_PER_REQUEST", 100_000, 1, 1_000_000),
  maxBodySize: bytes("MAX_BODY_SIZE", "10mb"),
  workerEnabled: bool("WORKER_ENABLED", true),
  workerConcurrency: int("WORKER_CONCURRENCY", 4, 1, 64),
  projectConcurrency: int("PROJECT_CONCURRENCY", 2, 1, 64),
  workerPollMs: int("WORKER_POLL_MS", 1000, 10, 60_000),
  leaseSeconds: int("LEASE_SECONDS", 300, 10, 3600),
  shutdownTimeoutMs: int("SHUTDOWN_TIMEOUT_MS", 30_000, 0, 600_000),
  maxAttempts: int("MAX_ATTEMPTS", 5, 1, 20),
  retryBackoffSeconds: intList("RETRY_BACKOFF_SECONDS", "30,120,600,1800,3600"),
  apiRateLimitPerMin: int("API_RATE_LIMIT_PER_MIN", 60, 1, 100_000),
  loginRateLimitPerMin: int("LOGIN_RATE_LIMIT_PER_MIN", 10, 1, 100_000),
  resultRetentionDays: int("RESULT_RETENTION_DAYS", 14, 1, 3650),
  jobRetentionDays: int("JOB_RETENTION_DAYS", 30, 1, 3650),
  notificationRetentionDays: int("NOTIFICATION_RETENTION_DAYS", 0, 0, 36500),
  auditRetentionDays: int("AUDIT_RETENTION_DAYS", 90, 0, 36500),
  cleanupIntervalHours: int("CLEANUP_INTERVAL_HOURS", 24, 1, 24 * 30),
  // HTTP/1.1 by default: under Bun, firebase-admin's HTTP/2 transport opens every request in a batch at
  // once and FCM answers 200-token batches with GOAWAY exceeded_max_concurrent_streams.
  fcmHttp1: bool("FCM_HTTP1", true),
  sendTimeoutMs: int("SEND_TIMEOUT_MS", 60_000, 100, 3_600_000),
  logLevel: Bun.env.LOG_LEVEL || "info",
};

// A send that outlives its lease would be reaped and resent while still in flight.
if (config.sendTimeoutMs >= config.leaseSeconds * 1000) {
  throw new Error("Config: SEND_TIMEOUT_MS must be shorter than LEASE_SECONDS");
}
