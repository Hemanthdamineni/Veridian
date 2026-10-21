/**
 * Refresh the manufacturer's published list price for each product family.
 *
 * A manufacturer publishes one price for a product family, not one price per
 * configuration, so the figure is recorded on the family rather than on each
 * configuration. Attaching a "starting at" price to a specific
 * configuration would misstate what the buyer would pay, so it is never
 * done.
 *
 * The price is read from the structured `Product` markup the manufacturer
 * publishes, and the page it came from is stored with it, so the number can
 * be checked. Observations are appended to `PriceObservation` as well, so the
 * history of a family's price survives a refresh.
 *
 * The sources are listed in two files:
 *
 *   data/family-price-sources.csv    the family's own market — the price
 *                                    that becomes the family's list price
 *   data/regional-price-sources.csv  the same family in another market — the
 *                                    price is recorded as a regional
 *                                    observation and the family's own list
 *                                    price is left alone
 *
 * Both files have the same columns:
 *
 *   model_slug,manufacturer,region,currency,url
 *
 * The region and the currency have to agree. A euro price recorded for the
 * "EU" region says EUR, a pound price for the "UK" says GBP, a rupee price
 * for "IN" says INR. When a page publishes a different currency from the one
 * the list declares, the page is believed and the difference is reported: a
 * price is never filed under a currency the page did not publish.
 *
 * Every page is checked against the host's `robots.txt` before it is
 * fetched, and a path the policy disallows — or a policy that cannot be
 * read — is refused rather than fetched. Requests to one host are spaced by
 * at least a second.
 *
 * Usage:
 *   npm run db:prices
 *   npm run db:prices -- --limit 5
 *   npm run db:prices -- --json
 */

import fs from "fs";
import path from "path";
import { prisma } from "../src/lib/db";
import {
  extractJsonLdPrice,
  resolveRegion,
  type StructuredPrice,
} from "../src/lib/prices/source";

const USER_AGENT = "VeridianBot/1.0 (+https://veridian.dev; contact@veridian.dev)";
const TIMEOUT_MS = 30_000;
/** The shortest gap between two requests to the same host. */
const MIN_HOST_INTERVAL_MS = 1_000;

type Scope = "family" | "regional";

interface SourceRow {
  model_slug: string;
  manufacturer: string;
  region: string;
  currency: string;
  url: string;
  scope: Scope;
  /** The file the row came from, for the report. */
  file: string;
}

interface Outcome {
  row: SourceRow;
  modelSlug: string | null;
  ok: boolean;
  reason?: string;
  price?: number;
  currency?: string;
  region?: string;
  basis?: StructuredPrice["basis"];
  shape?: StructuredPrice["shape"];
  notes: string[];
}

async function main() {
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
  const asJson = process.argv.includes("--json");

  const rows = loadSources().slice(0, limit);
  if (rows.length === 0) {
    console.log("No family price sources configured. Nothing to do.");
    return;
  }

  const before = await countFamiliesWithCitablePrice();

  console.log(
    `Refreshing ${rows.length} family price source(s) ` +
      `(${rows.filter((row) => row.scope === "family").length} family, ` +
      `${rows.filter((row) => row.scope === "regional").length} regional).`
  );

  const outcomes: Outcome[] = [];
  const robotsCache = new Map<string, RobotsPolicy>();
  const lastRequestAt = new Map<string, number>();

  for (const row of rows) {
    outcomes.push(await refreshRow(row, robotsCache, lastRequestAt));
  }

  const report = await buildReport(outcomes, before);
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(report);
  }
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

/**
 * Read both source files.
 *
 * The family file carries the price of a family in the market the catalog
 * treats as its own. The regional file carries the same family in another
 * market; those prices are recorded as regional observations so that a
 * family's own list price is not overwritten by a price from a market the
 * reader is not shopping in.
 */
function loadSources(): SourceRow[] {
  const rows: SourceRow[] = [];
  for (const [file, scope] of [
    ["family-price-sources.csv", "family"],
    ["regional-price-sources.csv", "regional"],
  ] as Array<[string, Scope]>) {
    const csvPath = path.join(process.cwd(), "data", file);
    if (!fs.existsSync(csvPath)) continue;
    for (const row of parseCsv(fs.readFileSync(csvPath, "utf-8"))) {
      rows.push({ ...row, scope, file });
    }
  }
  return rows;
}

function parseCsv(text: string): Omit<SourceRow, "scope" | "file">[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const rows: Omit<SourceRow, "scope" | "file">[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((c) => c.trim());
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = cells[index] ?? "";
    });
    if (!record.model_slug || !record.url) continue;
    rows.push({
      model_slug: record.model_slug,
      manufacturer: record.manufacturer || "manufacturer",
      region: (record.region || "US").toUpperCase(),
      currency: (record.currency || "").toUpperCase(),
      url: record.url,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// One source
// ---------------------------------------------------------------------------

async function refreshRow(
  row: SourceRow,
  robotsCache: Map<string, RobotsPolicy>,
  lastRequestAt: Map<string, number>
): Promise<Outcome> {
  const outcome: Outcome = { row, modelSlug: null, ok: false, notes: [] };

  const models = await prisma.model.findMany({
    where: { slug: row.model_slug },
    select: {
      id: true,
      name: true,
      priceFrom: true,
      skus: { select: { id: true }, take: 1, orderBy: { id: "asc" } },
    },
  });
  if (models.length === 0) {
    outcome.reason = "no model with that slug";
    return outcome;
  }
  if (models.length > 1) {
    outcome.reason = `the slug "${row.model_slug}" is not unique — ${models.length} models share it`;
    return outcome;
  }
  const model = models[0];
  outcome.modelSlug = row.model_slug;

  let url: URL;
  try {
    url = new URL(row.url);
  } catch {
    outcome.reason = "the URL could not be parsed";
    return outcome;
  }

  // The policy is read first, and the page is only fetched when the policy
  // allows it. The wait keeps a second of space between the two requests as
  // well as between two pages.
  await waitForHost(url.host, lastRequestAt);
  const robots = await loadRobots(url.host, robotsCache);
  if (!robots.available) {
    outcome.reason = `the robots policy for ${url.host} could not be read, so the page was not fetched`;
    return outcome;
  }
  if (!robotsAllows(robots, url)) {
    outcome.reason = `robots.txt for ${url.host} disallows ${url.pathname}`;
    return outcome;
  }

  await waitForHost(url.host, lastRequestAt);

  let html: string;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      outcome.reason = `HTTP ${response.status}`;
      return outcome;
    }
    html = await response.text();
  } catch (error) {
    outcome.reason =
      error instanceof Error ? `${error.name}: ${error.message}` : "unknown error";
    return outcome;
  } finally {
    clearTimeout(timer);
  }

  const extracted = extractJsonLdPrice(html, { expectedCurrency: row.currency || undefined });
  if (!extracted) {
    outcome.reason = "the page published no structured price";
    return outcome;
  }

  // The region and the currency have to agree. The page is believed over the
  // list, and every difference is reported.
  const decision = resolveRegion({
    declaredCurrency: row.currency || undefined,
    declaredRegion: row.region,
    extracted,
  });
  const currency = decision.currency;
  const region = decision.region;
  outcome.notes.push(...decision.notes);

  outcome.ok = true;
  outcome.price = extracted.price;
  outcome.currency = currency;
  outcome.region = region;
  outcome.basis = extracted.basis;
  outcome.shape = extracted.shape;
  if (extracted.ambiguous) {
    outcome.notes.push(
      "the page published more than one priced product and the page title did not settle which one it is about"
    );
  }
  if (extracted.productName && extracted.productName !== model.name) {
    outcome.notes.push(
      `the page calls the product "${extracted.productName}"; the catalog calls it "${model.name}"`
    );
  }

  const observedAt = new Date();

  // The family's own list price. A regional source only sets it when the
  // family has none, so a price from another market never overwrites the
  // price of the market the catalog is about.
  const isCanonical = row.scope === "family" || model.priceFrom === null;
  if (isCanonical) {
    await prisma.model.update({
      where: { id: model.id },
      data: {
        priceFrom: extracted.price,
        priceFromCurrency: currency,
        priceFromUrl: row.url,
        priceFromObservedAt: observedAt,
        productUrl: row.url,
      },
    });
  }

  // The reading is appended to the price history of the family's first
  // configuration, so the price has the same provenance trail as every other
  // observation. It is the family's price and says so; it is never the price
  // of that configuration.
  const sku = model.skus[0];
  if (sku) {
    const sourceName = `${row.manufacturer} ${
      extracted.basis === "from" ? "starting price" : "list price"
    } for the family (${region})`;
    const existing = await prisma.priceObservation.findFirst({
      where: {
        skuId: sku.id,
        region,
        price: extracted.price,
        currency,
        sourceUrl: row.url,
      },
      select: { id: true },
    });
    if (!existing) {
      await prisma.priceObservation.create({
        data: {
          skuId: sku.id,
          region,
          currency,
          price: extracted.price,
          retailer: row.manufacturer,
          sourceUrl: row.url,
          sourceName,
          kind: "manufacturer",
          inStock: extracted.inStock,
          confidence: 0.9,
          timestamp: observedAt,
        },
      });
    }
  }

  return outcome;
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

interface RobotsRule {
  allow: boolean;
  pattern: string;
  length: number;
}

interface RobotsPolicy {
  available: boolean;
  rules: RobotsRule[];
  crawlDelayMs: number;
}

/**
 * Read a host's `robots.txt`.
 *
 * A policy that cannot be read is not a permission: the page is refused.
 */
async function loadRobots(host: string, cache: Map<string, RobotsPolicy>): Promise<RobotsPolicy> {
  const cached = cache.get(host);
  if (cached) return cached;

  const policy: RobotsPolicy = { available: false, rules: [], crawlDelayMs: MIN_HOST_INTERVAL_MS };
  cache.set(host, policy);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`https://${host}/robots.txt`, {
        headers: { "User-Agent": USER_AGENT },
        redirect: "follow",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) return policy;
    const text = await response.text();
    policy.available = true;
    policy.rules = parseRobots(text);
    policy.crawlDelayMs = Math.max(MIN_HOST_INTERVAL_MS, robotsCrawlDelay(text) * 1000);
  } catch {
    return policy;
  }
  return policy;
}

/**
 * The rules that apply to our user agent.
 *
 * The group whose token matches ours is used when there is one; the `*`
 * group is used otherwise. Within a group the longest matching pattern
 * decides, and `Allow` wins a tie.
 */
function parseRobots(text: string): RobotsRule[] {
  const groups: Array<{ agents: string[]; entries: string[] }> = [];
  let current: { agents: string[]; entries: string[] } | null = null;
  let expectingAgents = false;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (!current || !expectingAgents) {
        current = { agents: [], entries: [] };
        groups.push(current);
        expectingAgents = true;
      }
      current.agents.push(value.toLowerCase());
    } else if (field === "allow" || field === "disallow") {
      if (!current) continue;
      expectingAgents = false;
      if (field === "disallow" && value === "") continue;
      if (value === "") continue;
      current.entries.push(`${field}:${value}`);
    } else {
      expectingAgents = false;
    }
  }

  const token = USER_AGENT.split("/")[0].toLowerCase();
  const specific = groups.find((group) =>
    group.agents.some((agent) => agent !== "*" && token.includes(agent))
  );
  const wildcard = groups.find((group) => group.agents.includes("*"));
  const group = specific ?? wildcard;
  if (!group) return [];

  const rules: RobotsRule[] = [];
  for (const entry of group.entries) {
    const separator = entry.indexOf(":");
    const field = entry.slice(0, separator);
    const pattern = entry.slice(separator + 1);
    rules.push({ allow: field === "allow", pattern, length: pattern.length });
  }
  return rules;
}

function robotsCrawlDelay(text: string): number {
  for (const rawLine of text.split("\n")) {
    const line = rawLine.split("#")[0].trim();
    const match = /^crawl-delay\s*:\s*([\d.]+)$/i.exec(line);
    if (match) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0) return value;
    }
  }
  return 1;
}

function robotsAllows(policy: RobotsPolicy, url: URL): boolean {
  const target = url.pathname + url.search;
  let best: RobotsRule | null = null;
  for (const rule of policy.rules) {
    if (!robotsPatternMatches(rule.pattern, target)) continue;
    if (
      !best ||
      rule.length > best.length ||
      (rule.length === best.length && rule.allow)
    ) {
      best = rule;
    }
  }
  // No rule matches the path, so the path is allowed.
  return best ? best.allow : true;
}

function robotsPatternMatches(pattern: string, path: string): boolean {
  const source = pattern
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\\\$$/, "$");
  return new RegExp(`^${source}`).test(path);
}

/** Leave at least a second between two requests to the same host. */
async function waitForHost(host: string, lastRequestAt: Map<string, number>): Promise<void> {
  const previous = lastRequestAt.get(host) ?? 0;
  const wait = previous + MIN_HOST_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt.set(host, Date.now());
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

interface GroupSummary {
  tried: number;
  succeeded: number;
  failed: number;
  /** The model slugs priced in this group. */
  modelSlugs: string[];
  /** The manufacturers the group covers. */
  manufacturers: string[];
  /** The regions the group covers. */
  regions: string[];
}

interface Report {
  totals: {
    sources: number;
    familySources: number;
    regionalSources: number;
    succeeded: number;
    failed: number;
    familiesWithCitablePrice: number;
    familiesWithCitablePriceBefore: number;
    familiesPricedInThisRun: number;
    manufacturers: number;
    regions: number;
    regionsPriced: number;
  };
  byManufacturer: Record<string, GroupSummary>;
  byRegion: Record<string, GroupSummary>;
  families: Array<{
    slug: string;
    manufacturer: string;
    price: number | null;
    currency: string | null;
    region: string | null;
    regions: string[];
  }>;
  failures: Array<{
    model: string;
    manufacturer: string;
    region: string;
    url: string;
    reason: string;
  }>;
  notes: Array<{
    model: string;
    region: string;
    url: string;
    note: string;
  }>;
}

/**
 * The number of product families that carry a citable list price.
 *
 * A family carries one when the manufacturer's published price for the whole
 * family has been read from a page that states it, and the page is kept
 * beside the figure so it can be checked. A price with no page behind it is
 * a reference value, not a citable list price, and is not counted.
 */
async function countFamiliesWithCitablePrice(): Promise<number> {
  const models = await prisma.model.findMany({
    where: { priceFrom: { not: null }, priceFromUrl: { not: null } },
    select: { id: true },
  });
  return models.length;
}

async function buildReport(outcomes: Outcome[], before: number): Promise<Report> {
  const byManufacturer: Record<string, GroupSummary> = {};
  const byRegion: Record<string, GroupSummary> = {};

  const add = (bucket: Record<string, GroupSummary>, key: string): GroupSummary => {
    if (!bucket[key]) {
      bucket[key] = {
        tried: 0,
        succeeded: 0,
        failed: 0,
        modelSlugs: [],
        manufacturers: [],
        regions: [],
      };
    }
    return bucket[key];
  };

  const familyRows = new Map<string, { manufacturer: string; price: number | null; currency: string | null; region: string | null; regions: Set<string> }>();

  for (const outcome of outcomes) {
    const manufacturer = add(byManufacturer, outcome.row.manufacturer);
    const region = add(byRegion, outcome.row.region);
    manufacturer.tried++;
    region.tried++;
    if (!outcome.ok) {
      manufacturer.failed++;
      region.failed++;
      continue;
    }
    manufacturer.succeeded++;
    region.succeeded++;
    for (const bucket of [manufacturer, region]) {
      if (!bucket.modelSlugs.includes(outcome.row.model_slug as string)) {
        bucket.modelSlugs.push(outcome.row.model_slug as string);
      }
      if (!bucket.manufacturers.includes(outcome.row.manufacturer)) {
        bucket.manufacturers.push(outcome.row.manufacturer);
      }
      if (!bucket.regions.includes(outcome.row.region)) bucket.regions.push(outcome.row.region);
    }
    const entry = familyRows.get(outcome.row.model_slug) ?? {
      manufacturer: outcome.row.manufacturer,
      price: null,
      currency: null,
      region: null,
      regions: new Set<string>(),
    };
    entry.regions.add(outcome.region as string);
    if (outcome.row.scope === "family" || entry.price === null) {
      entry.price = outcome.price ?? null;
      entry.currency = outcome.currency ?? null;
      entry.region = outcome.region ?? null;
    }
    familyRows.set(outcome.row.model_slug, entry);
  }

  const models = await prisma.model.findMany({
    where: { slug: { in: [...familyRows.keys()] } },
    select: {
      slug: true,
      priceFrom: true,
      priceFromCurrency: true,
      series: { select: { manufacturer: { select: { name: true } } } },
    },
  });
  const bySlug = new Map(models.map((model) => [model.slug, model]));

  const families = [...familyRows.entries()].map(([slug, entry]) => {
    const model = bySlug.get(slug);
    return {
      slug,
      manufacturer: model?.series.manufacturer.name ?? entry.manufacturer,
      price: model?.priceFrom ?? entry.price,
      currency: model?.priceFromCurrency ?? entry.currency,
      region: entry.region,
      regions: [...entry.regions].sort(),
    };
  });
  families.sort((a, b) => a.slug.localeCompare(b.slug));

  const failures = outcomes
    .filter((outcome) => !outcome.ok)
    .map((outcome) => ({
      model: outcome.row.model_slug,
      manufacturer: outcome.row.manufacturer,
      region: outcome.row.region,
      url: outcome.row.url,
      reason: outcome.reason ?? "unknown reason",
    }));

  const notes = outcomes
    .filter((outcome) => outcome.notes.length > 0)
    .flatMap((outcome) =>
      outcome.notes.map((note) => ({
        model: outcome.row.model_slug,
        region: outcome.row.region,
        url: outcome.row.url,
        note,
      }))
    );

  const after = await countFamiliesWithCitablePrice();
  const pricedRegions = new Set(
    outcomes.filter((outcome) => outcome.ok).map((outcome) => outcome.region as string)
  );
  const familiesWithAPrice = families.filter(
    (family) => family.price !== null && family.currency !== null
  ).length;

  return {
    totals: {
      sources: outcomes.length,
      familySources: outcomes.filter((outcome) => outcome.row.scope === "family").length,
      regionalSources: outcomes.filter((outcome) => outcome.row.scope === "regional").length,
      succeeded: outcomes.filter((outcome) => outcome.ok).length,
      failed: failures.length,
      familiesWithCitablePrice: after,
      familiesWithCitablePriceBefore: before,
      familiesPricedInThisRun: familiesWithAPrice,
      manufacturers: Object.keys(byManufacturer).length,
      regions: Object.keys(byRegion).length,
      regionsPriced: pricedRegions.size,
    },
    byManufacturer,
    byRegion,
    families,
    failures,
    notes,
  };
}

function printReport(report: Report): void {
  const { totals } = report;
  console.log("\nSOURCES");
  console.log(`  tried                 ${totals.sources}`);
  console.log(`    family                ${totals.familySources}`);
  console.log(`    regional              ${totals.regionalSources}`);
  console.log(`  succeeded            ${totals.succeeded}`);
  console.log(`  failed               ${totals.failed}`);
  console.log(`  manufacturers        ${totals.manufacturers}`);
  console.log(`  regions priced       ${totals.regionsPriced} of ${totals.regions}`);

  console.log("\nBY MANUFACTURER");
  for (const [name, summary] of Object.entries(report.byManufacturer).sort()) {
    console.log(
      `  ${name.padEnd(10)} tried ${String(summary.tried).padStart(3)}  ` +
        `ok ${String(summary.succeeded).padStart(3)}  ` +
        `failed ${String(summary.failed).padStart(3)}  ` +
        `families ${summary.modelSlugs.length}  ` +
        `regions ${summary.regions.join(" ")}`
    );
  }

  console.log("\nBY REGION");
  for (const [name, summary] of Object.entries(report.byRegion).sort()) {
    console.log(
      `  ${name.padEnd(10)} tried ${String(summary.tried).padStart(3)}  ` +
        `ok ${String(summary.succeeded).padStart(3)}  ` +
        `failed ${String(summary.failed).padStart(3)}  ` +
        `families ${summary.modelSlugs.length}  ` +
        `manufacturers ${summary.manufacturers.join(" ")}`
    );
  }

  console.log("\nFAMILIES");
  for (const family of report.families) {
    console.log(
      `  ${family.slug.padEnd(28)} ${family.manufacturer.padEnd(8)} ` +
        `${family.price === null ? "-" : family.price} ${family.currency ?? ""}`.padEnd(52) +
        ` regions: ${family.regions.join(" ")}`
    );
  }

  if (report.notes.length > 0) {
    console.log("\nNOTES");
    // The same note usually holds for every region of a family, so the
    // notes are grouped and the regions counted rather than repeated.
    const grouped = new Map<string, { model: string; note: string; regions: Set<string> }>();
    for (const note of report.notes) {
      const key = `${note.model}::${note.note}`;
      const entry = grouped.get(key) ?? {
        model: note.model,
        note: note.note,
        regions: new Set<string>(),
      };
      entry.regions.add(note.region);
      grouped.set(key, entry);
    }
    for (const entry of grouped.values()) {
      const where = entry.regions.size > 1 ? ` (${entry.regions.size} regions)` : "";
      console.log(`  ${entry.model}${where}: ${entry.note}`);
    }
  }

  if (report.failures.length > 0) {
    console.log("\nFAILURES");
    for (const failure of report.failures) {
      console.log(`  ${failure.model} (${failure.region}) — ${failure.reason}`);
      console.log(`      ${failure.url}`);
    }
  }

  console.log(
    `\nFamilies carrying a citable list price: ${totals.familiesWithCitablePrice} ` +
      `(before this run: ${totals.familiesWithCitablePriceBefore}).`
  );
  console.log(
    `Families priced in this run: ${totals.familiesPricedInThisRun} ` +
      `across ${totals.manufacturers} manufacturers and ${totals.regionsPriced} regions.`
  );
}

main()
  .catch((error) => {
    console.error("Family price refresh failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
