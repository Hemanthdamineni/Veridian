import { describe, it, expect } from "vitest";
import { generateApiKey, hashApiKey, constantTimeEqual } from "@/lib/api-key";

describe("API keys", () => {
  it("issues a key with a recognisable prefix", () => {
    const { key } = generateApiKey();
    expect(key.startsWith("vk_")).toBe(true);
    expect(key.length).toBeGreaterThan(20);
  });

  it("never issues the same key twice", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateApiKey().key));
    expect(keys.size).toBe(50);
  });

  it("hashes a key deterministically", () => {
    const { key, hash } = generateApiKey();
    expect(hashApiKey(key)).toBe(hash);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(key);
  });

  it("gives different hashes to different keys", () => {
    expect(generateApiKey().hash).not.toBe(generateApiKey().hash);
  });
});

describe("constantTimeEqual", () => {
  it("accepts equal strings", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
  });

  it("rejects different strings of the same length", () => {
    expect(constantTimeEqual("abc", "abd")).toBe(false);
  });

  it("rejects strings of different lengths", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "a")).toBe(false);
  });
});
