/**
 * Which configurations are unverifiable against a manufacturer spec page, and
 * why.
 *
 * A configuration is "unverified" when the catalog has no per-configuration
 * check against the manufacturer's own technical-spec page. That is not, by
 * itself, a defect: some manufacturers publish no per-configuration page,
 * some confirm only family-level fields, and some pages are impossible to
 * reach from the verification environment. The key is that each unverified
 * SKU carries a documented, machine-readable reason, so the audit and the
 * verification registry agree on why a row is unverified and the residue can
 * never silently grow.
 *
 * The map is keyed by `skuCode` (not the database id) so it survives a
 * database rebuild, exactly like `src/lib/allowlist.ts`.
 */

/** Why a configuration is unverifiable against a manufacturer spec page. */
export type UnverifiableReason =
  | "no_spec_page" // the manufacturer publishes no per-SKU spec page
  | "family_page_only" // the page confirms family-level fields but not this configuration
  | "bot_blocked" // the page is unreachable (Cloudflare or similar) from the verification environment
  | "page_retired"; // the spec page 404s or has moved

/**
 * The configurations that carry an unverified provenance tier, and the
 * documented reason each is unverifiable.
 *
 * Framework pages sit behind Cloudflare and are unreachable from the
 * verification environment, so Framework configurations are `bot_blocked`.
 * Apple confirms only family-level fields (display size, RAM, storage), so
 * Apple configurations are `family_page_only`. Lenovo, Dell, HP and ASUS now
 * have spec-page adapters and are deliberately absent from this map.
 */
export const UNVERIFIABLE_SKUS: Readonly<Record<string, UnverifiableReason>> = {
  // Framework — pages behind Cloudflare, unreachable from the verification env.
  "FRAPPG0000-71bb631e": "bot_blocked",
  "FRANQC0000-b4c10002": "bot_blocked",
  "FRANPJ0000-6116558f": "bot_blocked",
  "FRANQA0000-213e3935": "bot_blocked",
  "FRAPPA0000-7ca90848": "bot_blocked",

  // Apple — family-level only; the adapter confirms display size, RAM and
  // storage but reports the SKU-specific fields (part number, CPU, weight)
  // as unconfirmable rather than guessing.
  "MRXN3LL/A": "family_page_only",
  "MRXQ3LL/A": "family_page_only",
  "MC6X4LL/A": "family_page_only",
  "MX2E3LL/A": "family_page_only",
  "MX2H3LL/A": "family_page_only",
};

/**
 * The reason a configuration is unverifiable, or `null` when it is not in the
 * map (meaning it either has a spec-page adapter or has not been registered).
 */
export function unverifiableReasonForSku(skuCode: string): UnverifiableReason | null {
  return UNVERIFIABLE_SKUS[skuCode] ?? null;
}

/** Whether a configuration is registered as unverifiable for a reason. */
export function isUnverifiableSku(skuCode: string): boolean {
  return skuCode in UNVERIFIABLE_SKUS;
}