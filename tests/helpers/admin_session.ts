import { api } from "./request";

export type AdminSession = { cookie: string; csrf: string };

export async function login(email: string, password: string) {
  const response = await api("POST", "/api/admin/auth/login", { body: { email, password } });
  const setCookie = response.headers.get("set-cookie") ?? "";
  return { ...response, setCookie, cookie: setCookie.split(";")[0] ?? "" };
}

export async function loginAs(email: string, password: string): Promise<AdminSession> {
  const response = await login(email, password);
  if (response.status !== 200) throw new Error(`Login failed: ${response.status} ${JSON.stringify(response.data)}`);
  return { cookie: response.cookie, csrf: response.data.csrfToken };
}

// Admin request with the session cookie and CSRF header, like the SPA sends.
export function adminApi(
  session: AdminSession,
  method: string,
  path: string,
  options: { body?: unknown; query?: Record<string, string | number | boolean | undefined>; csrf?: boolean } = {}
) {
  return api(method, `/api/admin${path}`, {
    body: options.body,
    query: options.query,
    headers: {
      cookie: session.cookie,
      ...(options.csrf === false ? {} : { "x-csrf-token": session.csrf }),
    },
  });
}
