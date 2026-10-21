import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api-key";

export const dynamic = "force-dynamic";

/**
 * Public API — manufacturers.
 *
 * GET /api/v1/manufacturers
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("response" in auth) return auth.response;

  const manufacturers = await prisma.manufacturer.findMany({
    orderBy: { name: "asc" },
    select: {
      name: true,
      slug: true,
      country: true,
      websiteUrl: true,
      _count: { select: { series: true } },
    },
  });

  return NextResponse.json({
    results: manufacturers.map((manufacturer) => ({
      name: manufacturer.name,
      slug: manufacturer.slug,
      country: manufacturer.country,
      websiteUrl: manufacturer.websiteUrl,
      seriesCount: manufacturer._count.series,
    })),
  });
}
