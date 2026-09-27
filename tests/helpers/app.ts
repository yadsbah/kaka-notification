import { buildApp } from "../../src/app";

let app: ReturnType<typeof buildApp> | null = null;

export function getTestApp() {
  if (!app) {
    app = buildApp();
  }
  return app;
}
