/**
 * AI & Natural Language Features for Veridian
 *
 * - Natural Language to Filter parsing (deterministic, rule-based)
 * - AI Recommendation Engine
 *
 * The parser is the heart of the plain-language search: it turns a sentence
 * into structured filters and, just as importantly, reports what it did and
 * what it could not do. A word the reader wrote is always one of three
 * things — a constraint that was applied, an assumption that was disclosed,
 * or a word that was reported as ignored. It is never dropped in silence,
 * and a sentence that could be read two ways says so instead of quietly
 * picking one.
 *
 * Based on Veridian-spec.md B.5 and B.6
 */

import type { SkusQueryParams } from "@/types";

/* -------------------------------------------------------------------------- */
/* Interpretation types                                                        */
/* -------------------------------------------------------------------------- */

/** One constraint the parser actually applied. */
export interface NlAppliedFilter {
  /** The filter key (`displayType`, `ramMin`, …). */
  key: string;
  /** Short label for the UI ("Display"). */
  label: string;
  /** Human-readable value ("OLED", "≥ 16 GB"). */
  value: string;
}

/**
 * Constraints that are meaningful to a buyer but have no slot in
 * `SkusQueryParams`. The search route applies these to the database query
 * directly; the parser reports them like any other applied filter.
 */
export interface NlExtraFilters {
  /** Substring that must appear in the CPU model ("Core Ultra 7"). */
  cpuModelContains?: string;
  /** Any one of these substrings must appear in the GPU model. */
  gpuModelAnyOf?: string[];
  /** Substring that must appear in the operating system ("Windows"). */
  osContains?: string;
  /** Minimum display brightness in nits. */
  nitsMin?: string;
  /** Inclusive display-size window in inches (13.5 – 14.5 for "14 inch"). */
  displaySizeMin?: string;
  displaySizeMax?: string;
  /** Minimum stated battery life in hours. */
  batteryLifeHoursMin?: string;
}

/** A second, defensible reading of the same sentence. */
export interface NlAlternative {
  /** What this reading assumes ("16 GB of storage instead of RAM"). */
  label: string;
  /** A canonical sentence that re-parses into this reading. */
  query: string;
  /** The filters this reading applies. */
  filters: Partial<SkusQueryParams>;
  /** The extra filters this reading applies. */
  extra: NlExtraFilters;
  /** How plausible this reading is, 0 – 1. */
  confidence: number;
}

/**
 * The full, honest reading of a sentence.
 *
 * The rule that governs everything here: a word the reader wrote is either
 * applied as a constraint, disclosed as an assumption, or reported as an
 * ignored term. It is never dropped in silence.
 */
export interface NlInterpretation {
  /** Filters the catalog can enforce directly. */
  filters: Partial<SkusQueryParams>;
  /** Constraints applied outside `SkusQueryParams`. */
  extra: NlExtraFilters;
  /** Every applied constraint, in reading order. */
  applied: NlAppliedFilter[];
  /** Words that could not be turned into any constraint. */
  ignoredTerms: string[];
  /** Inferences the parser made (a currency, a use-case rule, a default). */
  assumptions: string[];
  /** How confident the parser is in this reading, 0 – 1. */
  confidence: number;
  /** Other readings of the same sentence, when it is genuinely ambiguous. */
  alternatives: NlAlternative[];
}

/* -------------------------------------------------------------------------- */
/* Vocabularies                                                                */
/* -------------------------------------------------------------------------- */

const CURRENCY_BY_SYMBOL: Record<string, { region: string; label: string; code: string }> = {
  $: { region: "US", label: "US dollars", code: "USD" },
  "£": { region: "UK", label: "pounds", code: "GBP" },
  "₹": { region: "IN", label: "rupees", code: "INR" },
  "€": { region: "EU", label: "euros", code: "EUR" },
};

const CURRENCY_BY_WORD: Record<string, { region: string; label: string; code: string }> = {
  dollar: CURRENCY_BY_SYMBOL["$"],
  dollars: CURRENCY_BY_SYMBOL["$"],
  usd: CURRENCY_BY_SYMBOL["$"],
  pound: CURRENCY_BY_SYMBOL["£"],
  pounds: CURRENCY_BY_SYMBOL["£"],
  gbp: CURRENCY_BY_SYMBOL["£"],
  rupee: CURRENCY_BY_SYMBOL["₹"],
  rupees: CURRENCY_BY_SYMBOL["₹"],
  inr: CURRENCY_BY_SYMBOL["₹"],
  euro: CURRENCY_BY_SYMBOL["€"],
  euros: CURRENCY_BY_SYMBOL["€"],
};

/**
 * Words that name a product, a brand or a part number. A leftover word from
 * this list is used as a free-text search term; anything else that is left
 * over is reported to the reader as ignored.
 */
const MODEL_VOCAB = new Set([
  "acer", "alienware", "apple", "asus", "aura", "chromebook", "cseries", "dell", "dynabook",
  "envy", "framework", "fujitsu", "galaxy", "gram", "gramme", "hp", "huawei", "ideapad", "imac",
  "inspiron", "iphone", "ipad", "lenovo", "legion", "lg", "macbook", "matebook", "mac",
  "msi", "nec", "omen", "panasonic", "pavilion", "precision", "razer", "redmibook", "rog",
  "samsung", "spectrum", "spectre", "surface", "swift", "swiftbook", "thinkpad", "toughbook",
  "toshiba", "vaio", "vivobook", "xps", "xiaomi", "yoga", "zenbook", "aero", "nitro",
  "aspire", "predator", "gaming", "chromecast", "ultrabook", "workstation", "chromebook",
]);

/** Grammatical noise: understood, carries no constraint, never reported. */
const FILLER_WORDS = new Set([
  "a", "an", "the", "and", "or", "of", "for", "with", "to", "in", "on", "at", "by", "from",
  "is", "are", "was", "were", "be", "been", "being", "am", "i", "me", "my", "we", "our", "us",
  "you", "your", "want", "need", "needs", "wanted", "looking", "look", "find", "show", "search",
  "buy", "purchase", "get", "please", "thanks", "thank", "that", "this", "these", "those",
  "there", "it", "its", "some", "any", "something", "anything", "stuff", "one", "also", "very",
  "really", "just", "only", "more", "most", "than", "then", "so", "but", "if", "when", "while",
  "because", "as", "can", "would", "should", "laptop", "laptops", "notebook", "notebooks",
  "computer", "computers", "machine", "machines", "device", "devices", "pc", "pcs", "about",
  "around", "approximately", "roughly", "near", "up", "atleast", "least", "minimum", "max",
  "maximum", "over", "above", "below", "under", "than", "within", "without", "no", "not",
  "display", "displays", "screen", "screens", "panel", "panels", "inch", "inches",
]);

/**
 * Words that express a preference the catalog cannot filter on. They are not
 * filler: the reader asked for something, so the parser says it could not
 * deliver instead of quietly pretending the request was never made.
 */
const UNFILTERABLE_WORDS = new Set([
  "beautiful", "sleek", "quiet", "premium", "nice", "cool", "awesome", "amazing", "stylish",
  "comfortable", "durable", "sturdy", "reliable", "solid", "best", "good", "great", "fast",
  "powerful", "affordable", "cheap", "modern", "clean", "minimal", "professional", "safe",
  "secure", "reliable", "efficient", "smooth", "sharp", "colorful", "customizable",
]);

/** GPU name fragments that mean "discrete graphics". */
const DEDICATED_GPU_MARKERS = ["RTX", "RX ", "GeForce", "Quadro", "Arc A"];

/** GPU name fragments that mean "graphics built into the processor". */
const INTEGRATED_GPU_MARKERS = ["Integrated", "UHD", "Iris", "Arc Graphics", "Adreno"];

/* -------------------------------------------------------------------------- */
/* Small helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Lower-case without changing the length of the string, so character offsets
 * in the lower-cased copy still line up with the original.
 */
function lowerSameLength(input: string): string {
  let out = "";
  for (const ch of input) {
    const lowered = ch.toLowerCase();
    out += lowered.length === ch.length ? lowered : ch;
  }
  return out;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* The parser                                                                  */
/* -------------------------------------------------------------------------- */

interface ParseContext {
  query: string;
  lower: string;
  /** One flag per character of `lower`: true when a rule consumed it. */
  consumed: boolean[];
  filters: Partial<SkusQueryParams>;
  extra: NlExtraFilters;
  applied: NlAppliedFilter[];
  assumptions: string[];
  ignored: string[];
  alternatives: NlAlternative[];
  /** Sort requests, in the order they were found. */
  sortRequests: Array<{ sort: string; label: string }>;
}

/** Mark a character range as interpreted. */
function consume(ctx: ParseContext, start: number, end: number): void {
  for (let i = Math.max(0, start); i < Math.min(ctx.consumed.length, end); i++) {
    ctx.consumed[i] = true;
  }
}

/** True when any part of the range was already consumed by another rule. */
function overlaps(ctx: ParseContext, start: number, end: number): boolean {
  for (let i = Math.max(0, start); i < Math.min(ctx.consumed.length, end); i++) {
    if (ctx.consumed[i]) return true;
  }
  return false;
}

/**
 * Run a global regex over the lower-cased query, skipping consumed matches.
 *
 * A handler that returns `false` declines the match: the characters are
 * released so a later, more specific rule can read them. "2 in 1" is the
 * reason this exists — the screen-size rule sees "2 in", decides it is not a
 * screen size, and lets the touch rule have the whole phrase.
 */
function each(
  ctx: ParseContext,
  pattern: RegExp,
  handler: (m: RegExpExecArray) => boolean | void
): void {
  const rx = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = rx.exec(ctx.lower)) !== null) {
    if (match[0].length === 0) {
      rx.lastIndex += 1;
      continue;
    }
    const start = match.index;
    const end = start + match[0].length;
    if (overlaps(ctx, start, end)) continue;
    if (handler(match) === false) continue;
    consume(ctx, start, end);
  }
}

function applyFilter(ctx: ParseContext, key: keyof SkusQueryParams, value: string, label: string, display: string): void {
  (ctx.filters as Record<string, string>)[key] = value;
  const existing = ctx.applied.find((a) => a.key === String(key));
  if (existing) {
    existing.value = display;
    existing.label = label;
    return;
  }
  ctx.applied.push({ key: String(key), label, value: display });
}

function applyExtra(ctx: ParseContext, patch: NlExtraFilters, label: string, display: string): void {
  Object.assign(ctx.extra, patch);
  ctx.applied.push({ key: "extra", label, value: display });
}

function assume(ctx: ParseContext, text: string): void {
  if (!ctx.assumptions.includes(text)) ctx.assumptions.push(text);
}

function requestSort(ctx: ParseContext, sort: string, label: string): void {
  if (!ctx.sortRequests.some((r) => r.sort === sort)) {
    ctx.sortRequests.push({ sort, label });
  }
}

/** Scale shorthand: 80k → 80 000, 1.5 lakh → 150 000, 1 crore → 10 000 000. */
function scaleValue(value: number, scale: string | undefined): number {
  const s = (scale ?? "").toLowerCase();
  if (s === "k" || s === "thousand") return value * 1000;
  if (s === "lakh" || s === "lakhs" || s === "lac") return value * 100000;
  if (s === "crore" || s === "crores") return value * 10000000;
  if (s === "million" || s === "m") return value * 1000000;
  return value;
}

/** Currency attached to a price phrase, if any. */
function currencyOf(symbol: string | undefined, word: string | undefined) {
  if (symbol && CURRENCY_BY_SYMBOL[symbol]) return CURRENCY_BY_SYMBOL[symbol];
  if (word) {
    const found = CURRENCY_BY_WORD[word.toLowerCase()];
    if (found) return found;
  }
  return undefined;
}

/* ------------------------------- price ----------------------------------- */

/**
 * A price number.
 *
 * The trailing guard makes the number atomic in practice: "1.5kg" can only be
 * read as 1.5, never as the price 1, because a shorter match would be
 * followed by a digit or a separator and is rejected.
 */
const PRICE_NUM = "(\\d+(?:,\\d{3})*(?:\\.\\d+)?)(?![\\d.,])";

/** Words that mean the number belongs to something other than the price. */
const PRICE_UNIT_GUARD =
  "(?!\\s*(?:kg\\b|kgs\\b|lbs?\\b|g\\b|gb\\b|tb\\b|inch\\b|inches\\b|\\bin\\b|wh\\b|hz\\b|nits?\\b|years?\\b|months?\\b|hours?\\b|hrs?\\b|ports?\\b|usb\\b|cores?\\b))";

const CURRENCY_WORD = "(dollars?|pounds?|rupees?|euros?|usd|inr|gbp)";
const SCALE_WORD = "(k|thousand|lakhs?|lac|crores?|million)?";

/** Record the currency of a price phrase, if the sentence named one. */
function noteCurrency(ctx: ParseContext, symbol: string | undefined, word: string | undefined): void {
  const currency = currencyOf(symbol, word);
  if (!currency) {
    assume(ctx, "No currency was named, so the price was read as US dollars.");
    return;
  }
  ctx.filters.region = currency.region;
  assume(
    ctx,
    `Read the price as ${currency.label} (${currency.code}); prices are compared in the ${currency.region} region.`
  );
}

function parsePrice(ctx: ParseContext): void {
  // between X and Y
  each(
    ctx,
    new RegExp(
      `\\bbetween\\s+([$£₹€]?)\\s*${PRICE_NUM}\\s*(?:and|to|-|–)\\s*([$£₹€]?)\\s*${PRICE_NUM}\\s*${CURRENCY_WORD}?`,
      "g"
    ),
    (m) => {
      const min = parseFloat(m[2].replace(/,/g, ""));
      const max = parseFloat(m[4].replace(/,/g, ""));
      applyFilter(ctx, "priceMin", String(min), "Price", `≥ ${min.toLocaleString()}`);
      applyFilter(ctx, "priceMax", String(max), "Price", `≤ ${max.toLocaleString()}`);
      noteCurrency(ctx, m[1] || m[3], m[5]);
    }
  );

  // an upper bound
  each(
    ctx,
    new RegExp(
      `\\b(?:under|below|less than|lower than|no more than|at most|up to|within|max(?:imum)?(?: of)?|budget(?: of)?|cheaper than)\\s+([$£₹€]?)\\s*${PRICE_NUM}${PRICE_UNIT_GUARD}\\s*${SCALE_WORD}\\s*${CURRENCY_WORD}?`,
      "g"
    ),
    (m) => {
      const amount = scaleValue(parseFloat(m[2].replace(/,/g, "")), m[3]);
      applyFilter(ctx, "priceMax", String(amount), "Price", `≤ ${amount.toLocaleString()}`);
      noteCurrency(ctx, m[1], m[4]);
      if (/budget/i.test(m[0])) {
        requestSort(ctx, "price_asc", "cheapest first");
      }
    }
  );

  // an approximate price
  each(
    ctx,
    new RegExp(
      `\\b(?:around|about|approximately|roughly|near)\\s+([$£₹€]?)\\s*${PRICE_NUM}${PRICE_UNIT_GUARD}\\s*${SCALE_WORD}\\s*${CURRENCY_WORD}?`,
      "g"
    ),
    (m) => {
      const amount = scaleValue(parseFloat(m[2].replace(/,/g, "")), m[3]);
      applyFilter(ctx, "priceMax", String(amount), "Price", `≤ ${amount.toLocaleString()}`);
      assume(ctx, `Read "around ${m[2]}" as a ceiling of ${amount.toLocaleString()}.`);
      noteCurrency(ctx, m[1], m[4]);
    }
  );

  // a bare symbol: $1500, ₹80,000, £1000
  each(ctx, /([$£₹€])\s*(\d+(?:,\d{3})*(?:\.\d+)?)(?![\d.,])/g, (m) => {
    const amount = parseFloat(m[2].replace(/,/g, ""));
    const currency = CURRENCY_BY_SYMBOL[m[1]];
    if (!currency) return;
    applyFilter(ctx, "priceMax", String(amount), "Price", `≤ ${amount.toLocaleString()} ${currency.code}`);
    ctx.filters.region = currency.region;
    assume(
      ctx,
      `Read the price as ${currency.label} (${currency.code}); prices are compared in the ${currency.region} region.`
    );
  });

  // a number followed by a currency word: 1500 dollars
  each(ctx, new RegExp(`(\\d+(?:,\\d{3})*(?:\\.\\d+)?)(?![\\d.,])\\s*${CURRENCY_WORD}\\b`, "g"), (m) => {
    const amount = parseFloat(m[1].replace(/,/g, ""));
    const currency = currencyOf(undefined, m[2]);
    if (!currency) return;
    applyFilter(ctx, "priceMax", String(amount), "Price", `≤ ${amount.toLocaleString()} ${currency.code}`);
    ctx.filters.region = currency.region;
    assume(
      ctx,
      `Read the price as ${currency.label} (${currency.code}); prices are compared in the ${currency.region} region.`
    );
  });

  // "budget" on its own asks for the cheapest laptops
  if (/\bbudget\b/.test(ctx.lower) && !ctx.filters.priceMax) {
    requestSort(ctx, "price_asc", "cheapest first");
    assume(ctx, 'Read "budget" as "cheapest first" — there was no amount to filter on.');
  }
}

/* ------------------------------- weight ---------------------------------- */

function parseWeight(ctx: ParseContext): void {
  each(ctx, /\b(?:under|below|less than|lower than|max(?:imum)?(?: of)?)\s+(\d+(?:\.\d+)?)\s*(kg|kgs|kilograms?|lbs?|pounds?)\b/g, (m) => {
    if (/lbs?|pounds?/.test(m[2])) {
      const kg = parseFloat(m[1]) * 0.453592;
      applyFilter(ctx, "weightMax", kg.toFixed(2), "Weight", `≤ ${kg.toFixed(2)} kg`);
      assume(ctx, `Converted ${m[1]} ${m[2]} to kilograms.`);
      return;
    }
    applyFilter(ctx, "weightMax", m[1], "Weight", `≤ ${m[1]} kg`);
  });

  each(ctx, /\b(\d+(?:\.\d+)?)\s*(kg|kgs|kilograms?)\s*(?:or\s*)?(?:less|under|below|lighter|maximum|max)\b/g, (m) => {
    applyFilter(ctx, "weightMax", m[1], "Weight", `≤ ${m[1]} kg`);
  });

  each(ctx, /\blightweight\b/g, () => {
    applyFilter(ctx, "weightMax", "1.5", "Weight", "≤ 1.5 kg");
    assume(ctx, 'Read "lightweight" as under 1.5 kg.');
  });

  // "light" can mean a light body or a bright screen — see the alternatives.
  each(ctx, /\blight\b/g, () => {
    applyFilter(ctx, "weightMax", "1.5", "Weight", "≤ 1.5 kg");
    assume(ctx, 'Read "light" as a light body (under 1.5 kg); it can also mean a bright screen.');
    ctx.alternatives.push({
      label: "a bright screen (400 nits or more) instead of a light body",
      query: "screen over 400 nits",
      filters: {},
      extra: { nitsMin: "400" },
      confidence: 0.4,
    });
  });
}

/* --------------------------- memory & storage ---------------------------- */

function parseMemory(ctx: ParseContext): void {
  // "32 GB of RAM", "16GB memory"
  each(ctx, /\b(\d+)\s*gb\s*(?:of\s+)?(?:ram|memory)\b/g, (m) => {
    applyFilter(ctx, "ramMin", m[1], "RAM", `≥ ${m[1]} GB`);
  });

  // "512 GB storage", "1TB SSD" — the unit word says what the number means
  each(ctx, /\b(\d+)\s*(tb|gb)\s*(?:of\s+)?(?:ssd|storage|nvme|disk|drive)\b/g, (m) => {
    const amount = parseInt(m[1], 10);
    if (/tb/.test(m[2])) {
      applyFilter(ctx, "storageMin", String(amount * 1024), "Storage", `≥ ${amount} TB`);
      return;
    }
    applyFilter(ctx, "storageMin", m[1], "Storage", `≥ ${m[1]} GB`);
  });

  // "1 TB" — a terabyte of storage, never of memory
  each(ctx, /\b(\d+)\s*tb\b/g, (m) => {
    applyFilter(ctx, "storageMin", String(parseInt(m[1], 10) * 1024), "Storage", `≥ ${m[1]} TB`);
  });

  // A bare "512 GB" is a capacity without a unit: storage is the likely
  // meaning, but 512 GB of memory exists too — offer both readings.
  each(ctx, /\b(\d+)\s*gb\b/g, (m) => {
    const amount = parseInt(m[1], 10);
    if (amount >= 256) {
      applyFilter(ctx, "storageMin", m[1], "Storage", `≥ ${m[1]} GB`);
      assume(ctx, `Read "${m[1]} GB" as storage — it was not qualified as memory.`);
      ctx.alternatives.push({
        label: `${m[1]} GB of memory instead of storage`,
        query: `${m[1]} GB RAM`,
        filters: { ramMin: m[1] },
        extra: {},
        confidence: 0.45,
      });
    } else {
      applyFilter(ctx, "ramMin", m[1], "RAM", `≥ ${m[1]} GB`);
    }
  });
}

/* ------------------------------- display --------------------------------- */

function parseDisplay(ctx: ParseContext): void {
  each(ctx, /\b(\d+(?:\.\d+)?)\s*(?:inch|inches|in\b|")/g, (m) => {
    const size = parseFloat(m[1]);
    // Not a screen size after all — let another rule read the phrase.
    if (size < 10 || size > 20) return false;
    const min = Math.round((size - 0.5) * 10) / 10;
    const max = Math.round((size + 0.5) * 10) / 10;
    applyExtra(
      ctx,
      { displaySizeMin: String(min), displaySizeMax: String(max) },
      "Screen size",
      `${size}" (${min}–${max}")`
    );
    assume(ctx, `Read "${m[0].trim()}" as a ${min}–${max} inch screen.`);
  });

  each(ctx, /\bmini[-\s]?led\b/g, () => {
    applyFilter(ctx, "displayType", "Mini-LED", "Display", "Mini-LED");
  });
  each(ctx, /\boled\b/g, () => {
    applyFilter(ctx, "displayType", "OLED", "Display", "OLED");
  });
  each(ctx, /\bips\b/g, () => {
    applyFilter(ctx, "displayType", "IPS", "Display", "IPS");
  });

  each(ctx, /\b(\d{2,3})\s*hz\b/g, (m) => {
    const hz = parseInt(m[1], 10);
    // Not a refresh rate after all — let another rule read the phrase.
    if (hz < 24 || hz > 480) return false;
    applyFilter(ctx, "refreshMin", m[1], "Refresh rate", `≥ ${hz} Hz`);
  });

  each(ctx, /\bhigh[-\s]?refresh(?:ed)?\b/g, () => {
    applyFilter(ctx, "refreshMin", "120", "Refresh rate", "≥ 120 Hz");
    assume(ctx, 'Read "high refresh" as 120 Hz or more.');
  });

  each(ctx, /\b(\d{3,4})\s*nits?\b/g, (m) => {
    applyExtra(ctx, { nitsMin: m[1] }, "Brightness", `≥ ${m[1]} nits`);
  });

  each(ctx, /\bbright(?:er)?\b/g, () => {
    if (ctx.extra.nitsMin) return;
    applyExtra(ctx, { nitsMin: "400" }, "Brightness", "≥ 400 nits");
    assume(ctx, 'Read "bright" as 400 nits or more.');
  });
}

/* ------------------------------- battery --------------------------------- */

function parseBattery(ctx: ParseContext): void {
  each(ctx, /\b(\d+(?:\.\d+)?)\s*wh\b/g, (m) => {
    applyFilter(ctx, "batteryMin", m[1], "Battery", `≥ ${m[1]} Wh`);
  });

  each(ctx, /\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b[^.]{0,20}\bbattery\b/g, (m) => {
    applyExtra(ctx, { batteryLifeHoursMin: m[1] }, "Battery life", `≥ ${m[1]} h`);
  });
  each(ctx, /\bbattery\b[^.]{0,20}\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/g, (m) => {
    if (ctx.extra.batteryLifeHoursMin) return;
    applyExtra(ctx, { batteryLifeHoursMin: m[1] }, "Battery life", `≥ ${m[1]} h`);
  });
}

/* ------------------------------- processor ------------------------------- */

function parseProcessor(ctx: ParseContext): void {
  // A named processor family. The family is applied as a CPU-model match, so
  // "Core Ultra 7" and "Core Ultra 9" stay apart even though both are Intel.
  const families: Array<{ pattern: RegExp; brand: string; describe: (m: RegExpExecArray) => string }> = [
    {
      pattern: /\bcore\s+ultra\s+(\d)\b/,
      brand: "Intel",
      describe: (m) => `Core Ultra ${m[1]}`,
    },
    {
      pattern: /\bcore\s+i([3579])\b/,
      brand: "Intel",
      describe: (m) => `Core i${m[1]}`,
    },
    {
      pattern: /\bryzen(?:\s+(ai))?\s+(\d)/,
      brand: "AMD",
      describe: (m) => `Ryzen${m[1] ? " AI" : ""} ${m[2]}`,
    },
    {
      pattern: /\bsnapdragon\s+x(\s+elite)?/,
      brand: "Qualcomm",
      describe: (m) => `Snapdragon X${m[1] ? " Elite" : ""}`,
    },
    {
      pattern: /\bm([1-4])(\s+(?:pro|max|base))?\b/,
      brand: "Apple",
      describe: (m) => `M${m[1]}${m[2] ? m[2].trim().replace(/\s+/g, " ") : ""}`,
    },
  ];

  for (const family of families) {
    each(ctx, family.pattern, (m) => {
      const model = family.describe(m);
      applyFilter(ctx, "cpuBrand", family.brand, "Processor", family.brand);
      applyExtra(ctx, { cpuModelContains: model }, "Processor family", model);
    });
  }

  // The brand word on its own still says something, and it has to be consumed
  // so it is not reported as an ignored word.
  const brands: Array<{ pattern: RegExp; brand: string }> = [
    { pattern: /\bintel\b/, brand: "Intel" },
    { pattern: /\bamd\b/, brand: "AMD" },
    { pattern: /\bqualcomm\b/, brand: "Qualcomm" },
    { pattern: /\bapple\b/, brand: "Apple" },
    { pattern: /\bryzen\b/, brand: "AMD" },
    { pattern: /\bsnapdragon\b/, brand: "Qualcomm" },
  ];
  for (const entry of brands) {
    each(ctx, entry.pattern, () => {
      if (!ctx.filters.cpuBrand) {
        applyFilter(ctx, "cpuBrand", entry.brand, "Processor", entry.brand);
      }
    });
  }
}

/* ------------------------------- graphics -------------------------------- */

function parseGraphics(ctx: ParseContext): void {
  each(ctx, /\b(?:dedicated|discrete)\s+(?:gpus?|graphics?|cards?)\b/g, () => {
    applyExtra(ctx, { gpuModelAnyOf: DEDICATED_GPU_MARKERS }, "Graphics", "dedicated GPU");
  });
  each(ctx, /\b(rtx|geforce|quadro)\b/g, (m) => {
    applyExtra(ctx, { gpuModelAnyOf: [m[1].toUpperCase()] }, "Graphics", m[1].toUpperCase());
  });
  each(ctx, /\bradeon\b/g, () => {
    applyExtra(ctx, { gpuModelAnyOf: ["Radeon"] }, "Graphics", "Radeon");
  });
  each(ctx, /\biris(?:\s+xe)?\b/g, () => {
    applyExtra(ctx, { gpuModelAnyOf: ["Iris"] }, "Graphics", "Iris");
  });
  each(ctx, /\bintegrated\s+(?:gpus?|graphics?|cards?)\b/g, () => {
    applyExtra(ctx, { gpuModelAnyOf: INTEGRATED_GPU_MARKERS }, "Graphics", "integrated graphics");
  });
  // A bare "GPU" or "graphics" says nothing on its own, but it is still a word
  // the reader wrote — it is understood, not ignored.
  each(ctx, /\b(?:gpus?|graphics?|graphics cards?)\b/g, () => {
    // consumed by the rules above when a qualifier is present
  });
}

/* ------------------------------ operating system ------------------------- */

function parseOs(ctx: ParseContext): void {
  each(ctx, /\bmac\s*os\b|\bos\s*x\b|\bmacos\b/g, () => {
    applyExtra(ctx, { osContains: "macOS" }, "Operating system", "macOS");
  });
  each(ctx, /\bwindows\b/g, () => {
    applyExtra(ctx, { osContains: "Windows" }, "Operating system", "Windows");
  });
  each(ctx, /\blinux\b/g, () => {
    applyExtra(ctx, { osContains: "Linux" }, "Operating system", "Linux");
  });
}

/* -------------------------------- touch ---------------------------------- */

function parseTouch(ctx: ParseContext): void {
  each(ctx, /\b(?:no|without|not|non)\s+(?:a\s+)?touch(?:screen)?\b|\bnon[-\s]?touch\b/g, () => {
    applyFilter(ctx, "touch", "false", "Touch", "No");
  });
  each(ctx, /\b(?:touchscreen|touch\s*screen|touch|2[-\s]in[-\s]1|convertible)\b/g, () => {
    if (ctx.filters.touch === "false") return;
    applyFilter(ctx, "touch", "true", "Touch", "Yes");
  });
}

/* ------------------------------- use cases ------------------------------- */

interface UseCase {
  pattern: RegExp;
  label: string;
  /** The constraints this use case implies, and how to say so. */
  patch: Array<{ key: keyof SkusQueryParams; value: string; text: string }>;
}

const USE_CASES: UseCase[] = [
  {
    pattern: /\b(?:programming|coding|development|developer|devops|software development)\b/,
    label: "programming",
    patch: [
      { key: "ramMin", value: "16", text: "at least 16 GB of RAM" },
      { key: "weightMax", value: "1.8", text: "under 1.8 kg" },
    ],
  },
  {
    pattern: /\bgaming\b/,
    label: "gaming",
    patch: [
      { key: "displayType", value: "IPS", text: "an IPS panel" },
      { key: "refreshMin", value: "120", text: "at least 120 Hz" },
    ],
  },
  {
    pattern: /\b(?:business|work|office|productivity)\b/,
    label: "work",
    patch: [
      { key: "ramMin", value: "16", text: "at least 16 GB of RAM" },
      { key: "weightMax", value: "1.5", text: "under 1.5 kg" },
    ],
  },
  {
    pattern: /\b(?:student|students|university|college|school|campus)\b/,
    label: "university",
    patch: [
      { key: "priceMax", value: "1000", text: "under $1 000" },
      { key: "weightMax", value: "1.5", text: "under 1.5 kg" },
    ],
  },
  {
    pattern: /\b(?:travel|travelling|traveling|portable|frequent flyer|on the road)\b/,
    label: "travel",
    patch: [{ key: "weightMax", value: "1.3", text: "under 1.3 kg" }],
  },
  {
    pattern: /\b(?:video editing|video editor|creative|photo editing|photography|design|3d|editing)\b/,
    label: "video editing",
    patch: [
      { key: "ramMin", value: "32", text: "at least 32 GB of RAM" },
      { key: "displayType", value: "OLED", text: "an OLED panel" },
    ],
  },
];

function parseUseCases(ctx: ParseContext): void {
  for (const useCase of USE_CASES) {
    each(ctx, useCase.pattern, (m) => {
      // "not a gaming laptop" — the wish is inverted, so nothing is applied.
      const before = ctx.lower.slice(Math.max(0, m.index - 24), m.index);
      if (/\b(?:not|no|without|except|isn'?t|aren'?t|don'?t|non)\s+(?:a|an|the)?\s*$/.test(before)) {
        assume(
          ctx,
          `Read "not ${useCase.label}" as an exclusion: no ${useCase.label}-specific requirement was applied. The catalog cannot hide those laptops.`
        );
        return;
      }
      const spoken: string[] = [];
      for (const entry of useCase.patch) {
        const current = (ctx.filters as Record<string, string | undefined>)[entry.key];
        if (current) continue;
        const label = entry.key === "ramMin" ? "RAM" : entry.key === "weightMax" ? "Weight" : entry.key === "priceMax" ? "Price" : entry.key === "displayType" ? "Display" : "Refresh rate";
        const display =
          entry.key === "ramMin"
            ? `≥ ${entry.value} GB`
            : entry.key === "weightMax"
              ? `≤ ${entry.value} kg`
              : entry.key === "priceMax"
                ? `≤ ${Number(entry.value).toLocaleString()}`
                : entry.key === "displayType"
                  ? entry.value
                  : `≥ ${entry.value} Hz`;
        applyFilter(ctx, entry.key, entry.value, label, display);
        spoken.push(entry.text);
      }
      if (spoken.length > 0) {
        assume(ctx, `Read "for ${useCase.label}" as ${spoken.join(" and ")}.`);
      }
    });
  }
}

/* --------------------------- relative wishes ----------------------------- */

function parseWishes(ctx: ParseContext): void {
  each(ctx, /\blightest\b/g, () => {
    requestSort(ctx, "weight_asc", "lightest first");
  });
  each(ctx, /\blongest\s+battery(?:\s+life)?\b/g, () => {
    requestSort(ctx, "battery_desc", "longest battery life first");
  });
  each(ctx, /\bbest\b[^.]{0,20}\bbattery(?:\s+life)?\b/g, () => {
    requestSort(ctx, "battery_desc", "longest battery life first");
  });
  each(ctx, /\b(?:cheapest|least expensive|lowest price|most affordable|cheapest first)\b/g, () => {
    requestSort(ctx, "price_asc", "cheapest first");
  });
  each(ctx, /\b(?:biggest|largest)\s+(?:screen|display)\b/g, () => {
    requestSort(ctx, "display_size_desc", "largest screen first");
  });
  each(ctx, /\bmost\s+(?:memory|ram)\b/g, () => {
    requestSort(ctx, "ram_desc", "most memory first");
  });
  each(ctx, /\b(?:newest|latest)\b/g, () => {
    requestSort(ctx, "newest", "newest first");
  });
  each(ctx, /\b(?:affordable|cheap)\b/g, () => {
    requestSort(ctx, "price_asc", "cheapest first");
  });

  // "a big battery" asks for capacity, "a long battery" for endurance.
  each(ctx, /\b(?:big|bigger|large|larger|biggest)\s+battery\b/g, () => {
    applyFilter(ctx, "batteryMin", "70", "Battery", "≥ 70 Wh");
    assume(ctx, 'Read "big battery" as a battery of at least 70 Wh.');
    ctx.alternatives.push({
      label: "the longest battery life instead of the biggest battery",
      query: "longest battery life",
      filters: { sort: "battery_desc" },
      extra: {},
      confidence: 0.45,
    });
  });
  each(ctx, /\b(?:long|longer)\s+battery\b/g, () => {
    if (ctx.filters.sort) return;
    requestSort(ctx, "battery_desc", "longest battery life first");
    ctx.alternatives.push({
      label: "the biggest battery (70 Wh or more) instead of the longest life",
      query: "battery over 70Wh",
      filters: { batteryMin: "70" },
      extra: {},
      confidence: 0.45,
    });
  });
}

/* ------------------------------- residual -------------------------------- */

/** Split the query into word tokens with their offsets in the original text. */
function tokenize(query: string): Array<{ text: string; start: number; end: number }> {
  const tokens: Array<{ text: string; start: number; end: number }> = [];
  const re = /[A-Za-z0-9]+(?:[''\-][A-Za-z0-9]+)*/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(query)) !== null) {
    tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length });
  }
  return tokens;
}

function isConsumed(ctx: ParseContext, token: { start: number; end: number }): boolean {
  for (let i = token.start; i < token.end; i++) {
    if (ctx.consumed[i]) return true;
  }
  return false;
}

/**
 * Decide what is left of the sentence.
 *
 * A leftover word is either filler (grammar), a model name (used as a free
 * text search) or something the catalog cannot act on (reported as ignored).
 */
function collectResidual(ctx: ParseContext): void {
  const tokens = tokenize(ctx.query);
  const keywords: string[] = [];
  let previousWasKeyword = false;

  for (const token of tokens) {
    if (isConsumed(ctx, token)) continue;
    const word = token.text.toLowerCase();

    if (FILLER_WORDS.has(word)) {
      consume(ctx, token.start, token.end);
      previousWasKeyword = false;
      continue;
    }

    if (UNFILTERABLE_WORDS.has(word)) {
      ctx.ignored.push(token.text);
      consume(ctx, token.start, token.end);
      previousWasKeyword = false;
      continue;
    }

    const looksLikeModel =
      MODEL_VOCAB.has(word) ||
      (/[a-z]/i.test(token.text) && /\d/.test(token.text)) ||
      // A capitalised word that is not simply the first word of the sentence.
      (/^[A-Z]/.test(token.text) && token.start > 0 && ctx.query.slice(0, token.start).trim().length > 0) ||
      // A word that continues a model name: "macbook air", "thinkpad t14".
      previousWasKeyword;

    if (looksLikeModel) {
      keywords.push(token.text);
      consume(ctx, token.start, token.end);
      previousWasKeyword = true;
      continue;
    }

    ctx.ignored.push(token.text);
    consume(ctx, token.start, token.end);
    previousWasKeyword = false;
  }

  if (keywords.length > 0) {
    ctx.filters.q = keywords.join(" ");
    ctx.applied.push({ key: "q", label: "Text", value: ctx.filters.q });
  }
}

/* -------------------------------------------------------------------------- */
/* Public entry points                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Read a sentence the way a buyer meant it, and say exactly what was done.
 *
 * The parser is a single pass over the string: every rule that fires marks
 * the characters it consumed. Whatever is left over is either filler, a
 * model name used as a free-text search, or a word the catalog cannot act on
 * — the last group is reported to the reader rather than dropped.
 */
export function interpretNaturalLanguageQuery(query: string): NlInterpretation {
  const ctx: ParseContext = {
    query,
    lower: lowerSameLength(query),
    consumed: [],
    filters: {},
    extra: {},
    applied: [],
    assumptions: [],
    ignored: [],
    alternatives: [],
    sortRequests: [],
  };
  ctx.consumed = new Array(ctx.lower.length).fill(false);

  if (!query.trim()) {
    return {
      filters: {},
      extra: {},
      applied: [],
      ignoredTerms: [],
      assumptions: [],
      confidence: 0,
      alternatives: [],
    };
  }

  parsePrice(ctx);
  parseWeight(ctx);
  parseMemory(ctx);
  parseDisplay(ctx);
  parseBattery(ctx);
  parseProcessor(ctx);
  parseGraphics(ctx);
  parseOs(ctx);
  parseTouch(ctx);
  parseUseCases(ctx);
  parseWishes(ctx);
  collectResidual(ctx);

  // One sort can only be applied. When the sentence asks for several, the
  // most specific one wins and the reader is told what was dropped.
  if (ctx.sortRequests.length > 0) {
    const chosen = ctx.sortRequests[0];
    ctx.filters.sort = chosen.sort;
    ctx.applied.push({ key: "sort", label: "Sort", value: chosen.label });
    if (ctx.sortRequests.length > 1) {
      const others = ctx.sortRequests.slice(1).map((r) => r.label).join(", ");
      assume(ctx, `The sentence asked for several orders; sorted by ${chosen.label} and not by ${others}.`);
    }
  }

  const ignoredTerms = Array.from(new Set(ctx.ignored));
  const appliedCount = ctx.applied.length;
  let confidence = 0.5 + 0.08 * appliedCount - 0.12 * ignoredTerms.length;
  if (ctx.alternatives.length > 0) confidence -= 0.15;
  confidence -= Math.min(0.15, 0.03 * ctx.assumptions.length);
  confidence = clamp(round2(confidence), 0.02, 1);
  if (appliedCount === 0) confidence = Math.min(confidence, 0.15);

  return {
    filters: ctx.filters,
    extra: ctx.extra,
    applied: ctx.applied,
    ignoredTerms,
    assumptions: ctx.assumptions,
    confidence,
    alternatives: ctx.alternatives.map((alt) => ({
      ...alt,
      confidence: round2(alt.confidence),
    })),
  };
}

/**
 * Parse a natural language query into structured filter parameters.
 *
 * This is the compact view of {@link interpretNaturalLanguageQuery}; it keeps
 * the historical signature so existing callers keep working.
 */
export function parseNaturalLanguageQuery(query: string): Partial<SkusQueryParams> {
  return interpretNaturalLanguageQuery(query).filters;
}

/**
 * The part of the sentence that still names a product.
 *
 * Words the catalog cannot act on are not returned here — they are reported
 * as ignored terms by {@link interpretNaturalLanguageQuery}.
 */
export function extractKeyword(query: string): string {
  return interpretNaturalLanguageQuery(query).filters.q ?? "";
}

/**
 * Generate a human-readable description of applied filters.
 */
export function describeFilters(params: Partial<SkusQueryParams>): string {
  const parts: string[] = [];

  if (params.displayType) parts.push(`${params.displayType} display`);
  if (params.cpuBrand) parts.push(`${params.cpuBrand} processor`);
  if (params.ramMin) parts.push(`at least ${params.ramMin}GB RAM`);
  if (params.storageMin) {
    const storage = parseInt(params.storageMin, 10);
    parts.push(`at least ${storage >= 1024 ? `${storage / 1024}TB` : `${storage}GB`} storage`);
  }
  if (params.weightMax) parts.push(`under ${params.weightMax}kg`);
  if (params.batteryMin) parts.push(`at least ${params.batteryMin}Wh battery`);
  if (params.refreshMin) parts.push(`at least ${params.refreshMin}Hz refresh`);
  if (params.touch === "true") parts.push("touchscreen");
  if (params.touch === "false") parts.push("no touchscreen");
  if (params.priceMax) {
    const currency = params.region === "IN" ? "₹" : params.region === "UK" ? "£" : params.region === "EU" ? "€" : "$";
    parts.push(`under ${currency}${parseInt(params.priceMax, 10).toLocaleString()}`);
  }

  if (parts.length === 0) return "Showing all laptops";
  return "Filtering by: " + parts.join(", ");
}

/* -------------------------------------------------------------------------- */
/* Recommendation Engine                                                       */
/* -------------------------------------------------------------------------- */

export interface RecommendationInput {
  budget?: number;
  currency?: string;
  min_ram?: number;
  preferred_size?: number;
  display_preference?: "IPS" | "OLED" | "Mini-LED";
  use_case?: "programming" | "gaming" | "business" | "creative" | "student" | "travel";
  brand_preference?: string[];
  require_touch?: boolean;
  max_weight?: number;
}

export interface Recommendation {
  sku_id: string;
  name: string;
  price: number | null;
  currency: string;
  match_score: number;
  pros: string[];
  cons: string[];
  reason: string;
}

/**
 * Score a laptop against user requirements.
 * Returns a score from 0-100 and lists of pros/cons.
 */
export function scoreLaptopForRecommendation(
  laptop: {
    id: string;
    name: string;
    price: number | null;
    currency: string;
    ram_gb: number;
    display_size_in: number | null;
    display_type: string | null;
    weight_kg: number | null;
    battery_wh: number | null;
    cpu_brand: string;
    brand: string;
  },
  requirements: RecommendationInput
): Recommendation {
  let score = 50; // Base score
  const pros: string[] = [];
  const cons: string[] = [];

  // Budget scoring (only when a real price is known)
  const price = laptop.price;
  if (requirements.budget) {
    if (price !== null && price <= requirements.budget) {
      score += 20;
      pros.push(`Within budget (${requirements.currency || "$"}${price})`);
    } else if (price !== null && price <= requirements.budget * 1.1) {
      score += 5;
      cons.push(`Slightly over budget (${requirements.currency || "$"}${price})`);
    } else if (price === null) {
      cons.push(`No reported price to check against budget`);
    } else {
      score -= 30;
      cons.push(`Over budget (${requirements.currency || "$"}${price} vs ${requirements.budget})`);
    }
  }

  // RAM scoring
  if (requirements.min_ram) {
    if (laptop.ram_gb >= requirements.min_ram) {
      score += 15;
      pros.push(`${laptop.ram_gb}GB RAM meets requirement`);
    } else {
      score -= 20;
      cons.push(`Only ${laptop.ram_gb}GB RAM (need ${requirements.min_ram}GB)`);
    }
  }

  // Display size scoring
  if (requirements.preferred_size && laptop.display_size_in !== null) {
    const sizeDiff = Math.abs(laptop.display_size_in - requirements.preferred_size);
    if (sizeDiff < 0.5) {
      score += 10;
      pros.push(`${laptop.display_size_in}" display as preferred`);
    } else if (sizeDiff < 1) {
      score += 5;
    } else {
      cons.push(`${laptop.display_size_in}" display (preferred ${requirements.preferred_size}")`);
    }
  }

  // Display type scoring
  if (requirements.display_preference) {
    if (laptop.display_type === requirements.display_preference) {
      score += 10;
      pros.push(`${laptop.display_type} display as preferred`);
    } else {
      cons.push(`${laptop.display_type} display (preferred ${requirements.display_preference})`);
    }
  }

  // Weight scoring
  if (requirements.max_weight && laptop.weight_kg !== null) {
    if (laptop.weight_kg <= requirements.max_weight) {
      score += 10;
      pros.push(`Lightweight at ${laptop.weight_kg}kg`);
    } else {
      score -= 15;
      cons.push(`Heavy at ${laptop.weight_kg}kg (max ${requirements.max_weight}kg)`);
    }
  }

  // Touch requirement
  if (requirements.require_touch) {
    // Would need touch field in laptop data
  }

  // Brand preference
  if (requirements.brand_preference && requirements.brand_preference.length > 0) {
    if (requirements.brand_preference.some(b => laptop.brand.toLowerCase().includes(b.toLowerCase()))) {
      score += 5;
      pros.push(`Preferred brand: ${laptop.brand}`);
    }
  }

  // Use case bonuses
  if (requirements.use_case === "programming" && laptop.ram_gb >= 16) {
    score += 5;
    pros.push("Good for programming");
  } else if (requirements.use_case === "gaming" && laptop.display_type === "IPS") {
    score += 5;
    pros.push("Good display for gaming");
  } else if (requirements.use_case === "travel" && laptop.weight_kg !== null && laptop.weight_kg < 1.3) {
    score += 10;
    pros.push("Great for travel");
  }

  // Battery bonus
  if (laptop.battery_wh !== null && laptop.battery_wh >= 70) {
    score += 5;
    pros.push("Excellent battery life");
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  return {
    sku_id: laptop.id,
    name: laptop.name,
    price,
    currency: laptop.currency || "USD",
    match_score: score,
    pros: pros.slice(0, 4),
    cons: cons.slice(0, 3),
    reason: generateReason(laptop, requirements, score),
  };
}

function generateReason(
  laptop: { name: string; brand: string; ram_gb: number; display_type: string | null; weight_kg: number | null },
  requirements: RecommendationInput,
  score: number
): string {
  if (score >= 80) {
    return `Excellent match - ${laptop.brand} ${laptop.name} meets your key requirements`;
  } else if (score >= 60) {
    return `Good match - ${laptop.brand} ${laptop.name} fits most of your needs`;
  } else if (score >= 40) {
    return `Decent option - ${laptop.brand} ${laptop.name} with some trade-offs`;
  } else {
    return `May not be the best fit - consider other options`;
  }
}
