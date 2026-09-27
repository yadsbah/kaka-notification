import type { AuthProvider } from "@refinedev/core";
import { api, setCsrfToken, type ApiError } from "./api";

type Me = { admin: { id: number; email: string }; csrfToken: string };

export const authProvider: AuthProvider = {
  login: async ({ email, password }) => {
    try {
      const me = await api<Me>("POST", "/api/admin/auth/login", { body: { email, password } });
      setCsrfToken(me.csrfToken);
      return { success: true, redirectTo: "/" };
    } catch (error) {
      return { success: false, error: { name: "Sign in failed", message: (error as Error).message } };
    }
  },

  logout: async () => {
    await api("POST", "/api/admin/auth/logout").catch(() => undefined);
    setCsrfToken(null);
    return { success: true, redirectTo: "/login" };
  },

  // Also how a page reload gets the CSRF token back: it only lives in memory.
  check: async () => {
    try {
      const me = await api<Me>("GET", "/api/admin/auth/me");
      setCsrfToken(me.csrfToken);
      return { authenticated: true };
    } catch {
      return { authenticated: false, redirectTo: "/login", logout: true };
    }
  },

  getIdentity: async () => {
    try {
      const me = await api<Me>("GET", "/api/admin/auth/me");
      return { id: me.admin.id, name: me.admin.email };
    } catch {
      return null;
    }
  },

  onError: async (error: ApiError) => {
    if (error?.statusCode === 401) return { logout: true, redirectTo: "/login" };
    return {};
  },
};
