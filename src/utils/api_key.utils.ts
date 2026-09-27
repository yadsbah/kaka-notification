import { randomBytes } from "node:crypto";
import { randomToken, safeEqual, sha256 } from "./crypto.utils";

const API_KEY_PATTERN = /^nm_([a-f0-9]{16})_([A-Za-z0-9_-]{43})$/;

export const generateApiKey = () => {
  const publicID = randomBytes(8).toString("hex");
  const key = `nm_${publicID}_${randomToken(32)}`;
  return { key, publicID, hash: sha256(key) };
};

export const parseApiKeyPublicID = (key: string) => key.match(API_KEY_PATTERN)?.[1] ?? null;

export const verifyApiKey = (key: string, hash: string) => safeEqual(sha256(key), hash);
