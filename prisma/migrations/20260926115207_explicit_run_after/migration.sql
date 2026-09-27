-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "notificationID" TEXT NOT NULL,
    "projectID" TEXT NOT NULL,
    "parentJobID" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "chunkIndex" INTEGER NOT NULL,
    "tokens" JSONB NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL,
    "runAfter" DATETIME NOT NULL,
    "lockedBy" TEXT,
    "lockedUntil" DATETIME,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "durationMs" INTEGER,
    "lastErrorCode" TEXT,
    "lastErrorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Job_notificationID_fkey" FOREIGN KEY ("notificationID") REFERENCES "Notification" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_projectID_fkey" FOREIGN KEY ("projectID") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Job_parentJobID_fkey" FOREIGN KEY ("parentJobID") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Job" ("attempts", "chunkIndex", "createdAt", "durationMs", "finishedAt", "id", "lastErrorCode", "lastErrorMessage", "lockedBy", "lockedUntil", "maxAttempts", "notificationID", "parentJobID", "priority", "projectID", "runAfter", "startedAt", "status", "tokenCount", "tokens", "updatedAt") SELECT "attempts", "chunkIndex", "createdAt", "durationMs", "finishedAt", "id", "lastErrorCode", "lastErrorMessage", "lockedBy", "lockedUntil", "maxAttempts", "notificationID", "parentJobID", "priority", "projectID", "runAfter", "startedAt", "status", "tokenCount", "tokens", "updatedAt" FROM "Job";
DROP TABLE "Job";
ALTER TABLE "new_Job" RENAME TO "Job";
CREATE INDEX "Job_status_runAfter_priority_idx" ON "Job"("status", "runAfter", "priority");
CREATE INDEX "Job_projectID_status_idx" ON "Job"("projectID", "status");
CREATE INDEX "Job_notificationID_idx" ON "Job"("notificationID");
CREATE INDEX "Job_finishedAt_idx" ON "Job"("finishedAt");
CREATE TABLE "new_WebhookDelivery" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "notificationID" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL,
    "statusCode" INTEGER,
    "responseSnippet" TEXT,
    "runAfter" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebhookDelivery_notificationID_fkey" FOREIGN KEY ("notificationID") REFERENCES "Notification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WebhookDelivery" ("attempt", "createdAt", "id", "notificationID", "responseSnippet", "runAfter", "status", "statusCode", "updatedAt") SELECT "attempt", "createdAt", "id", "notificationID", "responseSnippet", "runAfter", "status", "statusCode", "updatedAt" FROM "WebhookDelivery";
DROP TABLE "WebhookDelivery";
ALTER TABLE "new_WebhookDelivery" RENAME TO "WebhookDelivery";
CREATE INDEX "WebhookDelivery_status_runAfter_idx" ON "WebhookDelivery"("status", "runAfter");
CREATE INDEX "WebhookDelivery_notificationID_idx" ON "WebhookDelivery"("notificationID");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
