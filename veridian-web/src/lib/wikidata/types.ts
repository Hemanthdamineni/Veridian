/**
 * Contracts for the Wikidata adapter.
 *
 * The shape deliberately mirrors the ENERGY STAR adapter (`energy-star/types.ts`)
 * so that both sources are audited the same way: a source row is captured
 * verbatim as a raw observation, validated field by field, and only then
 * allowed to become a canonical catalog fact.
 *
 * Nothing in this file invents a value. Every field is either an observation
 * the source published or `null`, which means "the source did not say".
 */

/** Version of the adapter contract, recorded on every ingestion report. */
export const ADAPTER_VERSION = "1.0.0";

/** Verifiable source identity used for provenance (ADR-005). */
export const WIKIDATA_SOURCE = {
  name: "Wikidata",
  url: "https://query.wikidata.org/sparql",
  license: "CC0 1.0 Universal (public domain dedication)",
  /** Human-readable page for one item, used as the citation for a row. */
  itemUrl: (itemId: string) => `https://www.wikidata.org/wiki/${itemId}`,
  /** The query that produced the rows, kept as data in `data/wikidata-sparql.rq`. */
  queryUrl: "https://www.wikidata.org/wiki/Wikidata:SPARQL_query_service",
};

// =============================================================================
// SPARQL WIRE FORMAT
// =============================================================================

/** One value of one variable in one SPARQL result row. */
export interface SparqlBindingValue {
  type: string;
  value: string;
  datatype?: string;
  "xml:lang"?: string;
}

/** One row of a SPARQL SELECT result. */
export type SparqlBinding = Record<string, SparqlBindingValue>;

/** A SPARQL JSON response (`application/sparql-results+json`). */
export interface SparqlResults {
  head: { vars: string[] };
  results: { bindings: SparqlBinding[] };
}

// =============================================================================
// EXTRACTED ROWS
// =============================================================================

/**
 * One laptop row as published by Wikidata, extracted into explicit fields.
 *
 * Quantity values keep their unit: Wikidata states a mass in grams or in
 * kilograms, a memory size in gigabyte or in gibibyte, and a screen diagonal
 * in inch. The unit travels with the amount so the conversion is a
 * calculation, never a guess.
 */
export interface WikidataRow {
  /** The Wikidata item id (Q-id) of the product. */
  itemId: string;
  /** The item's label, or null when the item has no label at all. */
  itemLabel: string | null;

  manufacturerId: string | null;
  manufacturerLabel: string | null;

  /** Publication / release date, as the endpoint returns it. */
  releaseDate: string | null;

  cpuId: string | null;
  cpuLabel: string | null;

  displaySizeAmount: number | null;
  displaySizeUnit: string | null;

  massAmount: number | null;
  massUnit: string | null;

  ramAmount: number | null;
  ramUnit: string | null;
  ramTypeLabel: string | null;

  osId: string | null;
  osLabel: string | null;

  /** P217 "inventory number" — the product code manufacturers publish. */
  inventoryNumber: string | null;
  /** P13802 "part number" — the manufacturer's ordering code. */
  partNumber: string | null;

  predecessorId: string | null;
  predecessorLabel: string | null;
  successorId: string | null;
  successorLabel: string | null;
}

// =============================================================================
// VALIDATED RECORDS
// =============================================================================

/**
 * A validated source row, ready to be written to the catalog.
 *
 * Every field here is either observed by the source or derived by a
 * documented, deterministic rule from observed fields.
 */
export interface NormalizedRecord {
  /** The Wikidata item id this record came from. */
  sourceRecordId: string;
  /** The verbatim source row this record was built from. */
  rawPayload: string;
  /** The SHA-256 hash of `rawPayload`. */
  rawPayloadHash: string;
  /** Canonical SKU code: `<token>-<configuration signature hash>`. */
  skuCode: string;
  /** Canonical manufacturer name. */
  brand: string;
  /** The product name a buyer would recognise. */
  modelName: string;
  /** The product family the record was filed under. */
  seriesName: string;
  /** Operating system, as published. */
  os: string;
  /** Release date (ISO `YYYY-MM-DD`) or null. */
  launchDate: string | null;
  /** Manufacturer part number, when the source published one. */
  partNumber: string | null;
  /** Q-id of the predecessor product, when the source published one. */
  predecessorId: string | null;
  /** Q-id of the successor product, when the source published one. */
  successorId: string | null;

  /** The observed specification, kept verbatim beside the canonical row. */
  observedSpecs: {
    source: string;
    sourceUrl: string;
    observedAt: string;
    itemId: string;
    itemLabel: string | null;
    manufacturerId: string | null;
    releaseDate: string | null;
    cpuId: string | null;
    cpuBrand: string;
    cpuModel: string;
    ramGb: number;
    ramType: string | null;
    displaySizeIn: number | null;
    weightKg: number | null;
    osId: string | null;
    osLabel: string | null;
    inventoryNumber: string | null;
    partNumber: string | null;
  };
}

/** A rejected record, failed visibly with reasons. */
export interface RejectedRecord {
  sourceRecordId: string | null;
  errors: string[];
  raw: unknown;
}

/** Verbatim source payload with its SHA-256 hash, stored as an observation. */
export interface RawPayloadRow {
  sourceRecordId: string | null;
  payloadHash: string;
  payload: string;
  errors: string[];
}

/** Everything one run observed, ready to be written through the audited path. */
export interface IngestionReport {
  source: string;
  adapterVersion: string;
  observedAt: string;
  /** Number of source rows read. */
  requested: number;
  accepted: number;
  rejected: number;
  rejectedRecords: RejectedRecord[];
  records: NormalizedRecord[];
  rawPayloads: RawPayloadRow[];
}
