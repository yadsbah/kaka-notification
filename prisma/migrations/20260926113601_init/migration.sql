-- CreateTable
CREATE TABLE "Admin" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "adminID" INTEGER NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Session_adminID_fkey" FOREIGN KEY ("adminID") REFERENCES "Admin" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "adminID" INTEGER,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetID" TEXT,
    "details" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_adminID_fkey" FOREIGN KEY ("adminID") REFERENCES "Admin" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectID" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "externalID" TEXT,
    "idempotencyKey" TEXT,
    "requestHash" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "uniqueTokens" INTEGER NOT NULL,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "pendingCount" INTEGER NOT NULL,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Notification_projectID_fkey" FOREIGN KEY ("projectID") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "credentialStatus" TEXT NOT NULL DEFAULT 'MISSING',
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "firebaseProjectID" TEXT,
    "clientEmail" TEXT,
    "credentialEncrypted" TEXT,
    "credentialError" TEXT,
    "apiKeyPublicID" TEXT,
    "apiKeyHash" TEXT,
    "apiKeyCreatedAt" DATETIME,
    "webhookUrl" TEXT,
    "webhookSecretEncrypted" TEXT,
    "lastError" TEXT,
    "lastErrorAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Job" (
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
    "runAfter" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

-- CreateTable
CREATE TABLE "TokenResult" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "jobID" TEXT,
    "notificationID" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "errorCategory" TEXT,
    "token" TEXT NOT NULL,
    "messageID" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "attempt" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TokenResult_jobID_fkey" FOREIGN KEY ("jobID") REFERENCES "Job" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "TokenResult_notificationID_fkey" FOREIGN KEY ("notificationID") REFERENCES "Notification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Worker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostname" TEXT NOT NULL,
    "pid" INTEGER NOT NULL,
    "jobsProcessed" INTEGER NOT NULL DEFAULT 0,
    "currentJobID" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "notificationID" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL,
    "statusCode" INTEGER,
    "responseSnippet" TEXT,
    "runAfter" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WebhookDelivery_notificationID_fkey" FOREIGN KEY ("notificationID") REFERENCES "Notification" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_email_key" ON "Admin"("email");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_projectID_createdAt_idx" ON "Notification"("projectID", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status");

-- CreateIndex
CREATE INDEX "Notification_externalID_idx" ON "Notification"("externalID");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_projectID_idempotencyKey_key" ON "Notification"("projectID", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Project_apiKeyPublicID_key" ON "Project"("apiKeyPublicID");

-- CreateIndex
CREATE INDEX "Job_status_runAfter_priority_idx" ON "Job"("status", "runAfter", "priority");

-- CreateIndex
CREATE INDEX "Job_projectID_status_idx" ON "Job"("projectID", "status");

-- CreateIndex
CREATE INDEX "Job_notificationID_idx" ON "Job"("notificationID");

-- CreateIndex
CREATE INDEX "Job_finishedAt_idx" ON "Job"("finishedAt");

-- CreateIndex
CREATE INDEX "TokenResult_notificationID_outcome_errorCode_idx" ON "TokenResult"("notificationID", "outcome", "errorCode");

-- CreateIndex
CREATE INDEX "TokenResult_createdAt_idx" ON "TokenResult"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TokenResult_notificationID_token_key" ON "TokenResult"("notificationID", "token");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_runAfter_idx" ON "WebhookDelivery"("status", "runAfter");

-- CreateIndex
CREATE INDEX "WebhookDelivery_notificationID_idx" ON "WebhookDelivery"("notificationID");
