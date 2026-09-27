import { createPrivateKey } from "node:crypto";
import type { FieldError } from "./notification_rules.utils";

export type ServiceAccount = {
  type: "service_account";
  project_id: string;
  client_email: string;
  private_key: string;
  [key: string]: unknown;
};

// Validates the file downloaded from Firebase Console → Project settings → Service accounts.
export const parseServiceAccount = (text: string): { account: ServiceAccount } | { errors: FieldError[] } => {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text);
  } catch {
    return { errors: [{ path: "/serviceAccount", message: "File is not valid JSON" }] };
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { errors: [{ path: "/serviceAccount", message: "File must be a JSON object" }] };
  }

  const errors: FieldError[] = [];
  if (json.type !== "service_account") {
    errors.push({ path: "/serviceAccount/type", message: 'Expected "type": "service_account"' });
  }
  for (const field of ["project_id", "client_email", "private_key"] as const) {
    if (typeof json[field] !== "string" || (json[field] as string).trim() === "") {
      errors.push({ path: `/serviceAccount/${field}`, message: `Missing ${field}` });
    }
  }
  if (typeof json.client_email === "string" && !json.client_email.includes("@")) {
    errors.push({ path: "/serviceAccount/client_email", message: "client_email is not an email address" });
  }
  if (typeof json.private_key === "string" && errors.length === 0) {
    try {
      createPrivateKey(json.private_key);
    } catch {
      errors.push({ path: "/serviceAccount/private_key", message: "private_key is not a valid PEM private key" });
    }
  }
  return errors.length > 0 ? { errors } : { account: json as ServiceAccount };
};
