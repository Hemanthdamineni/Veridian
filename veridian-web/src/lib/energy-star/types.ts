/**
 * Energy Star adapter contracts (ADR-003, ADR-004, ADR-005).
 *
 * One adapter per source. The adapter owns fetch -> extract -> validate ->
 * emit raw observation -> ingest. Raw observations are immutable; canonical
 * entities are only written through this audited path with provenance.
 */

export const ADAPTER_VERSION = "1.0.0";

/** Verifiable source identity used for provenance (ADR-005). */
export const ENERGY_STAR_SOURCE = {
  name: "US EPA ENERGY STAR Certified Computers V9.0",
  url: "https://data.energystar.gov/resource/rxdj-2c88.json",
  license: "US Public Domain (data.gov Open Government Data Initiative)",
  datasetId: "rxdj-2c88",
  /** Deep link to the dataset's filtered API view for a specific pd_id. */
  recordUrl: (pdId: string) =>
    `${ENERGY_STAR_SOURCE_URL}?pd_id=${encodeURIComponent(pdId)}`,
};

const ENERGY_STAR_SOURCE_URL = "https://data.energystar.gov/resource/rxdj-2c88.json";

/** Deterministic, identifiable user agent (ADR-003: no browser impersonation). */
export const VERIDIAN_USER_AGENT =
  "VeridianBot/1.0 (+https://veridian.dev; contact@veridian.dev)";

/** A raw record as returned by the Socrata endpoint (verbatim). */
export type EnergyStarRecord = Record<string, string | null | undefined>;

/** Result of validating + normalizing a single raw record. */
export interface NormalizedRecord {
  sourceRecordId: string;
  skuCode: string;
  brand: string;
  modelName: string;
  seriesName: string;
  os: string;
  launchDate: string | null;
  dateCertified: string | null;
  /** Certified specs lifted directly from the source (observed, not guessed). */
  certifiedSpecs: {
    source: string;
    sourceUrl: string;
    observedAt: string;
    certifiedAt: string | null;
    marketDate: string | null;
    energyStarId: string;
    cpuBrand: string | null;
    cpuModel: string | null;
    cpuCores: number | null;
    cpuBaseClockGHz: number | null;
    cpuMaxClockGHz: number | null;
    cpuPackages: number | null;
    ramGb: number | null;
    storageType: string | null;
    storageDrives: number | null;
    displaySizeIn: number | null;
    displayResolutionMp: number | null;
    displayAreaSqIn: number | null;
    touchScreen: boolean | null;
    batteryWh: number | null;
    os: string | null;
    npu: boolean | null;
    markets: string | null;
  };
}

/** A rejected record, failed visibly with reasons (ADR-003). */
export interface RejectedRecord {
  sourceRecordId: string | null;
  errors: string[];
  raw: EnergyStarRecord;
}

/** Verbatim source payload with SHA-256 hash, stored as an immutable observation. */
export interface RawPayloadRow {
  sourceRecordId: string | null;
  payloadHash: string;
  payload: string;
  errors: string[];
}

export interface IngestionReport {
  source: string;
  adapterVersion: string;
  observedAt: string;
  requested: number;
  accepted: number;
  rejected: number;
  rejectedRecords: RejectedRecord[];
  records: NormalizedRecord[];
  rawPayloads: RawPayloadRow[];
}
