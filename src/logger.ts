import pino from "pino";
import { config } from "./config";

export const logger = pino({
  level: config.logLevel,
  redact: ["credential", "privateKey", "private_key", "apiKey", "password", "tokens", "token"],
});

export const maskToken = (token: string) => `${token.slice(0, 8)}…`;
