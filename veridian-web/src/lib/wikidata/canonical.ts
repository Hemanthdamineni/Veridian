/**
 * Canonical identity for Wikidata laptop rows.
 *
 * The catalog already has one way of turning a source record into a
 * canonical entity, and it lives in `energy-star/canonical.ts` (ADR-002). The
 * rules there are not ENERGY STAR specific — they are about a manufacturer
 * name, a product family, a configuration signature and a SKU code — so they
 * are reused here rather than re-implemented in a parallel scheme. Two
 * sources that agree on identity must produce the same identity.
 *
 * Re-exported rules (see `energy-star/canonical.ts` for the long form):
 *
 *   * `canonicalBrand`        — one spelling per manufacturer.
 *   * `resolveModelName`      — prefer the name a buyer would recognise.
 *   * `deriveSeriesName`      — derive the product family from the name.
 *   * `configurationSignature`— the specification set that distinguishes two
 *                                configurations of the same model.
 *   * `canonicalSkuCode`      — `<token>-<hash of the signature>`.
 */

import {
  canonicalBrand,
  canonicalSkuCode,
  configurationSignature,
  deriveSeriesName,
  isPlaceholderModelName,
  resolveModelName,
} from "../energy-star/canonical";

export {
  canonicalBrand,
  canonicalSkuCode,
  configurationSignature,
  deriveSeriesName,
  isPlaceholderModelName,
  resolveModelName,
};

/** The input a Wikidata row contributes to the canonical identity. */
export interface WikidataIdentityInput {
  /** The manufacturer label exactly as the source published it. */
  rawBrand: string;
  /** The product label exactly as the source published it. */
  rawModelName: string;
  /** The manufacturer part number, when the source published one. */
  partNumber: string | null;
  /** CPU model, as observed. */
  cpuModel: string;
  /** RAM in whole GB, as observed. */
  ramGb: number;
  /** Display diagonal in inches, when the source published one. */
  displaySizeIn: number | null;
  /** Operating system, as observed. */
  os: string;
}

/** The canonical identity derived from one row. */
export interface WikidataIdentity {
  /** Canonical manufacturer name. */
  brand: string;
  /** The product name a buyer would recognise. */
  modelName: string;
  /** The product family the configuration was filed under. */
  seriesName: string;
  /** The canonical configuration signature. */
  signature: string;
  /** The canonical SKU code. */
  skuCode: string;
}

/**
 * Derive the canonical identity of a Wikidata row.
 *
 * The signature is built from the same fields the ENERGY STAR adapter uses.
 * Fields Wikidata does not publish (storage type, drive count, display
 * resolution, touch screen, battery capacity, CPU core count) are passed as
 * `null`, which the signature treats as "not reported" — so two rows that
 * differ only in an unreported field are one configuration, not two.
 */
export function deriveWikidataIdentity(input: WikidataIdentityInput): WikidataIdentity {
  const brand = canonicalBrand(input.rawBrand);
  const modelName = resolveModelName(input.rawModelName);
  // The family is derived from the name the source reported, exactly as the
  // ENERGY STAR adapter does, so a bare chassis code still yields a family.
  const seriesName = deriveSeriesName(brand, input.rawModelName);
  const signature = configurationSignature({
    cpuModel: input.cpuModel,
    cpuCores: null,
    cpuPackages: null,
    ramGb: input.ramGb,
    storageType: null,
    storageDrives: null,
    displaySizeIn: input.displaySizeIn,
    displayResolutionMp: null,
    touchScreen: null,
    batteryWh: null,
    os: input.os,
  });
  const skuCode = canonicalSkuCode(input.partNumber, modelName, signature);
  return { brand, modelName, seriesName, signature, skuCode };
}
