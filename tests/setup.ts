import { getFixtures, type TestFixtures } from "./helpers/seed";

export const fixtures: TestFixtures = new Proxy({} as TestFixtures, {
  get(_target, prop) {
    return getFixtures()[prop as keyof TestFixtures];
  },
});
