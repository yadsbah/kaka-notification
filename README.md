# Notification Manager

A self-hosted gateway that takes push-notification requests from your backend servers, queues them in SQLite, and delivers them through Firebase Cloud Messaging (one Firebase project per registered project). An admin dashboard manages projects and shows every delivery result and error.

- **One process, one file.** Bun + Elysia API, the queue worker, and the Refine dashboard all run in one container. SQLite (WAL) is both the database and the job queue. No Redis.
- **Your servers never wait on FCM.** `POST /api/v1/notifications` validates, stores, chunks, and returns `202` in milliseconds. Workers send in the background.
- **Every token gets exactly one final result.** Success, invalid (delete it), or failed, with the FCM error code. Retries resend only the tokens that failed.

## Contents

- [Quick start](#quick-start)
- [Get the Firebase service account](#get-the-firebase-service-account)
- [Create a project and API key](#create-a-project-and-api-key)
- [Sending](#sending)
- [Reading results](#reading-results)
- [How delivery works](#how-delivery-works)
- [Configuration](#configuration)
- [Operations](#operations)
- [Development](#development)

## Quick start

### Docker

```bash
cp .env.example .env
# Set MASTER_KEY (openssl rand -base64 32), ADMIN_EMAIL and ADMIN_PASSWORD
docker compose up -d --build
```

Open `http://localhost:8080` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`. The database lives in the `notification-data` volume at `/data/app.db`. Put the service behind HTTPS (a reverse proxy such as Caddy or nginx) and keep `COOKIE_SECURE=true`.

### Local

Requires Bun 1.3+.

```bash
bun install
cp .env.example .env            # set MASTER_KEY; set COOKIE_SECURE=false for http://localhost
bun run db:deploy               # create/migrate the SQLite file
bun run build:web               # build the dashboard into web/dist
bun run dev                     # API + worker + dashboard on :8080
```

For dashboard development with hot reload, run `bun run dev:web` alongside `bun run dev` and open `http://localhost:5173` (it proxies `/api` to `:8080`).

> **`MASTER_KEY` encrypts every stored service-account file and webhook secret.** If you lose it you must re-upload each project's service account and rotate webhook secrets. Back it up separately from the database.

## Get the Firebase service account

For each app (Firebase project):

1. Open the [Firebase Console](https://console.firebase.google.com) and select the project.
2. Go to **Project settings → Service accounts**.
3. Click **Generate new private key** and confirm. A `.json` file downloads.
4. Upload that file on the project's page in the dashboard (drag it onto **Service account**).

The file is checked (`type: "service_account"`, `project_id`, `client_email`, a parseable `private_key`), encrypted with AES-256-GCM, and never shown again. The dashboard only displays `project_id` and `client_email`. Delete the downloaded copy once it's uploaded.

## Create a project and API key

1. **Projects → Create**: name, optional webhook URL (https), enabled.
2. On the project page, upload the service account.
3. Click **Generate API key** and copy it. It's shown once. The format is `nm_<publicId>_<secret>`, and only a SHA-256 hash is stored.
4. Optional: **Test send** with a device token. Leave **validate only** on to check the credential with FCM's `dryRun` without delivering anything.

**Rotate API key** issues a new key, and the old one stops working on its next request.

## Sending

```bash
curl -X POST https://notify.example.com/api/v1/notifications \
  -H "Authorization: Bearer $NOTIFY_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: order-123-created" \
  -d '{
    "tokens": ["fcm_token_1", "fcm_token_2"],
    "notification": { "title": "New order", "body": "Order #123 received", "imageUrl": "https://example.com/order.png" },
    "data": { "orderId": "123", "type": "order_created" },
    "android": { "priority": "high", "ttlSeconds": 3600, "collapseKey": "orders", "channelId": "orders" },
    "apns": { "sound": "default", "badge": 1 },
    "webpush": { "link": "https://example.com/orders/123" },
    "externalId": "order-123"
  }'
```

```json
{ "id": "ntf_…", "status": "queued", "totalTokens": 2, "uniqueTokens": 2, "jobs": 1 }
```

A copyable TypeScript client (`sendPush`, `getNotification`, `getInvalidTokens`, `verifyWebhook`) is in [`examples/client.ts`](examples/client.ts).

### Rules

| Rule | Detail |
|---|---|
| Auth | `Authorization: Bearer <key>`. `401` missing or invalid key, `403` project disabled, `429` over `API_RATE_LIMIT_PER_MIN` (with `Retry-After`), `409` project has no service account yet. |
| Content | `notification.title` or `notification.body`, or a non-empty `data` object. |
| `tokens` | 1 to `MAX_TOKENS_PER_REQUEST` non-blank strings. Whitespace is trimmed and duplicates removed (`totalTokens` vs `uniqueTokens`). |
| `data` | String values only (numbers and booleans are rejected, not converted). Reserved keys are rejected: `from`, `message_type`, `notification`, `collapse_key`, and anything starting with `google` or `gcm`. |
| URLs | `imageUrl` and `webpush.link` must be `https://`. |
| Android | `priority` is `high` or `normal`. `ttlSeconds` is 0 to 2,419,200 (28 days). |
| Size | The message without tokens must be ≤ 4096 bytes. The request body must be ≤ `MAX_BODY_SIZE`. |
| Strict schema | Unknown fields are a `400`, so a typo like `"titel"` never gets silently dropped. |

Validation errors look like this:

```json
{ "error": "Validation failed", "fields": [{ "path": "/data/from", "message": "\"from\" is reserved by FCM (…)" }] }
```

### Idempotency

Send an `Idempotency-Key` header, for example derived from your own event id. Within 24 hours, the same key with the same body returns the original notification with `200` and nothing is queued again. The same key with a different body returns `409`. Keys are scoped per project.

## Reading results

| Endpoint | Returns |
|---|---|
| `GET /api/v1/notifications/:id` | `status`, counters (`successCount`, `invalidCount`, `failedCount`, `pendingCount`), job summary, and an error breakdown by FCM code |
| `GET /api/v1/notifications/:id/invalid-tokens?limit=100&offset=0` | Tokens FCM reported as unregistered or invalid. **Delete these from your database.** |
| `POST /api/v1/notifications/:id/cancel` | Cancels pending jobs; jobs already sending finish |
| `GET /health` | No auth. Database, worker heartbeat, and queue depth. |

Status lifecycle: `queued → processing → completed | partially_failed | failed | canceled`.

- **completed**: every token was delivered or reported invalid. Invalid tokens aren't a system failure.
- **partially_failed**: some tokens ended as failed.
- **failed**: nothing was delivered.

### Webhook

If the project has a webhook URL, a `POST` is sent when a notification reaches its final status:

```json
{
  "event": "notification.finished",
  "id": "ntf_…", "externalId": "order-123", "projectId": "prj_…", "status": "completed",
  "totalTokens": 1200, "uniqueTokens": 1187, "successCount": 1150, "invalidCount": 37, "failedCount": 0,
  "invalidTokens": ["…"], "invalidTokensTruncated": false,
  "invalidTokensUrl": "https://notify.example.com/api/v1/notifications/ntf_…/invalid-tokens"
}
```

Headers:

- `X-Timestamp`: Unix seconds.
- `X-Signature`: `sha256=` followed by the hex HMAC-SHA256 of `"<X-Timestamp>.<raw body>"` using the project's webhook secret (regenerate it on the project page).

Verify with `verifyWebhook` in `examples/client.ts`, and reject old timestamps.

Delivery makes up to 4 attempts (the first try, then retries after 30 s, 2 min and 10 min). At most 1000 invalid tokens are inlined; beyond that `invalidTokensTruncated` is `true`, so page through `invalidTokensUrl`. Webhook failures never change the notification's status.

## How delivery works

- **Chunking.** Unique tokens are split into jobs of `CHUNK_SIZE` (default 200, max 500, which is FCM's hard limit). The notification and all its jobs are written in one transaction.
- **Queue.** Workers claim jobs with a single atomic `UPDATE … RETURNING`. A job holds a lease of `LEASE_SECONDS`. `PROJECT_CONCURRENCY` caps in-flight jobs per project, so one huge send can't starve the others.
- **Sending.** `sendEachForMulticast`, with one cached firebase-admin app per project. The cache is keyed by a fingerprint of the credential, so replacing a credential takes effect everywhere without a restart.

Every FCM error is classified in [`src/services/fcm_errors.service.ts`](src/services/fcm_errors.service.ts):

| Category | Examples | What happens |
|---|---|---|
| invalid token | `registration-token-not-registered`, `invalid-registration-token`, `invalid-argument` about the token | Final **invalid**; never retried; returned by `/invalid-tokens` and the webhook |
| retryable | `server-unavailable`, `internal-error`, `message-rate-exceeded`, `quota-exceeded`, ECONNRESET, ETIMEDOUT, HTTP/2 GOAWAY, `send_timeout` | Only the failed tokens go into a retry job, with backoff (`RETRY_BACKOFF_SECONDS` ±20% jitter, honouring `Retry-After`). After `MAX_ATTEMPTS` they are final **failed**. |
| config error | `mismatched-credential`, `third-party-auth-error`, `app/invalid-credential` | If **every** token in a job fails this way: the tokens are failed, the project is flagged "credential problem", and its other pending jobs **pause** (no attempts burned) until you upload a working credential or a validate-only test send succeeds. If only *some* tokens fail this way, only those tokens fail and the project keeps sending. |
| payload error | `payload-size-limit-exceeded`, `invalid-argument` about the body | The whole notification fails, including chunks not yet sent. Logged as an error, because validation should have caught it. |
| unknown | anything else | Retried like retryable; the raw error is logged |

**Crash safety.** A reaper runs every 30 s and at startup. It returns jobs whose lease expired to the queue with backoff, or fails them with `lease_expired` on their last attempt. A worker that comes back after its lease was reaped can't record results. The database has a unique `(notification, token)` result index, so a token can never be counted twice.

**Dashboard actions:**

- **Retry failed**: resends only tokens that ended *failed*, never *invalid* ones.
- **Requeue** a failed job, or **Fail** a stuck one.

All of these are recorded in the audit log.

## Configuration

All configuration comes from environment variables. See [`.env.example`](.env.example).

| Variable | Default | |
|---|---|---|
| `PORT` | `8080` | |
| `DATABASE_PATH` | `./data/app.db` | SQLite file (`/data/app.db` in Docker) |
| `MASTER_KEY` | **required** | 32 random bytes, base64 (`openssl rand -base64 32`). The app refuses to start if it's missing or weak. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | | Creates the first admin on first boot, only while no admin exists |
| `COOKIE_SECURE` | `true` | `false` only for plain-http local development |
| `SESSION_TTL_HOURS` | `12` | Admin session lifetime |
| `PUBLIC_URL` | | Base URL used for links in webhook payloads |
| `CHUNK_SIZE` | `200` | Tokens per job, 1–500 |
| `MAX_TOKENS_PER_REQUEST` | `100000` | |
| `MAX_BODY_SIZE` | `10mb` | |
| `WORKER_ENABLED` | `true` | Run the worker inside the API process |
| `WORKER_CONCURRENCY` | `4` | Jobs in parallel per process |
| `PROJECT_CONCURRENCY` | `2` | Max in-flight jobs per project, across all workers |
| `WORKER_POLL_MS` | `1000` | Idle poll interval |
| `LEASE_SECONDS` | `300` | Must exceed the worst-case time for one `sendEachForMulticast` |
| `SHUTDOWN_TIMEOUT_MS` | `30000` | How long SIGTERM waits for in-flight jobs |
| `MAX_ATTEMPTS` | `5` | |
| `RETRY_BACKOFF_SECONDS` | `30,120,600,1800,3600` | Per attempt; the last value repeats |
| `API_RATE_LIMIT_PER_MIN` | `60` | Per API key |
| `LOGIN_RATE_LIMIT_PER_MIN` | `10` | Per IP. Separately, accounts lock for 15 minutes after 5 failed logins. |
| `RESULT_RETENTION_DAYS` | `14` | Per-token results |
| `JOB_RETENTION_DAYS` | `30` | Finished jobs |
| `NOTIFICATION_RETENTION_DAYS` | `0` | `0` keeps notifications (with their counters) forever |
| `AUDIT_RETENTION_DAYS` | `90` | Admin audit log; `0` keeps it forever |
| `CLEANUP_INTERVAL_HOURS` | `24` | |
| `FCM_HTTP1` | `true` | firebase-admin's HTTP/1.1 transport. Keep it on under Bun: its HTTP/2 client trips FCM's `exceeded_max_concurrent_streams` on normal batch sizes. |
| `SEND_TIMEOUT_MS` | `60000` | A single FCM call that takes longer is abandoned and its tokens are retried, so a hung connection can't block a worker. Must be less than `LEASE_SECONDS`. |
| `LOG_LEVEL` | `info` | pino JSON logs. Tokens and credentials are never logged. |

## Operations

**Separate worker process.** Set `WORKER_ENABLED=false` on the API and run `bun run worker` (same image, same volume, command `bun run src/worker.ts`). Any number of worker processes can share the database file on the same host. SQLite is not safe on network filesystems, so keep the volume local.

**Health.** `GET /health` returns `200` with `worker.alive`, meaning some worker heartbeated in the last 30 s, plus queue depth. The dashboard **Overview** shows each worker as alive or dead.

**Backups.** Never copy the live `.db` file; WAL mode means it isn't consistent on its own. Use one of:

```bash
# online, consistent snapshot
sqlite3 /data/app.db ".backup '/backups/app-$(date +%F).db'"
```

- [Litestream](https://litestream.io) for continuous replication to S3-compatible storage: `litestream replicate /data/app.db s3://bucket/notification-manager`.

Back up `MASTER_KEY` separately; without it the encrypted service accounts in a restored database can't be read.

**Cleanup.** The worker prunes old data daily using the `*_RETENTION_DAYS` settings. To prune on demand, or from cron:

```bash
bun run cleanup                          # delete token results, webhook logs, finished jobs and audit entries older than 7 days
bun run cleanup --days 3                 # any cutoff, 1 day or more
bun run cleanup --days 7 --notifications # also delete finished notifications (and their counters) older than 7 days
```

Pending and processing jobs are never touched, and it's safe to run while the server is up. In Docker: `docker compose exec notification-manager bun run cleanup`.

**Shutdown.** On SIGTERM/SIGINT the API stops accepting requests, workers stop claiming, and in-flight jobs get `SHUTDOWN_TIMEOUT_MS` to finish. Anything unfinished is recovered by the reaper on the next start.

**Security notes:**

- Admin passwords use argon2id.
- The session cookie is `httpOnly`, `SameSite=Lax` and `Secure`; only its hash is stored.
- Every dashboard mutation needs the `X-CSRF-Token` header.
- Responses carry CSP, `X-Frame-Options` and HSTS headers.
- API keys are stored as SHA-256 hashes and compared in constant time.
- Service accounts and webhook secrets are AES-256-GCM encrypted.
- Tokens are masked in list views.
- All admin actions are in the audit log.

## Development

```
prisma/schema/*.prisma                 schema (one file per domain), prisma/migrations
src/models/<feature>/*.mo.ts           TypeBox validators
src/helpers/<feature>/*.helper.ts      all database access
src/endpoints/{api,admin}/…/*.router.ts  Elysia routes
src/services/                          FCM, error classification, webhooks
src/worker/                            claim → send → classify → settle, reaper, webhooks, cleanup
web/                                   Refine + Ant Design dashboard
tests/                                 bun:test against a real SQLite file; FCM is mocked
```

```bash
bun run test        # 188 tests: unit, API, admin, worker integration (fresh data/test.db per run)
bun run load        # 50k tokens × 3 projects × 8 workers against mocked FCM; asserts exactly one result per token
bun run db:dev -- --name <change>   # create a migration after editing prisma/schema
bun run create-admin <email> <password>
```

Tests refuse to run unless `DATABASE_PATH`'s file name contains `test`.
