import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  buildSkusQuery,
  buildOrderBy,
  parsePagination,
  formatSkuListItem,
  sortSkusByPrice,
} from "@/lib/api";
import { interpretNaturalLanguageQuery, type NlExtraFilters } from "@/lib/ai";
import type { SkusResponse } from "@/types";

export const dynamic = "force-dynamic";

/**
 * Natural Language Search API
 *
 * Accepts a natural language query and converts it to structured filters.
 * Returns matching laptops with the parsed filters.
 *
 * The response keeps the historical `parsed_filters` keys untouched and adds
 * the bookkeeping the interface needs to show the reader how the sentence was
 * read: the words that could not be interpreted, the assumptions that were
 * made, the confidence, and the alternative readings of an ambiguous
 * sentence.
 *
 * Query params:
 * - q: Natural language query (e.g., "14 inch OLED laptop under $1500")
 * - region: Region code (optional)
 * - page: Page number
 * - limit: Items per page
 */

/** The historical keys, unchanged, plus the new interpretation bookkeeping. */
export interface ParsedFiltersResponse {
  // Historical shape — the same keys, with the same meaning.
  q?: string;
  cpu_brand?: string;
  ram_min?: string;
  storage_min?: string;
  display_type?: string;
  weight_max?: string;
  price_max?: string;
  region?: string;
  sort?: string;
  touch?: string;

  // Added: constraints that were applied and the reasoning behind them.
  price_min?: string;
  refresh_min?: string;
  battery_min?: string;
  display_size?: string;
  nits_min?: string;
  gpu?: string;
  os?: string;
  cpu_family?: string;
  ignored_terms?: string[];
  assumptions?: string[];
  alternatives?: Array<{
    label: string;
    query: string;
    confidence: number;
    filters: Record<string, string | undefined>;
  }>;
  confidence?: number;
}

/**
 * Apply the constraints the catalog cannot express through `SkusQueryParams`.
 *
 * These are real filters on real columns, so a sentence like "a laptop with a
 * dedicated GPU" narrows the result set instead of only sounding specific.
 */
function applyExtraFilters(where: Record<string, unknown>, extra: NlExtraFilters): void {
  if (extra.cpuModelContains) {
    where.cpuModel = { contains: extra.cpuModelContains };
  }
  if (extra.osContains) {
    where.os = { contains: extra.osContains };
  }
  if (extra.nitsMin) {
    where.displayNits = { gte: Number(extra.nitsMin) };
  }
  if (extra.displaySizeMin || extra.displaySizeMax) {
    where.displaySizeIn = {
      ...(extra.displaySizeMin ? { gte: Number(extra.displaySizeMin) } : {}),
      ...(extra.displaySizeMax ? { lte: Number(extra.displaySizeMax) } : {}),
    };
  }
  if (extra.batteryLifeHoursMin) {
    where.batteryLifeHours = { gte: Number(extra.batteryLifeHoursMin) };
  }
  if (extra.gpuModelAnyOf && extra.gpuModelAnyOf.length > 0) {
    const clauses = extra.gpuModelAnyOf.map((marker) => ({ gpuModel: { contains: marker } }));
    const existing = Array.isArray(where.AND) ? (where.AND as unknown[]) : [];
    where.AND = [...existing, { OR: clauses }];
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const nlQuery = searchParams.get("q");
    const requestedRegion = searchParams.get("region") || undefined;
    const page = searchParams.get("page") || "1";
    const limit = searchParams.get("limit") || "24";

    if (!nlQuery) {
      return NextResponse.json(
        { error: "Query parameter 'q' is required" },
        { status: 400 }
      );
    }

    // Parse natural language query to structured filters, together with the
    // words that could not be interpreted and the assumptions that were made.
    const interpretation = interpretNaturalLanguageQuery(nlQuery);
    const parsedFilters = interpretation.filters;

    // Effective region: an explicitly requested region wins, otherwise the
    // parser may have inferred one from a currency symbol (e.g. ₹ → IN).
    const effectiveRegion = requestedRegion || parsedFilters.region || "US";

    // Convert camelCase to snake_case for API.
    //
    // The sentence supplies the constraints it can express; the explicit
    // filter parameters (provenance tier, sort order) still apply on top, so
    // the two ways of searching compose instead of competing.
    const params = {
      cpuBrand: parsedFilters.cpuBrand,
      ramMin: parsedFilters.ramMin,
      storageMin: parsedFilters.storageMin,
      displayType: parsedFilters.displayType,
      refreshMin: parsedFilters.refreshMin,
      weightMax: parsedFilters.weightMax,
      batteryMin: parsedFilters.batteryMin,
      touch: parsedFilters.touch,
      region: effectiveRegion,
      priceMin: parsedFilters.priceMin,
      priceMax: parsedFilters.priceMax,
      provenance: searchParams.get("provenance") || undefined,
      q: parsedFilters.q,
      sort: searchParams.get("sort") || parsedFilters.sort,
      page,
      limit,
    };

    const where = buildSkusQuery(params);
    applyExtraFilters(where, interpretation.extra);
    const { page: pageNum, limit: limitNum, skip } = parsePagination(params);

    const totalResults = await prisma.sku.count({ where });

    const include = {
      model: {
        include: {
          series: {
            include: {
              manufacturer: true,
            },
          },
        },
      },
      pricing: { where: { region: effectiveRegion } },
    };

    // Three ways of ordering a catalog search:
    //  * by price — a relation field, so it is sorted in memory;
    //  * by screen size or memory — columns the shared sort helper does not
    //    know about yet;
    //  * everything else — the shared helper.
    const sort = params.sort;
    const orderBy = buildOrderBy(sort);
    if (sort === "display_size_desc") {
      orderBy.unshift({ displaySizeIn: "desc" });
    } else if (sort === "ram_desc") {
      orderBy.unshift({ ramGb: "desc" });
    }

    let skus;
    if (sort === "price_asc" || sort === "price_desc") {
      const allSkus = await prisma.sku.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
        include,
      });
      const sorted = sortSkusByPrice(
        allSkus,
        effectiveRegion,
        sort === "price_asc" ? "asc" : "desc"
      );
      skus = sorted.slice(skip, skip + limitNum);
    } else {
      skus = await prisma.sku.findMany({
        where,
        orderBy,
        skip,
        take: limitNum,
        include,
      });
    }

    const results = skus.map((sku) =>
      formatSkuListItem(sku as Parameters<typeof formatSkuListItem>[0], effectiveRegion)
    );

    // The sentence may name a currency that does not match the region the
    // catalog is priced in. Say so rather than quietly comparing rupees with
    // dollar prices.
    const assumptions = [...interpretation.assumptions];
    if (parsedFilters.region && requestedRegion && parsedFilters.region !== requestedRegion) {
      assumptions.push(
        `The sentence names a price in the ${parsedFilters.region} region, but the catalog is showing ${requestedRegion} prices — change the region to compare like with like.`
      );
    }

    const response: SkusResponse & { parsed_filters: ParsedFiltersResponse } = {
      results,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalResults,
        totalPages: Math.ceil(totalResults / limitNum),
      },
      parsed_filters: {
        q: parsedFilters.q,
        cpu_brand: parsedFilters.cpuBrand,
        ram_min: parsedFilters.ramMin,
        storage_min: parsedFilters.storageMin,
        display_type: parsedFilters.displayType,
        weight_max: parsedFilters.weightMax,
        price_max: parsedFilters.priceMax,
        region: effectiveRegion,
        sort: parsedFilters.sort,
        touch: parsedFilters.touch,
        price_min: parsedFilters.priceMin,
        refresh_min: parsedFilters.refreshMin,
        battery_min: parsedFilters.batteryMin,
        display_size:
          interpretation.extra.displaySizeMin && interpretation.extra.displaySizeMax
            ? `${interpretation.extra.displaySizeMin}-${interpretation.extra.displaySizeMax}`
            : undefined,
        nits_min: interpretation.extra.nitsMin,
        gpu: interpretation.extra.gpuModelAnyOf?.join(" / "),
        os: interpretation.extra.osContains,
        cpu_family: interpretation.extra.cpuModelContains,
        ignored_terms: interpretation.ignoredTerms,
        assumptions,
        alternatives: interpretation.alternatives.map((alternative) => ({
          label: alternative.label,
          query: alternative.query,
          confidence: alternative.confidence,
          filters: alternative.filters as Record<string, string | undefined>,
        })),
        confidence: interpretation.confidence,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error in NL search:", error);
    return NextResponse.json(
      { error: "Failed to process search query" },
      { status: 500 }
    );
  }
}
