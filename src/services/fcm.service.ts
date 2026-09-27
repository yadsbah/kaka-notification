import { cert, deleteApp, initializeApp, type App } from "firebase-admin/app";
import { getMessaging, type BatchResponse, type MulticastMessage } from "firebase-admin/messaging";
import { config } from "../config";
import { logger } from "../logger";
import { decrypt, sha256 } from "../utils/crypto.utils";

export type FcmProject = { id: string; credentialEncrypted: string | null };
export type FcmSender = (project: FcmProject, message: MulticastMessage, dryRun?: boolean) => Promise<BatchResponse>;

export class CredentialError extends Error {
  code: string;
  constructor(code: "credential/missing" | "credential/parse-failed", message: string) {
    super(message);
    this.code = code;
  }
}

// One firebase-admin app per project, keyed by a fingerprint of the encrypted credential. Replacing the
// credential changes the fingerprint, so every process (API or standalone worker) rebuilds on its next send.
const apps = new Map<string, { app: App; fingerprint: string }>();

export const invalidateFcmApp = (projectID: string) => {
  const cached = apps.get(projectID);
  if (!cached) return;
  apps.delete(projectID);
  deleteApp(cached.app).catch((error) => logger.warn({ err: error, projectID }, "Failed to delete firebase app"));
};

const getFcmApp = (project: FcmProject) => {
  if (!project.credentialEncrypted) throw new CredentialError("credential/missing", "Project has no service account");
  const fingerprint = sha256(project.credentialEncrypted).slice(0, 16);
  const cached = apps.get(project.id);
  if (cached?.fingerprint === fingerprint) return cached.app;
  if (cached) invalidateFcmApp(project.id);

  let serviceAccount: { project_id: string; client_email: string; private_key: string };
  try {
    serviceAccount = JSON.parse(decrypt(project.credentialEncrypted));
  } catch (error) {
    throw new CredentialError("credential/parse-failed", `Stored service account can't be decrypted: ${(error as Error).message}`);
  }
  let app: App;
  try {
    app = initializeApp(
      {
        credential: cert({
          projectId: serviceAccount.project_id,
          clientEmail: serviceAccount.client_email,
          privateKey: serviceAccount.private_key,
        }),
        projectId: serviceAccount.project_id,
      },
      `${project.id}:${fingerprint}`
    );
  } catch (error) {
    throw new CredentialError("credential/parse-failed", `Service account rejected by firebase-admin: ${(error as Error).message}`);
  }
  apps.set(project.id, { app, fingerprint });
  return app;
};

const firebaseSender: FcmSender = async (project, message, dryRun = false) => {
  const messaging = getMessaging(getFcmApp(project));
  if (config.fcmHttp1) messaging.enableLegacyHttpTransport();
  return messaging.sendEachForMulticast(message, dryRun);
};

let sender: FcmSender = firebaseSender;

// Tests swap in a fake FCM; production never calls this.
export const setFcmSender = (next?: FcmSender) => {
  sender = next ?? firebaseSender;
};

export class SendTimeoutError extends Error {
  code = "send_timeout";
}

// A hung FCM call (e.g. a wedged HTTP/2 session) must never hold a worker slot forever: past
// SEND_TIMEOUT_MS the job is treated as a retryable failure and this project's firebase app (and its
// connections) is discarded so the retry starts clean. The abandoned call can't be cancelled; deleting the
// app closes its sockets.
export const sendMulticast: FcmSender = async (project, message, dryRun) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      invalidateFcmApp(project.id);
      reject(new SendTimeoutError(`FCM did not answer within ${config.sendTimeoutMs}ms`));
    }, config.sendTimeoutMs);
  });
  try {
    return await Promise.race([sender(project, message, dryRun), timeout]);
  } finally {
    clearTimeout(timer);
  }
};
