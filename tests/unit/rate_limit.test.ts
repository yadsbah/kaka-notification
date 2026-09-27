import { describe, expect, test } from "bun:test";
import { takeRateLimit } from "../../src/utils/rate_limit.utils";

describe("Rate limit", () => {
  test("allows up to the limit per minute, then resets", () => {
    const now = 1_000_000;
    const results = Array.from({ length: 4 }, () => takeRateLimit("key-a", 3, now).allowed);
    expect(results).toEqual([true, true, true, false]);
    expect(takeRateLimit("key-a", 3, now + 30_000).retryAfterSeconds).toBe(30);
    expect(takeRateLimit("key-a", 3, now + 60_000).allowed).toBe(true);
    expect(takeRateLimit("key-b", 3, now).allowed).toBe(true);
  });
});
