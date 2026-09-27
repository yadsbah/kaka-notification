process.env.BUN_ENV ??= "test";

import { assertSafeTestDatabase } from "./helpers/test-db-guard";

assertSafeTestDatabase();

const { resetTestDatabase } = await import("./helpers/reset-test-db");

await resetTestDatabase();
