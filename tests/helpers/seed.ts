import { CredentialStatus } from "@prisma/client";
import { createAdminHelper } from "../../src/helpers/admins/admins.helper";
import { createProjectHelper } from "../../src/helpers/projects/projects.helper";
import { generateApiKey } from "../../src/utils/api_key.utils";
import { encrypt } from "../../src/utils/crypto.utils";

export type TestFixtures = {
  adminEmail: string;
  adminPassword: string;
  projectId: string;
  apiKey: string;
  otherProjectId: string;
  otherApiKey: string;
  disabledApiKey: string;
  noCredentialApiKey: string;
};

let cachedFixtures: TestFixtures | null = null;

// Synthetic service account; the worker tests replace the FCM sender, so it's never used against Google.
export const fakeServiceAccount = (projectID: string) => ({
  type: "service_account",
  project_id: projectID,
  client_email: `notify@${projectID}.iam.gserviceaccount.com`,
  private_key: "-----BEGIN PRIVATE KEY-----\nfake\n-----END PRIVATE KEY-----\n",
});

export async function createTestProject(
  name: string,
  options: { enabled?: boolean; credential?: boolean; webhookUrl?: string } = {}
) {
  const { key, publicID, hash } = generateApiKey();
  const firebaseProjectID = `${name.toLowerCase().replaceAll(" ", "-")}-fb`;
  const withCredential = options.credential ?? true;
  const project = await createProjectHelper({
    name,
    enabled: options.enabled ?? true,
    webhookUrl: options.webhookUrl,
    apiKeyPublicID: publicID,
    apiKeyHash: hash,
    apiKeyCreatedAt: new Date(),
    credentialStatus: withCredential ? CredentialStatus.OK : CredentialStatus.MISSING,
    credentialEncrypted: withCredential ? encrypt(JSON.stringify(fakeServiceAccount(firebaseProjectID))) : undefined,
    firebaseProjectID: withCredential ? firebaseProjectID : undefined,
    clientEmail: withCredential ? fakeServiceAccount(firebaseProjectID).client_email : undefined,
  });
  return { project, apiKey: key };
}

export async function seedTestDatabase(): Promise<TestFixtures> {
  cachedFixtures = null;

  const main = await createTestProject("Main App");
  const other = await createTestProject("Other App");
  const disabled = await createTestProject("Disabled App", { enabled: false });
  const noCredential = await createTestProject("No Credential App", { credential: false });

  const admin = { email: "admin@example.com", password: "correct-horse-battery" };
  await createAdminHelper(admin);

  cachedFixtures = {
    adminEmail: admin.email,
    adminPassword: admin.password,
    projectId: main.project.id,
    apiKey: main.apiKey,
    otherProjectId: other.project.id,
    otherApiKey: other.apiKey,
    disabledApiKey: disabled.apiKey,
    noCredentialApiKey: noCredential.apiKey,
  };
  return cachedFixtures;
}

export function getFixtures() {
  if (!cachedFixtures) throw new Error("Test fixtures not seeded; is tests/preload.ts configured?");
  return cachedFixtures;
}
