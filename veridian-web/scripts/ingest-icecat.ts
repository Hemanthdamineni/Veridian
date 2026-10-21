/**
 * Icecat open product data — ingestion.
 *
 * Reads the products Icecat carries, matches them against the Veridian
 * catalog and appends the prices it finds to the price history.
 *
 * What it writes:
 *
 *   * `Seller` — the Icecat distributor, upserted once.
 *   * `RetailerListing` — the product at that seller, attached to the
 *     configuration it was matched to.
 *   * `PriceObservation` — the price, appended, never overwritten.
 *   * `PriceHistory` — the same price on the listing's own history.
 *
 * What it does not write: a price that the source did not publish, a
 * specification it could not read unambiguously, and a match it could not
 * justify. A product that does not match a configuration is reported as
 * unmatched and nothing is written for it.
 *
 * Usage:
 *   npx tsx scripts/ingest-icecat.ts --dry-run --limit 20
 *   npx tsx scripts/ingest-icecat.ts --ids-file data/icecat-products.json
 */

import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import {
  IcecatAccessError,
  IcecatClient,
  IcecatError,
  ICECAT_LAPTOP_CATEGORY_ID,
  icecatIdFromUrl,
} from "../src/lib/icecat/client";
import { ICECAT_SOURCE_NAME, parseProduct } from "../src/lib/icecat/parse";
import { matchProductToCatalog } from "../src/lib/icecat/match";
import type {
  CatalogSku,
  IcecatPrice,
  IcecatProduct,
  IcecatProductRef,
  IngestSummary,
  MatchCandidate,
  PriceStore,
  SellerInput,
} from "../src/lib/icecat/types";

/**
 * The seller Icecat is recorded as.
 *
 * Icecat does not publish a market for its data, so the seller and its
 * listings carry the neutral region `GLOBAL` instead of a country. A price
 * that names its own region carries that region on the observation.
 */
export const ICECAT_SELLER: SellerInput = {
  name: "Icecat",
  slug: "icecat",
  region: "GLOBAL",
  baseUrl: "https://live.icecat.biz",
  scrapeMethod: "api",
};

/** The region used when the source names none. */
export const DEFAULT_REGION = "GLOBAL";

/**
 * The window an observation is considered a duplicate in.
 *
 * Two readings of the same price for the same product, from the same URL,
 * inside one hour are the same reading. Anything older is history and is
 * appended again.
 */
export const OBSERVATION_BUCKET_MS = 60 * 60 * 1000;

/** The default list of products to read. */
export const DEFAULT_IDS_FILE = path.join("data", "icecat-products.json");

export interface ParsedArgs {
  limit: number;
  dryRun: boolean;
  idsFile: string;
  discover: boolean;
  seeds: string[];
}

/** Read the command line. */
export function parseArgs(argv: string[]): ParsedArgs {
  const limitIndex = argv.indexOf("--limit");
  const idsIndex = argv.indexOf("--ids-file");
  const seedsIndex = argv.indexOf("--seeds");
  const idsFile =
    idsIndex > -1 && argv[idsIndex + 1]
      ? argv[idsIndex + 1]
      : path.join(process.cwd(), DEFAULT_IDS_FILE);

  let limit = Number.POSITIVE_INFINITY;
  if (limitIndex > -1) {
    const raw = Number(argv[limitIndex + 1]);
    if (!Number.isFinite(raw) || raw <= 0) {
      throw new Error("--limit needs a positive number.");
    }
    limit = raw;
  }

  const seeds =
    seedsIndex > -1 && argv[seedsIndex + 1]
      ? argv[seedsIndex + 1]
          .split(",")
          .map((seed) => seed.trim())
          .filter((seed) => seed.length > 0)
      : [];

  return {
    limit,
    dryRun: argv.includes("--dry-run"),
    idsFile: path.resolve(idsFile),
    discover: argv.includes("--discover"),
    seeds,
  };
}

/**
 * The hour a timestamp falls in.
 *
 * Observations are bucketed by the hour so a repeated run inside the same
 * hour does not write the same price twice, while a run in a later hour
 * appends a fresh reading of the same price.
 */
export function bucketFor(timestamp: Date): { bucketStart: Date; bucketEnd: Date } {
  const bucketStart = new Date(
    Math.floor(timestamp.getTime() / OBSERVATION_BUCKET_MS) * OBSERVATION_BUCKET_MS
  );
  return { bucketStart, bucketEnd: new Date(bucketStart.getTime() + OBSERVATION_BUCKET_MS) };
}

/**
 * The retailer's own identifier for the listing.
 *
 * Icecat identifies a product by the brand together with the brand's product
 * code, so both are part of the identifier.
 */
export function listingKey(product: IcecatProduct): string {
  return `${product.brand.trim()} ${product.productCode.trim()}`.trim();
}

/**
 * Map a match method onto the vocabulary the catalog documents.
 *
 * The catalog records how a listing was matched as `mpn | upc | name+spec |
 * manual`; the connector's finer-grained methods collapse onto it.
 */
export function toSchemaMatchMethod(method: MatchCandidate["method"]): string {
  switch (method) {
    case "mpn":
      return "mpn";
    default:
      return "name+spec";
  }
}

/**
 * The database operations the writer needs, expressed against Prisma.
 */
export function createPriceStore(client: typeof prisma): PriceStore {
  return {
    async ensureSeller(data) {
      const seller = await client.seller.upsert({
        where: { slug: data.slug },
        create: data,
        update: {
          name: data.name,
          region: data.region,
          baseUrl: data.baseUrl,
          scrapeMethod: data.scrapeMethod,
        },
        select: { id: true },
      });
      return seller;
    },
    async findObservation(input) {
      return client.priceObservation.findFirst({
        where: {
          skuId: input.skuId,
          price: input.price,
          currency: input.currency,
          sourceUrl: input.sourceUrl,
          timestamp: { gte: input.bucketStart, lt: input.bucketEnd },
        },
        select: { id: true },
      });
    },
    async createObservation(data) {
      return client.priceObservation.create({ data, select: { id: true } });
    },
    async upsertListing(data) {
      return client.retailerListing.upsert({
        where: {
          sellerId_retailerSkuString: {
            sellerId: data.sellerId,
            retailerSkuString: data.retailerSkuString,
          },
        },
        create: data,
        update: {
          skuId: data.skuId,
          title: data.title,
          url: data.url,
          region: data.region,
          currency: data.currency,
          matchConfidence: data.matchConfidence,
          matchMethod: data.matchMethod,
          inStock: data.inStock,
          lastSeenAt: new Date(),
        },
        select: { id: true },
      });
    },
    async createPriceHistory(data) {
      return client.priceHistory.create({ data, select: { id: true } });
    },
  };
}

/**
 * The catalog the products are matched against.
 *
 * The whole catalog is loaded once: the rules are cheap, and a product has
 * to be compared against every configuration to be matched honestly.
 */
export async function loadCatalog(client: typeof prisma = prisma): Promise<CatalogSku[]> {
  const [skus, counts] = await Promise.all([
    client.sku.findMany({
      select: {
        id: true,
        skuCode: true,
        modelId: true,
        model: {
          select: {
            name: true,
            series: { select: { manufacturer: { select: { name: true } } } },
          },
        },
      },
    }),
    client.sku.groupBy({ by: ["modelId"], _count: { _all: true } }),
  ]);

  const skuCountByModel = new Map(counts.map((row) => [row.modelId, row._count._all]));

  return skus.map((sku) => ({
    id: sku.id,
    skuCode: sku.skuCode,
    modelId: sku.modelId,
    modelName: sku.model.name,
    brand: sku.model.series.manufacturer.name,
    modelSkuCount: skuCountByModel.get(sku.modelId) ?? 1,
  }));
}

/** The outcome of writing one observation. */
export interface WriteOutcome {
  written: boolean;
  reason: string;
  observationId?: string;
  listingId?: string;
}

/**
 * Write the price of one matched product.
 *
 * The listing is upserted and attached to the configuration the product was
 * matched to. The observation is appended only when the source published a
 * price, and only when no observation for the same price already exists in
 * the same bucket.
 */
export async function writePriceObservation(
  store: PriceStore,
  input: {
    product: IcecatProduct;
    candidate: MatchCandidate;
    price: IcecatPrice | null;
    now: Date;
  }
): Promise<WriteOutcome> {
  const { product, candidate, price, now } = input;
  if (!price) {
    return { written: false, reason: "the source published no price for this product" };
  }

  const seller = await store.ensureSeller(ICECAT_SELLER);
  const region = price.region && price.region.trim() ? price.region.trim() : DEFAULT_REGION;
  const listing = await store.upsertListing({
    sellerId: seller.id,
    skuId: candidate.skuId,
    retailerSkuString: listingKey(product),
    title: product.title || null,
    url: product.sourceUrl,
    region,
    currency: price.currency,
    matchConfidence: candidate.confidence,
    matchMethod: toSchemaMatchMethod(candidate.method),
    inStock: true,
  });

  const { bucketStart, bucketEnd } = bucketFor(now);
  const existing = await store.findObservation({
    skuId: candidate.skuId,
    price: price.amount,
    currency: price.currency,
    sourceUrl: product.sourceUrl,
    bucketStart,
    bucketEnd,
  });
  if (existing) {
    return {
      written: false,
      reason: `an observation of ${price.amount} ${price.currency} already exists for this product and URL`,
      listingId: listing.id,
    };
  }

  const observation = await store.createObservation({
    skuId: candidate.skuId,
    listingId: listing.id,
    region,
    currency: price.currency,
    price: price.amount,
    retailer: ICECAT_SELLER.name,
    sourceUrl: product.sourceUrl,
    timestamp: now,
    sourceName: ICECAT_SOURCE_NAME,
    kind: price.kind,
    // Icecat publishes no stock state, so the catalog's default applies.
    inStock: true,
    confidence: candidate.confidence,
  });

  await store.createPriceHistory({
    listingId: listing.id,
    skuId: candidate.skuId,
    price: price.amount,
    currency: price.currency,
    scrapedAt: now,
  });

  return {
    written: true,
    reason: `recorded ${price.amount} ${price.currency}`,
    observationId: observation.id,
    listingId: listing.id,
  };
}

/** Read the collected product-id list. */
export function readProductRefs(idsFile: string): IcecatProductRef[] {
  if (!fs.existsSync(idsFile)) {
    throw new Error(
      `No product list at ${idsFile}. Collect one with --discover or point --ids-file at an existing list.`
    );
  }
  const parsed = JSON.parse(fs.readFileSync(idsFile, "utf-8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`The product list at ${idsFile} is not an array.`);
  }
  return parsed.map((entry) => {
    const ref = entry as Partial<IcecatProductRef>;
    if (!ref.productCode || !ref.brand) {
      throw new Error(`A product list entry is missing its product code or brand.`);
    }
    return {
      productCode: ref.productCode,
      brand: ref.brand,
      name: ref.name ?? "",
      sourceUrl: ref.sourceUrl ?? "",
    };
  });
}

export interface IngestOptions {
  limit?: number;
  dryRun?: boolean;
  idsFile?: string;
  client?: IcecatClient;
  store?: PriceStore;
  catalog?: CatalogSku[];
  /** Where the per-product detail lines go. */
  detail?: (line: string) => void;
}

/**
 * Run one ingestion pass.
 *
 * Every product is read, parsed and matched. A product that matches
 * nothing, or that matches ambiguously, is counted as unmatched and nothing
 * is written for it.
 */
export async function ingest(options: IngestOptions = {}): Promise<IngestSummary> {
  const idsFile = options.idsFile ?? path.join(process.cwd(), DEFAULT_IDS_FILE);
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const detail = options.detail ?? ((line: string) => console.error(line));
  const client = options.client ?? new IcecatClient();

  const refs = readProductRefs(idsFile).slice(0, Number.isFinite(limit) ? limit : undefined);
  const catalog = options.catalog ?? (await loadCatalog());

  const summary: IngestSummary = {
    fetched: 0,
    matched: 0,
    unmatched: 0,
    observationsWritten: 0,
    errors: [],
  };

  for (const ref of refs) {
    let product: IcecatProduct;
    try {
      const payload = await client.getProductByRef(ref);
      const sourceUrl = client.requestedUrls[client.requestedUrls.length - 1];
      product = parseProduct(payload.data!, sourceUrl);
    } catch (error) {
      if (error instanceof IcecatAccessError) {
        summary.errors.push(`${ref.productCode}: ${error.message}`);
        detail(
          JSON.stringify({
            productCode: ref.productCode,
            status: "error",
            error: error.message,
          })
        );
        // The service asked us to stop. Stop.
        break;
      }
      const message =
        error instanceof IcecatError
          ? `HTTP ${error.status}: ${error.message}`
          : error instanceof Error
            ? error.message
            : "unknown error";
      summary.errors.push(`${ref.productCode}: ${message}`);
      detail(
        JSON.stringify({ productCode: ref.productCode, status: "error", error: message })
      );
      continue;
    }

    summary.fetched += 1;

    const outcome = matchProductToCatalog(product, catalog);
    if (outcome.status === "unmatched" || !outcome.best) {
      summary.unmatched += 1;
      detail(
        JSON.stringify({
          productCode: product.productCode,
          brand: product.brand,
          name: product.modelName,
          status: "unmatched",
          reason: outcome.reason,
        })
      );
      continue;
    }

    summary.matched += 1;

    if (options.dryRun) {
      detail(
        JSON.stringify({
          productCode: product.productCode,
          brand: product.brand,
          name: product.modelName,
          status: "matched",
          skuId: outcome.best.skuId,
          confidence: outcome.best.confidence,
          method: outcome.best.method,
          reason: outcome.reason,
          price: product.price ? product.price.amount : null,
        })
      );
      continue;
    }

    if (!options.store) {
      throw new Error("A store is required to write observations.");
    }

    const write = await writePriceObservation(options.store, {
      product,
      candidate: outcome.best,
      price: product.price,
      now: new Date(),
    });
    if (write.written) summary.observationsWritten += 1;

    detail(
      JSON.stringify({
        productCode: product.productCode,
        brand: product.brand,
        name: product.modelName,
        status: "matched",
        skuId: outcome.best.skuId,
        confidence: outcome.best.confidence,
        method: outcome.best.method,
        observationWritten: write.written,
        reason: write.reason,
      })
    );
  }

  return summary;
}

/**
 * Collect the products Icecat carries.
 *
 * The product API answers one product per request, so the list of what the
 * store holds is reached through the product graph: a product links to the
 * products it is related to, and the accessories of a laptop list the
 * laptops they fit. Walking that graph from a few known products yields the
 * laptops the store actually carries.
 *
 * Every candidate is then read once more, so the list holds the identifiers
 * and the name the service itself publishes for that product, and nothing
 * that was only a relation.
 */
export async function collectProductRefs(options: {
  seeds: string[];
  limit: number;
  client?: IcecatClient;
}): Promise<IcecatProductRef[]> {
  const client = options.client ?? new IcecatClient();
  const candidates = await client.discoverLaptopProducts(options.seeds, {
    limit: Math.max(options.limit * 4, options.limit),
  });

  const collected: IcecatProductRef[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (collected.length >= options.limit) break;
    try {
      const payload = await client.getProductByRef(candidate);
      const url = client.requestedUrls[client.requestedUrls.length - 1];
      const product = parseProduct(payload.data!, url);
      if (product.categoryId !== ICECAT_LAPTOP_CATEGORY_ID) continue;
      if (!product.productCode || !product.brand || !product.icecatId) continue;
      if (seen.has(product.icecatId)) continue;
      seen.add(product.icecatId);
      collected.push({
        productCode: product.productCode,
        brand: product.brand,
        name: product.modelName,
        sourceUrl: product.sourceUrl || url,
      });
    } catch (error) {
      if (error instanceof IcecatAccessError) break;
      continue;
    }
  }

  return collected;
}

/** The entry point. */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const args = parseArgs(argv);

  if (args.discover) {
    const seeds =
      args.seeds.length > 0
        ? args.seeds
        : readProductRefs(args.idsFile)
            .slice(0, 13)
            .map((ref) => icecatIdFromUrl(ref.sourceUrl))
            .filter((id): id is string => Boolean(id));
    const collected = await collectProductRefs({
      seeds,
      limit: Number.isFinite(args.limit) ? args.limit : 60,
    });
    collected.sort(
      (a, b) =>
        a.brand.localeCompare(b.brand) ||
        a.name.localeCompare(b.name) ||
        a.productCode.localeCompare(b.productCode)
    );
    fs.writeFileSync(args.idsFile, JSON.stringify(collected, null, 2) + "\n", "utf-8");
    console.log(
      JSON.stringify(
        {
          seeds: seeds.length,
          collected: collected.length,
          idsFile: args.idsFile,
          brands: collected.reduce<Record<string, number>>((acc, ref) => {
            acc[ref.brand] = (acc[ref.brand] ?? 0) + 1;
            return acc;
          }, {}),
        },
        null,
        2
      )
    );
    return;
  }

  const summary = await ingest({
    limit: args.limit,
    dryRun: args.dryRun,
    idsFile: args.idsFile,
    // A dry run reads and matches but writes nothing.
    store: args.dryRun ? undefined : createPriceStore(prisma),
  });
  console.log(JSON.stringify(summary, null, 2));
}

/**
 * Run the entry point only when this file is the program that was started.
 *
 * The tests import the functions above, so importing this file must not
 * start a run.
 */
function isDirectRun(): boolean {
  const entry = process.argv[1] ?? "";
  return /ingest-icecat\.(ts|js|mjs|cjs)$/.test(entry);
}

if (isDirectRun()) {
  main()
    .catch((error) => {
      console.error("Icecat ingestion failed:", error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
