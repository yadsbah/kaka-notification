import { describe, expect, test } from "bun:test";
import { createAdminHelper } from "../../src/helpers/admins/admins.helper";
import { adminApi, login, loginAs } from "../helpers/admin_session";
import { api } from "../helpers/request";
import { fixtures } from "../setup";

describe("Admin auth", () => {
  const protectedRoutes: [string, string][] = [
    ["GET", "/api/admin/auth/me"],
    ["POST", "/api/admin/auth/logout"],
    ["GET", "/api/admin/overview"],
    ["GET", "/api/admin/projects"],
    ["POST", "/api/admin/projects"],
    ["GET", "/api/admin/projects/prj_00000000000000000000000000000000"],
    ["PATCH", "/api/admin/projects/prj_00000000000000000000000000000000"],
    ["DELETE", "/api/admin/projects/prj_00000000000000000000000000000000"],
    ["PUT", "/api/admin/projects/prj_00000000000000000000000000000000/credential"],
    ["POST", "/api/admin/projects/prj_00000000000000000000000000000000/api-key"],
    ["POST", "/api/admin/projects/prj_00000000000000000000000000000000/webhook-secret"],
    ["POST", "/api/admin/projects/prj_00000000000000000000000000000000/test-send"],
    ["GET", "/api/admin/notifications"],
    ["POST", "/api/admin/notifications"],
    ["GET", "/api/admin/notifications/ntf_00000000000000000000000000000000"],
    ["GET", "/api/admin/notifications/ntf_00000000000000000000000000000000/results"],
    ["GET", "/api/admin/notifications/ntf_00000000000000000000000000000000/invalid-tokens.csv"],
    ["POST", "/api/admin/notifications/ntf_00000000000000000000000000000000/cancel"],
    ["POST", "/api/admin/notifications/ntf_00000000000000000000000000000000/retry-failed"],
    ["GET", "/api/admin/jobs"],
    ["POST", "/api/admin/jobs/job_00000000000000000000000000000000/requeue"],
    ["POST", "/api/admin/jobs/job_00000000000000000000000000000000/fail"],
    ["GET", "/api/admin/admins"],
    ["POST", "/api/admin/admins"],
    ["PATCH", "/api/admin/admins/1/password"],
    ["DELETE", "/api/admin/admins/1"],
    ["GET", "/api/admin/audit"],
  ];

  for (const [method, path] of protectedRoutes) {
    test(`${method} ${path} returns 401 without a session`, async () => {
      const { status } = await api(method, path, { body: method === "GET" ? undefined : {} });
      expect(status).toBe(401);
    });
  }

  test("login sets an httpOnly, SameSite=Lax session cookie and returns a CSRF token", async () => {
    const { status, data, setCookie } = await login(fixtures.adminEmail, fixtures.adminPassword);
    expect(status).toBe(200);
    expect(data.csrfToken).toBeString();
    expect(setCookie).toContain("nm_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Expires=");
  });

  test("emails are case-insensitive", async () => {
    const { status } = await login(fixtures.adminEmail.toUpperCase(), fixtures.adminPassword);
    expect(status).toBe(200);
  });

  test("wrong password and unknown email both return 401 with the same message", async () => {
    const wrong = await login(fixtures.adminEmail, "wrong-password-123");
    const unknown = await login("nobody@example.com", "whatever-12345");
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.data.error).toBe(unknown.data.error);
  });

  test("locks the account after 5 failed attempts, even for the right password", async () => {
    await createAdminHelper({ email: "lockme@example.com", password: "right-password-1" });
    for (let i = 0; i < 5; i++) await login("lockme@example.com", "wrong-password-1");
    const { status } = await login("lockme@example.com", "right-password-1");
    expect(status).toBe(429);
  });

  test("mutations need the CSRF header; reads don't", async () => {
    const session = await loginAs(fixtures.adminEmail, fixtures.adminPassword);
    expect((await adminApi(session, "GET", "/projects", { csrf: false })).status).toBe(200);
    expect((await adminApi(session, "POST", "/projects", { body: { name: "No CSRF" }, csrf: false })).status).toBe(403);
    const wrong = await adminApi({ ...session, csrf: "forged" }, "POST", "/projects", { body: { name: "Forged" } });
    expect(wrong.status).toBe(403);
    expect((await adminApi(session, "POST", "/projects", { body: { name: "With CSRF" } })).status).toBe(200);
  });

  test("GET /auth/me returns the admin and the CSRF token", async () => {
    const session = await loginAs(fixtures.adminEmail, fixtures.adminPassword);
    const { status, data } = await adminApi(session, "GET", "/auth/me");
    expect(status).toBe(200);
    expect(data).toMatchObject({ admin: { email: fixtures.adminEmail }, csrfToken: session.csrf });
    expect(data.admin.passwordHash).toBeUndefined();
  });

  test("logout ends the session", async () => {
    const session = await loginAs(fixtures.adminEmail, fixtures.adminPassword);
    expect((await adminApi(session, "POST", "/auth/logout")).status).toBe(200);
    expect((await adminApi(session, "GET", "/auth/me")).status).toBe(401);
  });

  test("responses carry security headers", async () => {
    const { headers } = await api("GET", "/health");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("content-security-policy")).toContain("default-src 'self'");
  });
});
