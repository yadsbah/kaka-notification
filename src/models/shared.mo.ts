import { Prisma } from "@prisma/client";
import { t } from "elysia";

export const id = t.Numeric({
  minimum: 0,
  maximum: 1000000000,
  examples: [1, 2, 3],
});

export const prefixedID = (prefix: "prj" | "ntf" | "job") =>
  t.String({
    pattern: `^${prefix}_[a-f0-9]{32}$`,
    examples: [`${prefix}_0192f8a1c3b27d4e9f0a1b2c3d4e5f60`],
  });

export const name = t.String({
  minLength: 1,
  maxLength: 100,
  examples: ["Orders App", "Driver App"],
});

export const email = t.String({
  format: "email",
  maxLength: 255,
  examples: ["admin@example.com"],
});

export const password = t.String({
  minLength: 10,
  maxLength: 200,
});

export const httpsUrl = t.String({
  format: "uri",
  pattern: "^https://[^\\s]+$",
  maxLength: 2048,
  examples: ["https://example.com/image.png"],
});

export const search = t.String({
  minLength: 1,
  maxLength: 100,
});

export const externalID = t.String({
  minLength: 1,
  maxLength: 255,
  examples: ["order-123"],
});

export const offset = t.Numeric({
  minimum: 0,
  maximum: 1000000000,
  examples: [0, 50, 100],
});

export const limit = t.Numeric({
  minimum: 0,
  maximum: 1000,
  examples: [20, 50, 100],
});

export const dateType = t.String({
  format: "date-time",
  examples: ["2026-09-01T00:00:00Z"],
});

export const sortOrder = t.Enum(Prisma.SortOrder);

export const idSchema = t.Object({
  id,
});
