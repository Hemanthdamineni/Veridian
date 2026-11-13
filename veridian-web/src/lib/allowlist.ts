/**
 * Allowlist of catalog configurations whose provenance has no manufacturer
 * source URL to check the value against.
 *
 * A provenance record without a `sourceUrl` is a measurable gap, but a few
 * configurations can never carry one: their values come from the Veridian
 * reference dataset, which records no manufacturer page for these rows. For
 * those, the missing URL is an expected, documented property rather than a
 * surprise that should alarm an auditor.
 *
 * The allowlist is keyed by the stable `skuCode` (the same identifier the
 * seed and the catalog use) so it survives a database rebuild. Each entry
 * carries a machine-readable reason so downstream tooling can tell "this is
 * expected for a documented reason" from "this is an unexplained gap", and
 * so the audit and the assertion cannot drift about which rows are excused.
 *
 * A configuration that is NOT on this list and has no source URL is still a
 * real gap and must keep being reported.
 */

/**
 * The machine-readable reasons a configuration can be allowlisted for.
 *
 * Keep these codes stable: the audit and the assertion read them by value.
 * Extend the union (never rename existing codes) when a new reason appears.
 */
export type UnconfirmableReason =
  /** Value comes from the reference dataset, which records no manufacturer URL. */
  | "reference_dataset_unconfirmed";

/**
 * Configurations whose provenance record carries no manufacturer source URL
 * by design. The key is the `skuCode`; the value is why it is excused.
 */
export const UNCONFIRMABLE_SKUS: Readonly<Record<string, UnconfirmableReason>> = {
  "21KC000UUS": "reference_dataset_unconfirmed",
  "21KC000VUS": "reference_dataset_unconfirmed",
  "21M5000UUS": "reference_dataset_unconfirmed",
  "21M5000VUS": "reference_dataset_unconfirmed",
  "21M5000WUS": "reference_dataset_unconfirmed",
  "21MU000UUS": "reference_dataset_unconfirmed",
  "7440-7328BLU": "reference_dataset_unconfirmed",
  "7440-7329BLU": "reference_dataset_unconfirmed",
  "7450-2428SIL": "reference_dataset_unconfirmed",
  "7450-2429SIL": "reference_dataset_unconfirmed",
  "83A3000UUS": "reference_dataset_unconfirmed",
  "83A3000VUS": "reference_dataset_unconfirmed",
  "83DV000UUS": "reference_dataset_unconfirmed",
  "83FW000UUS": "reference_dataset_unconfirmed",
  "9440-1428SIL": "reference_dataset_unconfirmed",
  "9440-1429SIL": "reference_dataset_unconfirmed",
  "9440-1628BLU": "reference_dataset_unconfirmed",
  "9640-1628SIL": "reference_dataset_unconfirmed",
  "9G0Y0UA#ABA": "reference_dataset_unconfirmed",
  "9G0Y1UA#ABA": "reference_dataset_unconfirmed",
  "9G1B0UA#ABA": "reference_dataset_unconfirmed",
  "9G1D5UA#ABA": "reference_dataset_unconfirmed",
  "9G1D6UA#ABA": "reference_dataset_unconfirmed",
  "9G1F0UA#ABA": "reference_dataset_unconfirmed",
  "9W5X6UA#ABA": "reference_dataset_unconfirmed",
  "9W5X7UA#ABA": "reference_dataset_unconfirmed",
  "GA403UV-QS123WS": "reference_dataset_unconfirmed",
  "GA403UV-QS124WS": "reference_dataset_unconfirmed",
  "MC6X4LL/A": "reference_dataset_unconfirmed",
  "MRXN3LL/A": "reference_dataset_unconfirmed",
  "MRXQ3LL/A": "reference_dataset_unconfirmed",
  "MX2E3LL/A": "reference_dataset_unconfirmed",
  "MX2H3LL/A": "reference_dataset_unconfirmed",
  "S3407QA-MY123WS": "reference_dataset_unconfirmed",
  "S3507QA-MY123WS": "reference_dataset_unconfirmed",
  "UP3404VA-MY123WS": "reference_dataset_unconfirmed",
};

/**
 * The machine-readable reason a configuration is allowlisted for, or `null`
 * when the configuration is not allowlisted and any missing source URL is a
 * real gap.
 */
export function unconfirmableReasonForSku(skuCode: string): UnconfirmableReason | null {
  return UNCONFIRMABLE_SKUS[skuCode] ?? null;
}

/** True when the configuration is allowlisted for a documented reason. */
export function isAllowlistedSku(skuCode: string): boolean {
  return skuCode in UNCONFIRMABLE_SKUS;
}