import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "../config";

// Format: v1.<iv>.<authTag>.<ciphertext>, base64url parts. AES-256-GCM with a random 12-byte IV.
export const encrypt = (plain: string, key: Buffer = config.masterKey) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
};

export const decrypt = (payload: string, key: Buffer = config.masterKey) => {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== "v1" || !iv || !tag || ciphertext === undefined) throw new Error("Unsupported encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
};

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const randomToken = (size = 32) => randomBytes(size).toString("base64url");
