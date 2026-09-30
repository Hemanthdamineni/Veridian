import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || id.length < 10) {
      return NextResponse.json({ error: "Invalid SKU ID" }, { status: 400 });
    }

    // Verify SKU exists and is visible in the public catalog
    const sku = await prisma.sku.findFirst({
      where: { id, catalogVisible: true },
      select: { id: true },
    });

    if (!sku) {
      return NextResponse.json({ error: "SKU not found" }, { status: 404 });
    }

    const url = new URL(request.url);
    const region = url.searchParams.get("region") || "US";
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "30", 10)));

    // Get all observations for this SKU in the specified region
    const observations = await prisma.priceObservation.findMany({
      where: {
        skuId: id,
        region,
      },
      orderBy: {
        timestamp: "desc",
      },
      take: limit,
      select: {
        price: true,
        timestamp: true,
        retailer: true,
        sourceName: true,
        sourceUrl: true,
        confidence: true,
      },
    });

    // Compute summary statistics
    const prices = observations.map((o) => o.price);
    const isSynthetic = observations.some((observation) =>
      observation.sourceName?.toLowerCase().includes("seed") || !observation.sourceUrl
    );
    const summary = prices.length > 0
      ? {
          min: Math.min(...prices),
          max: Math.max(...prices),
          avg: prices.reduce((a, b) => a + b, 0) / prices.length,
          count: prices.length,
          latest: prices[0],
          earliest: prices[prices.length - 1],
        }
      : null;

    // Get current regional pricing (MSRP)
    const regionalPricing = await prisma.skuRegionalPricing.findUnique({
      where: {
        skuId_region: { skuId: id, region },
      },
      select: {
        msrp: true,
        currency: true,
        available: true,
      },
    });

    return NextResponse.json({
      skuId: id,
      region,
      currency: regionalPricing?.currency || "",
      msrp: regionalPricing?.msrp || null,
      msrpAvailable: regionalPricing?.available ?? true,
      isSynthetic,
      summary,
      observations,
    });
  } catch (error) {
    console.error("Error fetching price history:", error);
    return NextResponse.json(
      { error: "Failed to fetch price history" },
      { status: 500 }
    );
  }
}
