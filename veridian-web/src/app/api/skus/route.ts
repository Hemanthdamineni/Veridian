import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { buildSkusQuery, buildOrderBy, parsePagination, formatSkuListItem } from "@/lib/api";
import type { SkusResponse } from "@/types";

// Force dynamic rendering since we use request.url
export const dynamic = "force-dynamic";

/**
 * SKUs List API
 *
 * GET /api/skus
 *
 * Query parameters:
 * - cpu_brand: Comma-separated CPU brands (Intel,AMD,Apple,Qualcomm)
 * - ram_min: Minimum RAM in GB
 * - storage_min: Minimum storage in GB
 * - display_type: Comma-separated display types (IPS,OLED,Mini-LED)
 * - refresh_min: Minimum refresh rate in Hz
 * - weight_max: Maximum weight in kg
 * - battery_min: Minimum battery capacity in Wh
 * - touch: Filter by touch screen (true/false)
 * - region: Region code for pricing (US,IN,UK,EU,CA)
 * - price_min: Minimum price (requires region)
 * - price_max: Maximum price (requires region)
 * - q: Search query for model name or SKU code
 * - sort: Sort order (price_asc,price_desc,weight_asc,battery_desc,newest)
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 24, max: 100)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const params = {
      cpuBrand: searchParams.get("cpu_brand") || undefined,
      ramMin: searchParams.get("ram_min") || undefined,
      storageMin: searchParams.get("storage_min") || undefined,
      displayType: searchParams.get("display_type") || undefined,
      refreshMin: searchParams.get("refresh_min") || undefined,
      weightMax: searchParams.get("weight_max") || undefined,
      batteryMin: searchParams.get("battery_min") || undefined,
      touch: searchParams.get("touch") || undefined,
      region: searchParams.get("region") || undefined,
      priceMin: searchParams.get("price_min") || undefined,
      priceMax: searchParams.get("price_max") || undefined,
      q: searchParams.get("q") || undefined,
      sort: searchParams.get("sort") || undefined,
      page: searchParams.get("page") || undefined,
      limit: searchParams.get("limit") || undefined,
    };

    const where = buildSkusQuery(params);
    const orderBy = buildOrderBy(params.sort);
    const { page, limit } = parsePagination(params);

    // Get total count for pagination
    const totalResults = await prisma.sku.count({ where });

    let skus;

    // Price sorting requires special handling since it's a relation field
    if (params.sort === "price_asc" || params.sort === "price_desc") {
      // Fetch all matching SKUs with pricing for the region
      const region = params.region || "US";
      const allSkus = await prisma.sku.findMany({
        where,
        orderBy: [{ createdAt: "desc" }],
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
          pricing: { where: { region } },
        },
      });

      // Sort by price
      const sorted = [...allSkus].sort((a, b) => {
        const priceA = a.pricing[0]?.msrp ?? Infinity;
        const priceB = b.pricing[0]?.msrp ?? Infinity;
        return params.sort === "price_asc" ? priceA - priceB : priceB - priceA;
      });

      // Paginate
      const skip = (page - 1) * limit;
      skus = sorted.slice(skip, skip + limit);
    } else {
      // Standard pagination for non-price sorts
      const skip = (page - 1) * limit;
      skus = await prisma.sku.findMany({
        where,
        orderBy,
        skip,
        take: limit,
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
          pricing: params.region
            ? { where: { region: params.region } }
            : true,
        },
      });
    }

    const results = skus.map((sku) =>
      formatSkuListItem(sku as Parameters<typeof formatSkuListItem>[0], params.region)
    );

    const response: SkusResponse = {
      results,
      pagination: {
        page,
        limit,
        totalResults,
        totalPages: Math.ceil(totalResults / limit),
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching SKUs:", error);
    return NextResponse.json(
      { error: "Failed to fetch SKUs" },
      { status: 500 }
    );
  }
}
