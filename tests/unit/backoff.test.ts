import { describe, expect, test } from "bun:test";
import { retryDelayMs } from "../../src/utils/backoff.utils";

const schedule = [30, 120, 600, 1800, 3600];
const mid = () => 0.5; // jitter factor exactly 1.0

describe("Retry backoff", () => {
  test("follows the schedule per attempt", () => {
    expect([1, 2, 3, 4, 5].map((a) => retryDelayMs(a, schedule, undefined, mid))).toEqual([
      30_000, 120_000, 600_000, 1_800_000, 3_600_000,
    ]);
  });

  test("repeats the last step past the end of the schedule", () => {
    expect(retryDelayMs(9, schedule, undefined, mid)).toBe(3_600_000);
  });

  test("jitter stays within ±20%", () => {
    expect(retryDelayMs(1, schedule, undefined, () => 0)).toBe(24_000);
    expect(retryDelayMs(1, schedule, undefined, () => 0.999999)).toBeLessThanOrEqual(36_000);
  });

  test("Retry-After wins only when longer", () => {
    expect(retryDelayMs(1, schedule, 90, mid)).toBe(90_000);
    expect(retryDelayMs(2, schedule, 5, mid)).toBe(120_000);
  });
});
