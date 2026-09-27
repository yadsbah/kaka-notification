import { describe, expect, test } from "bun:test";
import { chunkTokens, normalizeTokens } from "../../src/utils/chunk.utils";

const tokens = (n: number) => Array.from({ length: n }, (_, i) => `t${i}`);

describe("Chunking", () => {
  const cases: [number, number[]][] = [
    [0, []],
    [1, [1]],
    [199, [199]],
    [200, [200]],
    [201, [200, 1]],
    [500, [200, 200, 100]],
  ];

  for (const [count, sizes] of cases) {
    test(`${count} tokens at 200 → ${sizes.length} chunks`, () => {
      expect(chunkTokens(tokens(count), 200).map((c) => c.length)).toEqual(sizes);
    });
  }

  test("100k tokens → 500 chunks, every token exactly once, in order", () => {
    const input = tokens(100_000);
    const chunks = chunkTokens(input, 200);
    expect(chunks).toHaveLength(500);
    expect(chunks.flat()).toEqual(input);
  });

  test("never exceeds the FCM limit of 500", () => {
    expect(chunkTokens(tokens(1000), 500).every((c) => c.length === 500)).toBe(true);
    expect(() => chunkTokens(tokens(10), 501)).toThrow();
    expect(() => chunkTokens(tokens(10), 0)).toThrow();
  });

  test("normalizeTokens trims and dedupes, keeping first-seen order", () => {
    expect(normalizeTokens([" a", "b ", "a", "c", "b"])).toEqual(["a", "b", "c"]);
  });
});
