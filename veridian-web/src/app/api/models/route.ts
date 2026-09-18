import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Force dynamic rendering
export const dynamic = "force-dynamic";

/**
 * Models API
 *
 * GET /api/models?series_id=xxx - List models under a series
 * GET /api/models?manufacturer_id=xxx - List models across all series of a manufacturer
 * GET /api/models - List all models
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const seriesId = searchParams.get("series_id");
    const manufacturerId = searchParams.get("manufacturer_id");

    const where: Record<string, unknown> = {};

    if (seriesId) {
      // Validate ID format (UUID or CUID)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const cuidRegex = /^[a-z0-9]{20,30}$/i;
      if (!uuidRegex.test(seriesId) && !cuidRegex.test(seriesId)) {
        return NextResponse.json(
          { error: "Invalid series_id format" },
          { status: 400 }
        );
      }
      where.seriesId = seriesId;
    } else if (manufacturerId) {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const cuidRegex = /^[a-z0-9]{20,30}$/i;
      if (!uuidRegex.test(manufacturerId) && !cuidRegex.test(manufacturerId)) {
        return NextResponse.json(
          { error: "Invalid manufacturer_id format" },
          { status: 400 }
        );
      }
      where.series = { manufacturerId };
    }

    const models = await prisma.model.findMany({
      where,
      orderBy: { name: "asc" },
      include: {
        series: {
          include: {
            manufacturer: true,
          },
        },
        _count: {
          select: { skus: true },
        },
      },
    });

    return NextResponse.json(models);
  } catch (error) {
    console.error("Error fetching models:", error);
    return NextResponse.json(
      { error: "Failed to fetch models" },
      { status: 500 }
    );
  }
}
