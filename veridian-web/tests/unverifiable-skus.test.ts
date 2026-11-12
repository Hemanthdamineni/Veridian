import { describe, it, expect } from "vitest";
import {
  isUnverifiableSku,
  UNVERIFIABLE_SKUS,
  unverifiableReasonForSku,
  type UnverifiableReason,
} from "@/lib/verify/reasons";

/**
 * Unverifiable provenance, made machine-readable.
 *
 * The invariants below keep the map honest: a reason is always one of the
 * documented unions, a mapped SKU always resolves to its reason until a
 * future adapter confirms it, and a SKU that a page can confirm is never
 * present here. The unverified residue is explained, not silent.
 */

const REASONS: UnverifiableReason[] = [
  "no_spec_page",
  "family_page_only",
  "bot_blocked",
  "page_retired",
];

describe("UNVERIFIABLE_SKUS", () => {
  it("R1 — every reason is one of the documented machine-readable unions", () => {
    const entries = Object.entries(UNVERIFIABLE_SKUS);
    expect(entries.length).toBeGreaterThan(0);
    for (const [, reason] of entries) {
      expect(reason).toMatch(/^[a-z_]+$/);
      expect(REASONS).toContain(reason);
    }
  });

  it("R2 — a mapped SKU resolves to its reason, an unmapped one to null", () => {
    expect(unverifiableReasonForSku("FRAPPG0000-71bb631e")).toBe("bot_blocked");
    expect(unverifiableReasonForSku("MRXN3LL/A")).toBe("family_page_only");
    expect(unverifiableReasonForSku("21KC000UUS")).toBeNull();
    expect(unverifiableReasonForSku("does-not-exist")).toBeNull();
  });

  it("R3 — a SKU a page can confirm is never present in the map", () => {
    // Lenovo and Dell rows now have adapters that read a per-SKU page.
    expect(unverifiableReasonForSku("21KC000UUS")).toBeNull();
    expect(unverifiableReasonForSku("9440-1428SIL")).toBeNull();
    expect(isUnverifiableSku("21KC000UUS")).toBe(false);
    expect(isUnverifiableSku("9440-1428SIL")).toBe(false);
  });

  it("R4 — every Framework row carries bot_blocked", () => {
    for (const skuCode of Object.keys(UNVERIFIABLE_SKUS)) {
      if (skuCode.startsWith("FR")) {
        expect(unverifiableReasonForSku(skuCode)).toBe("bot_blocked");
        expect(isUnverifiableSku(skuCode)).toBe(true);
      }
    }
    // And at least one Framework row is present.
    expect(
      Object.entries(UNVERIFIABLE_SKUS).some(
        ([skuCode, reason]) => skuCode.startsWith("FR") && reason === "bot_blocked"
      )
    ).toBe(true);
  });
});