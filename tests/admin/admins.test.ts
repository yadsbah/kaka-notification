import { beforeAll, describe, expect, test } from "bun:test";
import { adminApi, login, loginAs, type AdminSession } from "../helpers/admin_session";
import { fixtures } from "../setup";

let session: AdminSession;

beforeAll(async () => {
  session = await loginAs(fixtures.adminEmail, fixtures.adminPassword);
});

describe("Admin admins", () => {
  test("add an admin, reject duplicates and weak passwords", async () => {
    const created = await adminApi(session, "POST", "/admins", { body: { email: "second@example.com", password: "second-password-1" } });
    expect(created.status).toBe(200);
    expect(created.data.passwordHash).toBeUndefined();
    expect((await adminApi(session, "POST", "/admins", { body: { email: "SECOND@example.com", password: "another-password" } })).status).toBe(409);
    expect((await adminApi(session, "POST", "/admins", { body: { email: "weak@example.com", password: "short" } })).status).toBe(400);

    const list = await adminApi(session, "GET", "/admins");
    expect(list.data.admins.map((a: { email: string }) => a.email)).toContain("second@example.com");
    expect(JSON.stringify(list.data)).not.toContain("passwordHash");
  });

  test("changing someone's password signs them out and the new password works", async () => {
    const { data: other } = await adminApi(session, "POST", "/admins", { body: { email: "third@example.com", password: "third-password-1" } });
    const theirSession = await loginAs("third@example.com", "third-password-1");

    await adminApi(session, "PATCH", `/admins/${other.id}/password`, { body: { password: "third-password-2" } });
    expect((await adminApi(theirSession, "GET", "/auth/me")).status).toBe(401);
    expect((await login("third@example.com", "third-password-1")).status).toBe(401);
    expect((await login("third@example.com", "third-password-2")).status).toBe(200);
  });

  test("changing your own password keeps the current session", async () => {
    const { data: me } = await adminApi(session, "GET", "/auth/me");
    const otherDevice = await loginAs(fixtures.adminEmail, fixtures.adminPassword);
    await adminApi(session, "PATCH", `/admins/${me.admin.id}/password`, { body: { password: fixtures.adminPassword } });
    expect((await adminApi(session, "GET", "/auth/me")).status).toBe(200);
    expect((await adminApi(otherDevice, "GET", "/auth/me")).status).toBe(401);
  });

  test("can't delete yourself; can delete others", async () => {
    const { data: me } = await adminApi(session, "GET", "/auth/me");
    expect((await adminApi(session, "DELETE", `/admins/${me.admin.id}`)).status).toBe(400);

    const { data: doomed } = await adminApi(session, "POST", "/admins", { body: { email: "doomed@example.com", password: "doomed-password-1" } });
    expect((await adminApi(session, "DELETE", `/admins/${doomed.id}`)).status).toBe(200);
    expect((await login("doomed@example.com", "doomed-password-1")).status).toBe(401);

    const audit = await adminApi(session, "GET", "/audit", { query: { targetType: "admin" } });
    const actions = audit.data.logs.map((log: { action: string }) => log.action);
    expect(actions).toContain("admin.created");
    expect(actions).toContain("admin.deleted");
  });
});
