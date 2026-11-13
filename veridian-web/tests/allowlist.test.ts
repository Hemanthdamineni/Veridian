import { describe, it, expect } from "vitest";
import {
  UNCONFIRMABLE_SKUS,
  isAllowlistedSku,
  unconfirmableReasonForSku,
  type UnconfirmableReason,
} from "@/lib/allowlist";

/**
 * The allowlist is the single source of truth for which configurations may
 * carry a provenance record with no manufacturer source URL. These tests pin
 * down the contract the audit and the `db:assert` both read from here, so a
 * re-seeded catalog or a new reference-dataset row cannot silently change
 * what is excused.
 */

describe("allowlist", () => {
  it("allowlists the 36 reference-dataset configurations that lack a manufacturer URL", () => {
    expect(Object.keys(UNCONFIRMABLE_SKUS)).toHaveLength(36);
  });

  it("gives every allowlisted configuration a machine-readable reason", () => {
    const reasons = Object.values(UNCONFIRMABLE_SKUS);
    expect(reasons.length).toBeGreaterThan(0);
    for (const reason of reasons) {
      expect(reason).toMatch(/^[a-z_]+$/);
    }
    expect(reasons.every((r) => r === "reference_dataset_unconfirmed")).toBe(true);
  });

  it("isAllowlistedSku is true exactly for entries in the allowlist", () => {
    const code = Object.keys(UNCONFIRMABLE_SKUS)[0];
    expect(isAllowlistedSku(code)).toBe(true);
    expect(isAllowlistedSku("no-such-sku-code")).toBe(false);
  });

  it("unconfirmableReasonForSku returns the reason or null", () => {
    const code = Object.keys(UNCONFIRMABLE_SKUS)[0];
    const reason: UnconfirmableReason | null = unconfirmableReasonForSku(code);
    expect(reason).toBe("reference_dataset_unconfirmed");

    expect(unconfirmableReasonForSku("no-such-sku-code")).toBeNull();
  });

  it("a configuration not allowlisted is a real gap, not an excused one", () => {
    expect(isAllowlistedSku("RB14250-01-4a2f6992")).toBe(false);
  });
});