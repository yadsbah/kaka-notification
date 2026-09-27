import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { parseMasterKey } from "../../src/config";
import { decrypt, encrypt } from "../../src/utils/crypto.utils";

describe("Credential encryption", () => {
  test("round-trips a service account file", () => {
    const plain = JSON.stringify({ type: "service_account", private_key: "-----BEGIN PRIVATE KEY-----\nabc\n" });
    const sealed = encrypt(plain);
    expect(sealed).not.toContain("private_key");
    expect(decrypt(sealed)).toBe(plain);
  });

  test("uses a fresh IV every time", () => {
    expect(encrypt("same")).not.toBe(encrypt("same"));
  });

  test("rejects tampered ciphertext", () => {
    const [v, iv, tag, ct] = encrypt("secret").split(".");
    const flipped = Buffer.from(ct!, "base64url");
    flipped[0]! ^= 1;
    expect(() => decrypt([v, iv, tag, flipped.toString("base64url")].join("."))).toThrow();
  });

  test("rejects the wrong key", () => {
    expect(() => decrypt(encrypt("secret"), randomBytes(32))).toThrow();
  });
});

describe("MASTER_KEY validation", () => {
  test("rejects missing, short and low-entropy keys", () => {
    expect(() => parseMasterKey(undefined)).toThrow("required");
    expect(() => parseMasterKey(Buffer.alloc(16, 7).toString("base64"))).toThrow("32 bytes");
    expect(() => parseMasterKey(Buffer.alloc(32, 7).toString("base64"))).toThrow("weak");
  });

  test("accepts a random 32-byte key", () => {
    expect(parseMasterKey(randomBytes(32).toString("base64")).length).toBe(32);
  });
});
