const WINDOW_MS = 60_000;
// ponytail: in-memory fixed window per process; move to a SQLite table if you run several API processes.
const windows = new Map<string, { start: number; count: number }>();

export const takeRateLimit = (key: string, limitPerMinute: number, now = Date.now()) => {
  let window = windows.get(key);
  if (!window || now - window.start >= WINDOW_MS) {
    window = { start: now, count: 0 };
    windows.set(key, window);
  }
  window.count++;
  return {
    allowed: window.count <= limitPerMinute,
    retryAfterSeconds: Math.ceil((window.start + WINDOW_MS - now) / 1000),
  };
};
