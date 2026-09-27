import { basename } from "node:path";

export function assertSafeTestDatabase() {
  const databasePath = process.env.DATABASE_PATH;

  if (!databasePath) {
    throw new Error("Safety guard: DATABASE_PATH is not set. Refusing to run tests/seed/reset.");
  }

  if (!basename(databasePath).toLowerCase().includes("test")) {
    throw new Error(
      `Safety guard: refusing to run tests/seed/reset because database file name does not include "test". DB="${databasePath}".`
    );
  }
}
