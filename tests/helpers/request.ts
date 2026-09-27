import { getTestApp } from "./app";

type ApiOptions = {
  token?: string;
  body?: unknown;
  rawBody?: string;
  query?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
};

export async function api(method: string, path: string, options: ApiOptions = {}) {
  const app = getTestApp();
  const url = new URL(path, "http://localhost");

  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const response = await app.handle(
    new Request(url.toString(), {
      method,
      headers,
      body: options.rawBody ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
    })
  );

  const text = await response.text();
  let data: any = null;

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  return {
    status: response.status,
    headers: response.headers,
    data,
  };
}
