import { describe, expect, test } from "bun:test";
import { generateApiKey, parseApiKeyPublicID, verifyApiKey } from "../../src/utils/api_key.utils";

describe("API keys", () => {
  test("generates nm_<publicId>_<secret> and stores only a hash", () => {
    const { key, publicID, hash } = generateApiKey();
    expect(key).toMatch(/^nm_[a-f0-9]{16}_[A-Za-z0-9_-]{43}$/);
    expect(parseApiKeyPublicID(key)).toBe(publicID);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(key.split("_")[2]!);
  });

  test("verifies the right key and rejects others", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(verifyApiKey(a.key, a.hash)).toBe(true);
    expect(verifyApiKey(b.key, a.hash)).toBe(false);
    expect(verifyApiKey(a.key.slice(0, -1) + "x", a.hash)).toBe(false);
  });

  test("rejects malformed keys", () => {
    for (const bad of ["", "nm_", "nm_xyz_abc", "sk_0123456789abcdef_" + "a".repeat(43), "nm_0123456789abcdef_short"]) {
      expect(parseApiKeyPublicID(bad)).toBeNull();
    }
  });
});
