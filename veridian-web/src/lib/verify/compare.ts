/**
 * Comparing a reference row with a manufacturer specification column.
 *
 * This module holds the rules the verification exists to enforce:
 *
 *   * A field is compared only when the manufacturer states a single
 *     unambiguous value for it. An ambiguous cell - one that lists several
 *     options for a family - can never be used to claim that a reference row
 *     is wrong.
 *   * When one part number matches several columns, the processor picks the
 *     column. When the processor does not identify exactly one column, the
 *     row is reported as unconfirmed rather than guessed at.
 *   * When the processor the reference row claims is published on the page
 *     under a different part number, that is a contradiction and is reported.
 *
 * The semantics are those of the reference implementation in
 * `scripts/verify-reference-specs.py`.
 */

import { parseColumnFields } from "./parse";
import type {
  Contradiction,
  ObservedFields,
  ReferenceRow,
  SpecColumn,
  SpecTable,
  UnconfirmedReason,
  VerifiedField,
} from "./types";

/** Fields the reference dataset stores as numbers. */
const NUMERIC_FIELDS: ReadonlySet<VerifiedField> = new Set([
  "ram_gb",
  "storage_gb",
  "display_size",
  "display_refresh",
  "display_nits",
  "weight_kg",
  "battery_wh",
]);

/** The outcome of comparing one reference row with one page. */
export interface RowOutcome {
  status: "confirmed" | "contradicted" | "unconfirmed";
  partNumber?: string;
  observed: ObservedFields;
  contradictions: Contradiction[];
  reason?: UnconfirmedReason;
  detail?: string;
}

/**
 * Normalise a processor description for comparison.
 *
 * "Snapdragon® X Elite X1E 78 100 Processor" and
 * "Snapdragon X Elite X1E-78-100" must compare equal.
 */
export function normalizeCpu(value: string): string {
  return value
    .toLowerCase()
    .replace(/®/g, "")
    .replace(/™/g, "")
    .replace(/\bprocessor\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * The family code of a retail part number.
 *
 * ASUS retail part numbers are `<family>-<config>[-<region>]`, and the
 * manufacturer publishes its specification table under the family code.
 */
export function familyCode(sku: string): string {
  return sku ? sku.split("-")[0] : sku;
}

/** Do two values state the same thing? */
export function sameValue(field: VerifiedField, reference: string, manufacturer: string): boolean {
  if (NUMERIC_FIELDS.has(field)) {
    const left = Number.parseFloat(reference);
    const right = Number.parseFloat(manufacturer);
    if (Number.isFinite(left) && Number.isFinite(right)) {
      return Math.abs(left - right) < 0.051;
    }
  }
  if (field === "cpu_model") {
    const left = normalizeCpu(reference);
    const right = normalizeCpu(manufacturer);
    if (!left || !right) return false;
    return left === right || right.includes(left) || left.includes(right);
  }
  const left = reference.trim().replace(/\s+/g, " ").toLowerCase();
  const right = manufacturer.trim().replace(/\s+/g, " ").toLowerCase();
  return left === right;
}

/**
 * The columns of a table that a reference row's family code matches.
 *
 * The manufacturer's family code and the reference row's family code can
 * differ in length ("UM5606" versus "UM5606QA"), so both directions are
 * tried before the row is given up on.
 */
export function candidateColumns(table: SpecTable, row: ReferenceRow): SpecColumn[] {
  const code = familyCode(row.sku_code);
  const byPrefix = table.columns.filter((column) => column.name.startsWith(code));
  if (byPrefix.length > 0) return byPrefix;
  return table.columns.filter(
    (column) => column.name.startsWith(code) || code.startsWith(column.name)
  );
}

function processorOf(column: SpecColumn): string {
  return column.values["Processor"] ?? "";
}

/**
 * Compare one reference row with one manufacturer specification table.
 *
 * Returns the column the row describes, the values the manufacturer states
 * for it and every field the manufacturer states differently.
 */
export function verifyRowAgainstTable(row: ReferenceRow, table: SpecTable): RowOutcome {
  if (!table.hasPartNumbers) {
    return {
      status: "unconfirmed",
      observed: {},
      contradictions: [],
      reason: "no-part-number-column",
      detail:
        "the specification table does not label its columns with manufacturer part numbers, " +
        "so the column that describes this row cannot be selected",
    };
  }

  const code = familyCode(row.sku_code);
  const candidates = candidateColumns(table, row);
  if (candidates.length === 0) {
    return {
      status: "unconfirmed",
      observed: {},
      contradictions: [],
      reason: "part-number-absent",
      detail:
        `part number ${code} is not present in the specification table ` +
        `(the table publishes ${table.columns.map((column) => column.name).join(", ")})`,
    };
  }

  let column = candidates[0];

  if (candidates.length > 1) {
    // A family can appear in the table several times with different processor
    // options. Pick the column that matches the processor the reference row
    // claims, and refuse to guess when the match is not unique.
    const wanted = normalizeCpu(row.cpu_model ?? "");
    const matches = candidates.filter(
      (candidate) => wanted && normalizeCpu(processorOf(candidate)).includes(wanted)
    );

    if (matches.length !== 1) {
      // The part number and the processor may simply disagree: the processor
      // the reference row claims may belong to a different family code on the
      // same page. That is a contradiction, not an ambiguity, and it is worth
      // reporting.
      const elsewhere = table.columns.filter(
        (candidate) => wanted && normalizeCpu(processorOf(candidate)).includes(wanted)
      );
      if (elsewhere.length > 0) {
        return {
          status: "contradicted",
          partNumber: candidates[0].name,
          observed: {},
          contradictions: [
            {
              sku_code: row.sku_code,
              manufacturer: row.manufacturer,
              field: "cpu_model",
              reference: row.cpu_model ?? "",
              manufacturerValue: `${elsewhere[0].name} lists this processor; ${candidates[0].name} does not`,
              sourceUrl: table.sourceUrl,
              partNumber: candidates[0].name,
            },
          ],
        };
      }
      return {
        status: "unconfirmed",
        observed: {},
        contradictions: [],
        reason: "ambiguous-configuration",
        detail:
          `part number ${code} appears ${candidates.length} times in the specification table ` +
          `(${candidates.map((candidate) => candidate.name).join(", ")}) and the processor ` +
          `"${row.cpu_model ?? ""}" does not identify exactly one column`,
      };
    }
    column = matches[0];
  }

  const observed = parseColumnFields(column);
  const contradictions = compareFields(row, observed, column, table);
  return {
    status: contradictions.length > 0 ? "contradicted" : "confirmed",
    partNumber: column.name,
    observed,
    contradictions,
  };
}

/** Compare every field the manufacturer states unambiguously. */
export function compareFields(
  row: ReferenceRow,
  observed: ObservedFields,
  column: SpecColumn,
  table: SpecTable
): Contradiction[] {
  const contradictions: Contradiction[] = [];
  for (const [field, value] of Object.entries(observed) as Array<[VerifiedField, string]>) {
    const current = (row[field] ?? "").trim();
    if (!current) continue;
    if (sameValue(field, current, value)) continue;
    contradictions.push({
      sku_code: row.sku_code,
      manufacturer: row.manufacturer,
      field,
      reference: current,
      manufacturerValue: value,
      correction: value,
      sourceUrl: table.sourceUrl,
      partNumber: column.name,
    });
  }
  return contradictions;
}
