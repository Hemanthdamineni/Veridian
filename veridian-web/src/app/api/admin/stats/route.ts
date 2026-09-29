import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [
      skuCount,
      observationCount,
      manufacturerCount,
      staleObservations,
      observationsWithoutSource,
      totalPricing,
    ] = await Promise.all([
      prisma.sku.count(),
      prisma.priceObservation.count(),
      prisma.manufacturer.count(),
      prisma.priceObservation.count({
        where: {
          timestamp: { lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.priceObservation.count({
        where: { sourceName: null },
      }),
      prisma.skuRegionalPricing.count(),
    ]);

    return NextResponse.json({
      skuCount,
      priceObservationCount: observationCount,
      manufacturerCount,
      totalPricing,
      staleObservations,
      observationsWithoutSource,
      qualityScore: observationCount > 0
        ? Math.round(
            ((observationCount - staleObservations - observationsWithoutSource) / observationCount) * 100
          )
        : 100,
    });
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch admin stats" },
      { status: 500 }
    );
  }
}
