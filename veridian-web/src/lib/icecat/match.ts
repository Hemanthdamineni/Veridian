/**
 * Icecat open product data — matching against the Veridian catalog.
 *
 * Icecat publishes a *product*: one record per model, with the
 * specifications of that model. The Veridian catalog stores a
 * *configuration*: one row per certified configuration. The two are not the
 * same granularity, so the rules below are deliberately conservative.
 *
 * The ladder, strongest first:
 *
 *   1. `mpn` — the brand's product code is the catalog's part number.
 *   2. `name` — same brand, and the names are the same set of words.
 *   3. `name-subset` — same brand, and the Icecat name is a strict part of
 *      the catalog name ("PW514261" is part of "Dell Pro Precision 5 14
 *      PW514261").
 *   4. `name-similarity` — same brand, and the names share enough words.
 *
 * Every rule requires the brands to agree. A product whose name is close to
 * a configuration of a different brand is never matched.
 *
 * Two further rules keep the connector honest:
 *
 *   * a product that matches more than one model equally well is reported
 *     as unmatched — it is not attached to the closest one; and
 *   * a product that matches a model with several configurations is also
 *     reported as unmatched, because an Icecat record describes the model
 *     and cannot say which configuration a price belongs to.
 */

import type {
  CatalogSku,
  IcecatProduct,
  MatchCandidate,
  MatchMethod,
  MatchOutcome,
} from "./types";

/**
 * The confidence a match has to reach before it is accepted.
 *
 * A match below this is reported as unmatched and never written.
 */
export const MATCH_THRESHOLD = 0.85;

/** The confidence each rule awards. */
const CONFIDENCE: Record<MatchMethod, number> = {
  mpn: 0.98,
  name: 0.95,
  "name-subset": 0.9,
  "name-similarity": 0.85,
};

/**
 * Normalise a brand name for comparison.
 *
 * Case, spacing and punctuation differ between the two sources — "Dell"
 * and "DELL" are the same brand — so both are folded away.
 */
export function normalizeBrand(value: string): string {
  return (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

/**
 * Normalise a name into its words.
 *
 * Punctuation becomes a word boundary, so "Pro 14, Essential" and
 * "Pro 14 Essential" are the same words.
 */
export function normalizeTokens(value: string): string[] {
  return (value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

/** The set of words in a name. */
export function tokenSet(value: string): Set<string> {
  return new Set(normalizeTokens(value));
}

/** The part of a catalogue code that identifies the configuration's family. */
export function partNumberToken(skuCode: string): string {
  const match = (skuCode ?? "").match(/^(.*)-[0-9a-f]{8}$/);
  return (match ? match[1] : skuCode ?? "").trim();
}

/** The overlap of two word sets, from 0 (nothing in common) to 1 (equal). */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return shared / (a.size + b.size - shared);
}

/**
 * A word is worth comparing on its own when it is specific enough.
 *
 * A bare "16" is not; "3535" (a chassis code) is.
 */
function isSignificant(token: string): boolean {
  if (token.length >= 4) return true;
  return token.length >= 3 && /[A-Z]/.test(token);
}

/**
 * Match one Icecat product against the catalog.
 *
 * The catalog is expected to be the whole catalog: the product is scored
 * against every configuration, and the strongest model-level match wins.
 */
export function matchProductToCatalog(
  product: IcecatProduct,
  catalog: CatalogSku[]
): MatchOutcome {
  const brand = normalizeBrand(product.brand);
  const icecatName = product.modelName.trim();
  const icecatTokens = tokenSet(icecatName);
  const productCode = normalizeBrand(product.productCode);

  if (!brand) {
    return {
      status: "unmatched",
      best: null,
      candidates: [],
      reason: "the product carries no brand, so it cannot be matched to a catalog brand",
    };
  }
  if (icecatTokens.size === 0) {
    return {
      status: "unmatched",
      best: null,
      candidates: [],
      reason: "the product carries no model name, so it cannot be matched to a catalog model",
    };
  }

  // Score every configuration, then keep the strongest score per model.
  const byModel = new Map<
    string,
    { score: number; method: MatchMethod; reason: string; sku: CatalogSku }
  >();

  for (const sku of catalog) {
    if (normalizeBrand(sku.brand) !== brand) continue;

    const modelTokens = tokenSet(sku.modelName);
    const skuPartNumber = normalizeBrand(partNumberToken(sku.skuCode));
    let scored: { score: number; method: MatchMethod; reason: string } | null = null;

    if (productCode && skuPartNumber && productCode === skuPartNumber) {
      scored = {
        score: CONFIDENCE.mpn,
        method: "mpn",
        reason: `the brand's product code ${product.productCode} is the part number of ${sku.skuCode}`,
      };
    } else if (
      skuPartNumber &&
      normalizeBrand(icecatName) === skuPartNumber &&
      skuPartNumber.length >= 4
    ) {
      scored = {
        score: CONFIDENCE.mpn,
        method: "mpn",
        reason: `the product name ${icecatName} is the part number of ${sku.skuCode}`,
      };
    } else if (setsEqual(icecatTokens, modelTokens)) {
      scored = {
        score: CONFIDENCE.name,
        method: "name",
        reason: `the product name "${icecatName}" names the catalog model "${sku.modelName}"`,
      };
    } else if (
      icecatTokens.size < modelTokens.size &&
      isSubset(icecatTokens, modelTokens) &&
      hasSignificantToken(icecatTokens)
    ) {
      scored = {
        score: CONFIDENCE["name-subset"],
        method: "name-subset",
        reason: `the product name "${icecatName}" is part of the catalog model "${sku.modelName}"`,
      };
    } else {
      const similarity = jaccard(icecatTokens, modelTokens);
      if (similarity >= CONFIDENCE["name-similarity"]) {
        scored = {
          score: similarity,
          method: "name-similarity",
          reason: `the product name "${icecatName}" and the catalog model "${sku.modelName}" share ${(similarity * 100).toFixed(0)}% of their words`,
        };
      }
    }

    if (!scored) continue;
    const existing = byModel.get(sku.modelId);
    if (!existing || scored.score > existing.score) {
      byModel.set(sku.modelId, { ...scored, sku });
    }
  }

  const candidates: MatchCandidate[] = [...byModel.values()]
    .filter((entry) => entry.score >= MATCH_THRESHOLD)
    .map((entry) => ({
      skuId: entry.sku.id,
      modelId: entry.sku.modelId,
      modelName: entry.sku.modelName,
      brand: entry.sku.brand,
      confidence: entry.score,
      method: entry.method,
      reason: entry.reason,
    }))
    .sort((a, b) => b.confidence - a.confidence || a.modelName.localeCompare(b.modelName));

  if (candidates.length === 0) {
    return {
      status: "unmatched",
      best: null,
      candidates: [],
      reason: `no ${product.brand} configuration in the catalog is named like "${icecatName}"`,
    };
  }

  const best = candidates[0];
  const tied = candidates.filter(
    (candidate) =>
      candidate.modelId !== best.modelId && candidate.confidence === best.confidence
  );
  if (tied.length > 0) {
    return {
      status: "unmatched",
      best: null,
      candidates,
      reason: `${candidates.length + 1} catalog models match "${icecatName}" equally well (${best.confidence.toFixed(2)}): ${[
        best.modelName,
        ...tied.map((candidate) => candidate.modelName),
      ].join(", ")}`,
    };
  }

  const modelSkuCount = catalog.find((sku) => sku.modelId === best.modelId)?.modelSkuCount ?? 1;
  if (modelSkuCount > 1) {
    return {
      status: "unmatched",
      best: null,
      candidates,
      reason: `"${icecatName}" names the catalog model "${best.modelName}", which has ${modelSkuCount} configurations; an Icecat record describes the model and cannot say which configuration a price belongs to`,
    };
  }

  return {
    status: "matched",
    best,
    candidates,
    reason: best.reason,
  };
}

/** True when two word sets hold the same words. */
function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const token of a) {
    if (!b.has(token)) return false;
  }
  return true;
}

/** True when every word of `a` also appears in `b`. */
function isSubset(a: Set<string>, b: Set<string>): boolean {
  for (const token of a) {
    if (!b.has(token)) return false;
  }
  return true;
}

/** True when at least one word of the set is specific enough to compare on. */
function hasSignificantToken(tokens: Set<string>): boolean {
  for (const token of tokens) {
    if (isSignificant(token)) return true;
  }
  return false;
}
