import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildSkusQuery, buildOrderBy, parsePagination, formatSkuListItem } from "@/lib/api";
import { parseNaturalLanguageQuery } from "@/lib/ai";
import type { SkusResponse } from "@/types";

export const dynamic = "force-dynamic";

/**
 * Natural Language Search API
 *
 * Accepts a natural language query and converts it to structured filters.
 * Returns matching laptops with the parsed filters.
 *
 * Query params:
 * - q: Natural language query (e.g., "14 inch OLED laptop under $1500")
 * - region: Region code (optional)
 * - page: Page number
 * - limit: Items per page
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const nlQuery = searchParams.get("q");
    const region = searchParams.get("region") || "US";
    const page = searchParams.get("page") || "1";
    const limit = searchParams.get("limit") || "24";

    if (!nlQuery) {
      return NextResponse.json(
        { error: "Query parameter 'q' is required" },
        { status: 400 }
      );
    }

    // Parse natural language query to structured filters
    const parsedFilters = parseNaturalLanguageQuery(nlQuery);

    // Effective region: an explicit query param wins, otherwise the parser may
    // have inferred a region from a currency symbol (e.g. ₹ → IN).
    const effectiveRegion = region || parsedFilters.region || "US";

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
    const { page: pageNum, limit: limitNum, skip } = parsePagination(params);

    const totalResults = await prisma.sku.count({ where });

    const skus = await prisma.sku.findMany({
      where,
      orderBy: buildOrderBy(params.sort),
      skip,
      take: limitNum,
      include: {
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
      },
    });

    const results = skus.map((sku) =>
      formatSkuListItem(sku as Parameters<typeof formatSkuListItem>[0], effectiveRegion)
    );

    const response: SkusResponse & { parsed_filters: Record<string, string | undefined> } = {
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
