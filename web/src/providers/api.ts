// The one fetch wrapper: sends the session cookie, attaches the CSRF token to mutations,
// and turns `{ error, fields }` responses into Refine-shaped HttpErrors.
let csrfToken: string | null = null;

export const setCsrfToken = (token: string | null) => {
  csrfToken = token;
};

export type ApiError = Error & { statusCode: number; errors?: Record<string, string[]> };

type Query = Record<string, string | number | boolean | undefined | null>;

export const buildUrl = (path: string, query?: Query) => {
  const url = new URL(path, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.pathname + url.search;
};

export async function api<T = any>(method: string, path: string, options: { body?: unknown; query?: Query } = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && csrfToken) headers["x-csrf-token"] = csrfToken;

  const response = await fetch(buildUrl(path, options.query), {
    method,
    headers,
    credentials: "same-origin",
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.error ?? response.statusText) as ApiError;
    error.statusCode = response.status;
    if (Array.isArray(data?.fields)) {
      error.errors = {};
      for (const field of data.fields as { path: string; message: string }[]) {
        const key = field.path.replace(/^\//, "").split("/")[0] || "form";
        (error.errors[key] ??= []).push(field.message);
      }
      error.message = `${error.message}: ${data.fields.map((f: { message: string }) => f.message).join("; ")}`;
    }
    throw error;
  }
  return data as T;
}
