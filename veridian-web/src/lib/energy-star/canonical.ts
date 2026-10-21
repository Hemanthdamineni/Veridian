/**
 * Canonical identity, series derivation and configuration signatures for
 * ENERGY STAR records (ADR-002).
 *
 * The source presents a certification record, not a product. Turning a record
 * into a canonical catalog entity requires three decisions, all of which are
 * made here so that they are deterministic, testable and auditable:
 *
 * 1. **Manufacturer** — the source writes brand names inconsistently
 *    (`DELL`, `DELL`, `dynabook`, `Jp. ik` / `jp.ik`). One canonical spelling
 *    per brand.
 * 2. **Series** — a product family ("ThinkPad E14", "MacBook Pro"). The source
 *    does not publish it, so it is derived with documented, per-brand rules
 *    and a conservative generic fallback. A wrong family is worse than a flat
 *    one, so the fallback never guesses aggressively.
 * 3. **Configuration signature** — the set of specifications that makes one
 *    certified configuration distinct from another of the same model. Two
 *    records with the same model *and* the same signature are the same
 *    configuration certified twice and must collapse to one canonical SKU
 *    with two observations. Two records with the same model but different
 *    signatures are different configurations and must stay separate.
 *
 * Nothing here invents a value. Every derived string is a function of fields
 * the source actually reported.
 */

import { createHash } from "node:crypto";

// =============================================================================
// MANUFACTURER CANONICALIZATION
// =============================================================================

/**
 * Brands whose canonical spelling cannot be derived by a generic rule.
 * Keys are compared case-insensitively after whitespace collapsing.
 */
const BRAND_OVERRIDES: Record<string, string> = {
  "dell": "Dell",
  "dynabook": "Dynabook",
  "vaio": "VAIO",
  "msi": "MSI",
  "hp": "HP",
  "lg": "LG",
  "asus": "ASUS",
  "ctl": "CTL",
  "chuwi": "CHUWI",
  "geekom": "GEEKOM",
  "getac": "GETAC",
  "xilinx": "XILINX",
  "xıtrix": "XITRIX",
  "xitrix": "XITRIX",
  "samsung": "Samsung",
  "lenovo": "Lenovo",
  "acer": "Acer",
  "apple": "Apple",
  "microsoft": "Microsoft",
  "panasonic": "Panasonic",
  "framework": "Framework",
  "gateway": "Gateway",
  "motorola": "Motorola",
  "yashi": "YASHI",
  "compumax": "COMPUMAX",
  "centerm": "CENTERM",
  "ceibal": "Ceibal",
  "durabook": "Durabook",
  "sicomputer": "SiComputer",
  "acerinc": "Acer",
  // The source writes this brand both as "Jp. ik" and as "jp.ik".
  jpik: "J.P. Ik",
};

/** Brands that are always written in upper case. */
const UPPERCASE_BRANDS = new Set([
  "ASUS", "HP", "MSI", "LG", "VAIO", "CTL", "CHUWI", "GEEKOM", "GETAC", "XITRIX",
  "COMPUMAX", "CENTERM", "YASHI", "DELL",
]);

/**
 * Canonical manufacturer name for a reported brand string.
 *
 * Collapses internal whitespace, applies the override table, then falls back
 * to title case for brands that are not acronyms. Lookup is done on a key
 * with every separator removed, so "Jp. ik" and "jp.ik" resolve to the same
 * manufacturer.
 */
export function canonicalBrand(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  if (!collapsed) return "Unknown";
  const key = collapsed.toLowerCase();
  if (BRAND_OVERRIDES[key]) return BRAND_OVERRIDES[key];
  const compact = key.replace(/[^a-z0-9]/g, "");
  if (BRAND_OVERRIDES[compact]) return BRAND_OVERRIDES[compact];
  if (UPPERCASE_BRANDS.has(collapsed.toUpperCase())) return collapsed.toUpperCase();
  // Title case each word, and each part of a word separated by a period, so
  // "jp.ik" and "jp. ik" produce the same spelling.
  return collapsed
    .split(" ")
    .map((word) =>
      word
        .split(".")
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
        .join(".")
    )
    .join(" ");
}

// =============================================================================
// ADDITIONAL MODEL INFORMATION
// =============================================================================

export interface AdditionalModelInfo {
  /** Every MPN / marketing string the source attached to this record. */
  parts: string[];
  /**
   * MPNs that look like part numbers rather than marketing names — used as
   * the canonical part number for the configuration.
   */
  partNumbers: string[];
  /** Marketing names (contain a space) attached to the record. */
  marketingNames: string[];
  /**
   * Free-text legends the source appends to explain wildcard characters in
   * part numbers ("* can be 0-9, a-z, A-Z …"). These are documentation, not
   * identifiers, and are excluded from every derived value.
   */
  notes: string[];
}

/**
 * Phrases the source uses when it is documenting a wildcard part number
 * rather than naming a product.
 */
const PLACEHOLDER_NOTE_PATTERNS = [
  /\bcan be\b/i,
  /\bmay be\b/i,
  /\brepresent/i,
  /\b0-9\b/,
  /\bA-Z\b/,
  /\bor blank\b/i,
  /same as basic model/i,
  /^the\s*["*]/i,
  /\bdepending on\b/i,
  /\bsame as\b.*\bmodel\b/i,
  // Notes the source uploads to itself rather than a product identifier.
  /^upload to epa$/i,
  /^upload to /i,
  /^see /i,
  /^refer to /i,
];

/**
 * True when a string is a legend explaining a wildcard part number rather
 * than an identifier for a product.
 */
export function isPlaceholderNote(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  return PLACEHOLDER_NOTE_PATTERNS.some((pattern) => pattern.test(v));
}

/**
 * True when a reported model name is an instruction or a legend rather than
 * the name of a product.
 *
 * The source occasionally uploads a record whose model name is a note to
 * itself — "UPLOAD TO EPA" — or a wildcard legend. Such a record describes no
 * product, so it is rejected at validation rather than filed in the catalog.
 */
export function isPlaceholderModelName(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  return (
    /^upload to epa$/i.test(v) ||
    /^(same as|see |refer to|use )\b/i.test(v) ||
    /^(n\/?a|not applicable|none|tbd|tbc)$/i.test(v)
  );
}

/**
 * Strip the enumeration prefix the source sometimes adds to a model name
 * ("(1) ThinkBook 14x G2 IWC" -> "ThinkBook 14x G2 IWC").
 */
export function stripEnumerationPrefix(value: string): string {
  return value.replace(/^\(\d+\)\s*/, "").trim();
}

/**
 * The source packs several identifiers into `additional_model_information`,
 * separated by `,` or `;`. Examples:
 *
 *   "ThinkPad E14 Gen 8,21Y7; ThinkPad L14p Gen 7,21YA"
 *   "P185G,Dell Pro Essential 14 PV14260"
 *   "N26ED2***,AL15-58P,* can be 0-9, a-z, A-Z …"
 *
 * The elements are the model name, a part number, and sometimes a legend
 * explaining the wildcard characters. Legends are separated out so they can
 * never leak into a derived name.
 */
export function parseAdditionalModelInfo(raw: string | null | undefined): AdditionalModelInfo {
  const parts: string[] = [];
  if (raw) {
    for (const chunk of raw.split(/[;,]/)) {
      const value = chunk.replace(/\s+/g, " ").trim();
      if (value) parts.push(value);
    }
  }
  const notes = parts.filter((p) => isPlaceholderNote(p));
  const identifiers = parts.filter((p) => !isPlaceholderNote(p));
  const partNumbers = identifiers.filter((p) => looksLikePartNumber(p));
  const marketingNames = identifiers.filter((p) => !looksLikePartNumber(p) && /\s/.test(p));
  return { parts, partNumbers, marketingNames, notes };
}

/**
 * Heuristic for "this token is a manufacturer part number".
 *
 * A part number is a single token, mixes letters and digits (or is a
 * well-known all-digit chassis code), and is not a marketing sentence.
 */
export function looksLikePartNumber(value: string): boolean {
  const v = value.trim();
  if (!v || /\s/.test(v)) return false;
  if (!/\d/.test(v)) return false;
  // All digits (e.g. Dell platform codes such as "2036") are part numbers.
  if (/^\d{3,6}$/.test(v)) return true;
  // Alphanumeric with at least one letter and one digit, length 3..24.
  return /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9._\-\/]{3,24}$/.test(v);
}

// =============================================================================
// SERIES DERIVATION
// =============================================================================

/**
 * Per-brand marketing families. Each entry is an ordered list of regexes
 * matched against the reported model name; the first match wins and its
 * capture group (or the whole match) becomes the series name.
 *
 * The source frequently reports the model name as a bare part number
 * (ASUS "B1503CVA", Samsung "NP760XJG"), in which case the generic
 * chassis-prefix rule below applies.
 */
const BRAND_SERIES_RULES: Record<string, Array<[RegExp, number]>> = {
  Lenovo: [
    [/^(ThinkPad\s+(?:[A-Z]?\d{1,2}|T\d{2}|X1|P\d{1,2}s?))(?:\s+.*)?$/i, 1],
    [/^(ThinkBook\s+[\w]+)/i, 1],
    [/^(IdeaPad\s+(?:Slim|Pro|Idea|Studio|Vibe|Plus|SL)\s*\d*)/i, 1],
    [/^(Yoga\s+[\w]*)/i, 1],
    [/^(Legion\s+[\w]*)/i, 1],
    [/^(ThinkCentre|ThinkPad\s+neo|ThinkPad\s+X1)/i, 0],
  ],
  HP: [
    [/^(HP\s+EliteBook\s+\d+)/i, 1],
    [/^(HP\s+Elite\s+\w+\s*\d*)/i, 1],
    [/^(HP\s+OmniBook\s+[\w\s]*?\d)/i, 1],
    [/^(HP\s+ProBook\s+\d+)/i, 1],
    [/^(HP\s+Pavilion\s+[\w\s]*?\d)/i, 1],
    [/^(HP\s+Chromebook(?:\s+Plus)?(?:\s+x360)?)/i, 1],
    [/^(HP\s+ZBook\s+[\w\s]*?\d)/i, 1],
    [/^(HP\s+Envy\s+[\w\s]*?\d)/i, 1],
    [/^(HP\s+Victus\s+[\w\s]*?\d)/i, 1],
    [/^(HP\s+250R|HP\s+255R|HP\s+250|HP\s+255)\b/i, 0],
  ],
  Apple: [
    [/^(MacBook\s+Pro)/i, 1],
    [/^(MacBook\s+Air)/i, 1],
    [/^(MacBook\s+Neo)/i, 1],
    [/^(iMac|Mac\s+mini|Mac\s+Studio)/i, 0],
  ],
  Microsoft: [
    [/^(Surface\s+Laptop\s+Studio)/i, 1],
    [/^(Surface\s+Laptop(?:\s+Ultra)?)/i, 1],
    [/^(Surface\s+Pro|Surface\s+Go)/i, 0],
  ],
  Acer: [
    [/^(Aspire\s+Lite)/i, 1],
    [/^(Aspire\s+Pro)/i, 1],
    [/^(Aspire\s+\w+)/i, 1],
    [/^(Swift\s+Go|Swift\s+\w+)/i, 1],
    [/^(Acer\s+One)/i, 1],
    [/^(Chromebook\s+Spin)/i, 1],
    [/^(Extensa\s+\d*)/i, 1],
  ],
  ASUS: [
    [/^(Zenbook\s+[A-Z]?\d*)/i, 1],
    [/^(Vivobook\s+\d*)/i, 1],
    [/^(ROG\s+[\w\s]*?\d)/i, 1],
    [/^(TUF\s+Gaming\s+[\w\s]*?\d)/i, 1],
    [/^(ProArt\s+[\w\s]*?\d)/i, 1],
    [/^(ExpertBook\s+[\w\s]*?\d)/i, 1],
    [/^(ASUS\s+Chromebook)/i, 1],
  ],
  Samsung: [
    [/^(Galaxy\s+Book)/i, 1],
  ],
  MSI: [
    [/^(Prestige|Modern|Stealth|Vector|Crosshair| Raider|Titan|Infinity|Sword|Bravo|Alpha)/i, 1],
  ],
  Dynabook: [
    [/^(PORTEGE)/i, 1],
    [/^(SATELLITE\s+PRO)/i, 1],
    [/^(SATELLITE\s+LAPTOP)/i, 1],
    [/^(TECRA)/i, 1],
    [/^(Dynabook\s+Chromebook)/i, 1],
  ],
  Panasonic: [
    [/^(Let's\s+note|CF-|FZ-|CF-)/i, 0],
  ],
  LG: [
    [/^(Gram)/i, 1],
  ],
  Framework: [
    [/^(Laptop\s+\d+)/i, 1],
  ],
  GETAC: [
    [/^(B\d{3}|S\d{3}|V\d{3}|F\d{3}|X\d{3})/i, 1],
  ],
};

/**
 * Tokens that terminate a generic family name.
 * e.g. "IdeaPad Slim 5 13IWC11" -> "IdeaPad Slim 5" (size / SKU suffix cut).
 */
const GENERIC_TAIL = new Set([
  "gen", "gb", "ghz", "inch", "in", "with", "and", "the",
]);

/**
 * Resolve the display name for a model.
 *
 * Some manufacturers certify an internal chassis code as the model name
 * (Dell "P112F", ASUS "B1503CVA") while publishing the marketing name
 * ("Dell 15 D15260") in `additional_model_information`. Showing the internal
 * code makes the catalog unsearchable by the name a buyer actually uses, so
 * the marketing name is preferred when one is available. The internal code
 * is never discarded - it is kept as the part number.
 */
export function resolveModelName(
  modelName: string,
  additional?: AdditionalModelInfo
): string {
  const name = stripEnumerationPrefix(modelName).replace(/\s+/g, " ").trim();
  if (!name) return name;

  // A name that already reads like a product name is used as reported.
  if (hasLettersAndSpaces(name)) return name;

  if (additional) {
    // The source often lists several identifiers: the chassis code it
    // certified, and one or more marketing names. The most specific
    // marketing name is the one a buyer would recognise, so the longest
    // candidate wins. A candidate that is a note rather than a name is
    // never used.
    const candidates = additional.marketingNames
      .map((marketing) => stripEnumerationPrefix(marketing).replace(/\s+/g, " ").trim())
      .filter((candidate) => candidate.length >= 3 && !isPlaceholderModelName(candidate))
      .sort((a, b) => b.length - a.length);
    if (candidates.length > 0) return candidates[0];
  }
  return name;
}

/**
 * Derive the product family (Series) for a reported model name.
 *
 * Rules, in order:
 * 1. A per-brand family table, matched against the model name.
 * 2. A marketing name carried in `additional_model_information`, used only
 *    when the model name is itself a bare part number.
 * 3. A generic rule for human-readable names: take the leading tokens until
 *    a size, generation or part-number token appears.
 * 4. A chassis-prefix rule for bare part numbers: strip the trailing
 *    variant letters/digits so that "B1503CVA" and "B1503CUB" share a family.
 * 5. The model name itself, unchanged — never a guess.
 */
export function deriveSeriesName(
  brand: string,
  modelName: string,
  additional?: AdditionalModelInfo
): string {
  const name = stripEnumerationPrefix(modelName).replace(/\s+/g, " ").trim();
  if (!name) return brand;

  // The per-brand table is curated, so its capture is used as written: the
  // rules already decide where the family name ends.
  const rules = BRAND_SERIES_RULES[brand];
  if (rules) {
    for (const [pattern, group] of rules) {
      const match = pattern.exec(name);
      if (match) {
        const captured = (match[group] ?? match[0]).replace(/\s+/g, " ").trim();
        if (captured) return captured;
      }
    }
  }

  const isBarePartNumber = !/\s/.test(name);

  if (isBarePartNumber && additional) {
    // Prefer an explicit marketing family name carried in
    // additional_model_information. Legends are excluded by the parser, the
    // most specific candidate wins, and a trailing part number is removed.
    const candidates = additional.marketingNames
      .map((marketing) => stripPartNumber(marketing))
      .filter((candidate) => candidate.length >= 3)
      .sort((a, b) => b.length - a.length);
    if (candidates.length > 0) return candidates[0];
  }

  // Generic: human-readable names keep their leading family tokens.
  if (hasLettersAndSpaces(name)) {
    const derived = stripPartNumber(stripTail(name));
    if (derived.length >= 3) return derived;
  }

  // Bare part number: derive a chassis family by stripping the trailing
  // variant suffix. "B1503CVA" -> "B1503", "NP760XJG" -> "NP760X".
  const chassis = chassisPrefix(name);
  if (chassis) return chassis;

  // The model name may itself be a wildcard code while the real family name
  // is only present as an additional part number ("N26ED2***" / "AL15-58P").
  if (additional) {
    for (const partNumber of additional.partNumbers) {
      const derived = chassisPrefix(partNumber);
      if (derived) return derived;
    }
  }

  return name;
}

/**
 * Remove a redundant leading manufacturer token from a family name
 * ("Lenovo Chrome 500e" -> "Chrome 500e").
 *
 * The manufacturer is carried separately on every record, so a family name
 * that merely repeats the brand is noise. It is only applied to names the
 * catalog derived itself, never to a marketing name the manufacturer
 * published.
 */
export function stripManufacturerPrefix(brand: string, value: string): string {
  const prefix = brand.trim();
  if (!prefix) return value;
  if (!value.toLowerCase().startsWith(prefix.toLowerCase())) return value;
  const rest = value.slice(prefix.length).trim();
  return rest.length >= 3 ? rest : value;
}

function hasLettersAndSpaces(value: string): boolean {
  return /[A-Za-z]/.test(value) && /\s/.test(value);
}

/**
 * Strip a trailing part-number token from a marketing name.
 *
 * "Dell Pro Essential 15 PV15260" -> "Dell Pro Essential 15".
 * A name with only two tokens is left alone, because its last token is the
 * model rather than a part number.
 */
export function stripPartNumber(value: string): string {
  const tokens = value.split(/\s+/).filter(Boolean);
  // A name of three tokens or fewer ends with its model designation, not a
  // part number: "Lenovo Chrome 500e" is a family plus a model.
  if (tokens.length < 4) return value;
  const last = tokens[tokens.length - 1];
  if (!looksLikePartNumber(last)) return value;
  return tokens.slice(0, -1).join(" ");
}

/**
 * Strip trailing size, generation and filler tokens from a family name.
 *
 * "ThinkPad E14 Gen 8" -> "ThinkPad E14"
 * "MacBook Air 13-inch (M4)" -> "MacBook Air"
 *
 * A bare number is deliberately *not* cut: in a family name like
 * "IdeaPad Slim 5" the number is the generation, not a size.
 */
export function stripTail(value: string): string {
  const tokens = value.split(/\s+/).filter(Boolean);
  const kept: string[] = [];
  for (const token of tokens) {
    const lower = token.toLowerCase().replace(/[.,]/g, "");
    if (GENERIC_TAIL.has(lower)) break;
    if (/^\d+(\.\d+)?\s*(inch|in|")?$/.test(lower) && lower.length > 2) break; // size
    if (/^\d+(st|nd|rd|th)$/.test(lower)) break; // ordinal edition
    if (/^(with|and|featuring|-)$/i.test(token)) break;
    kept.push(token);
  }
  const out = kept.join(" ").trim();
  return out.length >= 3 ? out : value.trim();
}

/**
 * Derive a chassis family from a bare part number.
 *
 * Part numbers conventionally end in a variant suffix: the base chassis code
 * followed by letters and/or digits that vary per configuration
 * (ASUS "B1503CVA" -> "B1503", Samsung "NP760XJG" -> "NP760X"). Hyphenated
 * part numbers carry the family in their first segment ("AL15-310P" ->
 * "AL15"). Only applied when the result is still long enough to be
 * meaningful.
 */
export function chassisPrefix(partNumber: string): string | null {
  const v = partNumber.trim();
  if (!v || /\s/.test(v)) return null;

  // Hyphenated part numbers: the first segment is the family.
  if (v.includes("-")) {
    const head = v.split("-")[0];
    if (head.length >= 3 && /\d/.test(head) && /[A-Za-z]/.test(head)) return head;
  }

  // Split into a leading alphanumeric run and a trailing variant run.
  const match = /^([A-Za-z]*\d[A-Za-z0-9]*?)([A-Za-z]{1,4})$/.exec(v);
  if (match && match[1].length >= 4) return match[1];
  const numeric = /^([A-Za-z]*\d+)([A-Za-z]{1,3})$/.exec(v);
  if (numeric && numeric[1].length >= 3) return numeric[1];
  return null;
}

// =============================================================================
// CONFIGURATION SIGNATURE
// =============================================================================

export interface ConfigSignatureInput {
  cpuModel: string | null;
  cpuCores: number | null;
  cpuPackages: number | null;
  ramGb: number | null;
  storageType: string | null;
  storageDrives: number | null;
  displaySizeIn: number | null;
  displayResolutionMp: number | null;
  touchScreen: boolean | null;
  batteryWh: number | null;
  os: string | null;
}

/**
 * Normalise a value that participates in the configuration signature.
 * Missing and empty collapse to the same token so that two records that
 * differ only by an unreported field are not treated as distinct
 * configurations.
 */
function sigToken(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "y" : "n";
  if (typeof value === "number") return String(value);
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Build the canonical configuration signature.
 *
 * The signature is the identity of a *configuration* within a model. It uses
 * only fields the certification actually asserts.
 */
export function configurationSignature(input: ConfigSignatureInput): string {
  return [
    sigToken(input.cpuModel),
    sigToken(input.cpuCores),
    sigToken(input.cpuPackages),
    sigToken(input.ramGb),
    sigToken(input.storageType),
    sigToken(input.storageDrives),
    sigToken(input.displaySizeIn),
    sigToken(input.displayResolutionMp),
    sigToken(input.touchScreen),
    sigToken(input.batteryWh),
    sigToken(input.os),
  ].join("|");
}

/** Short, stable hash of a configuration signature. */
export function signatureHash(signature: string): string {
  return createHash("sha256").update(signature, "utf8").digest("hex").slice(0, 8);
}

// =============================================================================
// SKU CODE
// =============================================================================

/**
 * Slugify a part number or model name into a URL/identity-safe token.
 * Keeps letters, digits and a small set of separators.
 */
export function slugToken(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/**
 * Canonical SKU code for a certified configuration.
 *
 * Shape: `<TOKEN>-<signature hash>`, for example `21Y7-3F1A9C2D`.
 *
 * - The token is the part number when the source reported one, otherwise the
 *   model name. It is human-recognisable.
 * - The hash is derived from the configuration signature, so two
 *   certifications of the *same* configuration collapse onto the same code,
 *   while two *different* configurations of the same part number stay
 *   distinct.
 */
export function canonicalSkuCode(
  partNumber: string | null | undefined,
  modelName: string,
  signature: string
): string {
  const token = slugToken(partNumber && partNumber.trim() ? partNumber : modelName);
  const base = token || "CONFIG";
  return `${base}-${signatureHash(signature)}`;
}
