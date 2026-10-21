/**
 * Contracts for manufacturer-specification verification (ADR-005).
 *
 * The reference dataset in `data/laptops.csv` holds real, purchasable retail
 * part numbers. This module defines the vocabulary the verification tool uses
 * to compare those rows against the manufacturer's own technical-specification
 * page.
 *
 * The rule the whole module exists to enforce:
 *
 *   A field is compared only when the manufacturer states a SINGLE unambiguous
 *   value for it. A manufacturer page cell frequently lists several options
 *   for a family (several memory sizes, several displays). Such a cell is
 *   ambiguous, and an ambiguous cell can never be used to claim that a
 *   reference row is wrong. Only an unambiguous single value that disagrees
 *   with the reference row is a contradiction.
 *
 * A page that cannot be reached is never a pass and never a failure: it is
 * unconfirmed.
 */

/** The reference-dataset fields this tool reads and can correct. */
export type VerifiedField =
  | "cpu_model"
  | "ram_gb"
  | "ram_type"
  | "storage_gb"
  | "display_size"
  | "display_resolution"
  | "display_type"
  | "display_refresh"
  | "display_nits"
  | "weight_kg"
  | "battery_wh";

/** Every field the tool knows how to read, in report order. */
export const VERIFIED_FIELDS: readonly VerifiedField[] = [
  "cpu_model",
  "ram_gb",
  "ram_type",
  "storage_gb",
  "display_size",
  "display_resolution",
  "display_type",
  "display_refresh",
  "display_nits",
  "weight_kg",
  "battery_wh",
];

/**
 * A single value the manufacturer states for a field.
 *
 * `value` is already in the shape the reference dataset uses, so a confirmed
 * value can be written back without further translation.
 */
export interface ObservedValue {
  /** The reference-dataset field this value belongs to. */
  field: VerifiedField;
  /** The value, formatted the way the dataset stores it. */
  value: string;
}

/** The values a single configuration column states, when each is unambiguous. */
export type ObservedFields = Partial<Record<VerifiedField, string>>;

/**
 * One configuration column of a manufacturer specification table.
 *
 * A column is a configuration the manufacturer sells under one part number.
 * `values` maps a row title ("Display", "Weight", ...) to the text published
 * for that column; the text may list several options, in which case the
 * fields derived from it are ambiguous and are not reported.
 */
export interface SpecColumn {
  /** The manufacturer part number this column is published under. */
  name: string;
  /** Row title -> published text, for this column only. */
  values: Record<string, string>;
}

/** A manufacturer specification table, parsed from a real page. */
export interface SpecTable {
  /** The page the table was read from. */
  sourceUrl: string;
  /**
   * The configuration columns, left to right.
   *
   * The same part number may appear more than once: a manufacturer publishes
   * several configurations under one family code. The columns are kept
   * distinct so that a processor can still tell them apart.
   */
  columns: SpecColumn[];
  /**
   * Whether the table identifies its columns by manufacturer part number.
   *
   * A manufacturer that publishes a specification table without part numbers
   * (Apple labels its columns "Model 1", "Model 2", ...) cannot be used to
   * select the column that describes a reference row.
   */
  hasPartNumbers: boolean;
}

/** One reference row of `data/laptops.csv`. */
export interface ReferenceRow {
  sku_code: string;
  manufacturer: string;
  series: string;
  model: string;
  cpu_model: string;
  ram_gb: string;
  ram_type: string;
  storage_gb: string;
  display_size: string;
  display_resolution: string;
  display_type: string;
  display_refresh: string;
  display_nits: string;
  weight_kg: string;
  battery_wh: string;
  source_url: string;
  verified: string;
  /** Every column of the CSV, so unknown columns survive a write-back. */
  [column: string]: string;
}

/** A registered manufacturer page that describes a reference row. */
export interface SourceEntry {
  /** The reference row's part number. */
  sku_code: string;
  /** The manufacturer that publishes the page. */
  manufacturer: string;
  /** The region the page describes, e.g. `US`. */
  region: string;
  /** The manufacturer technical-specification page. */
  spec_url: string;
  /** The part number found on that page, when one was found. */
  part_number: string;
}

/** Why a row could not be confirmed. */
export type UnconfirmedReason =
  | "no-source-page"
  | "page-unreachable"
  | "robots-disallowed"
  | "robots-unavailable"
  | "no-spec-table"
  | "no-part-number-column"
  | "part-number-absent"
  | "ambiguous-configuration"
  | "fetch-error";

/** The outcome of verifying one reference row. */
export type VerifyStatus =
  /** The page confirmed the row and contradicted nothing. */
  | "confirmed"
  /** The page was checked and contradicts the row in at least one field. */
  | "contradicted"
  /** The row could not be confirmed. Never a pass and never a failure. */
  | "unconfirmed"
  /** No manufacturer page is registered for the row. */
  | "not-attempted"
  /** Something unexpected went wrong while checking the row. */
  | "error";

/** One field the manufacturer states differently from the reference row. */
export interface Contradiction {
  /** The reference row this contradiction is about. */
  sku_code: string;
  /** The manufacturer that publishes the contradicting page. */
  manufacturer: string;
  /** The reference-dataset field. */
  field: VerifiedField;
  /** The value the reference dataset holds. */
  reference: string;
  /** The value the manufacturer publishes. */
  manufacturerValue: string;
  /**
   * The value that may be written back into the reference dataset.
   *
   * It is present only when the manufacturer states a single unambiguous
   * value for the field. A contradiction that only says "this processor
   * belongs to a different part number" states no value, so nothing may be
   * written back for it.
   */
  correction?: string;
  /** The page the manufacturer value came from. */
  sourceUrl: string;
  /** The manufacturer part number of the column that was read. */
  partNumber: string;
}

/** The result of verifying one reference row. */
export interface RowResult {
  sku_code: string;
  manufacturer: string;
  model: string;
  status: VerifyStatus;
  /** The page that was checked, when one was. */
  sourceUrl?: string;
  /** The manufacturer part number of the column that was read. */
  partNumber?: string;
  /** The unambiguous values the manufacturer states for this column. */
  observed: ObservedFields;
  /** The fields the manufacturer states differently. */
  contradictions: Contradiction[];
  /** Why the row could not be confirmed. */
  reason?: UnconfirmedReason;
  /** A human-readable explanation of `reason`. */
  detail?: string;
}

/** The report the tool produces. */
export interface VerifyReport {
  /** The number of reference rows considered. */
  rowsChecked: number;
  /** Rows confirmed against a page with nothing contradicting them. */
  confirmed: number;
  /** Rows a page contradicts in at least one field. */
  contradicted: number;
  /** Rows that could not be confirmed, for any reason. */
  unconfirmed: number;
  /** Rows with no registered manufacturer page. */
  notAttempted: number;
  /** Rows whose check failed unexpectedly. */
  errors: number;
  /** Every contradiction found, across every row. */
  contradictions: Contradiction[];
  /** The per-row detail. */
  results: RowResult[];
  /** The pages that were actually fetched. */
  pages: PageFetch[];
}

/** The record of one page fetch, for the audit trail. */
export interface PageFetch {
  url: string;
  /** The HTTP status, or 0 when the request never completed. */
  status: number;
  /** `ok`, `robots-disallowed`, `robots-unavailable` or `error`. */
  outcome: "ok" | "robots-disallowed" | "robots-unavailable" | "error";
  /** The reason the fetch did not succeed, when it did not. */
  detail?: string;
}
