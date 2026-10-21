import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Component catalogue.
 *
 * GET /api/components
 *
 * Lists the shared components the catalog is built from — processors,
 * display classes, storage technologies — with the number of configurations
 * that use each one. This is what lets a reader ask "which machines share
 * this processor?" instead of reading every specification sheet.
 *
 * Query parameters:
 * - kind: cpu | display | storage (optional)
 * - q:   free-text match on the component name (optional)
 * - limit: maximum number of components to return (default 50, max 200)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind") || undefined;
    const q = searchParams.get("q")?.trim() || undefined;
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50));

    const where: Record<string, unknown> = {};
    if (kind) where.kind = kind;
    if (q) where.canonicalName = { contains: q };

    const components = await prisma.component.findMany({
      where,
      take: limit,
      orderBy: { canonicalName: "asc" },
      include: {
        specs: { select: { key: true, value: true, unit: true } },
        aliases: { select: { alias: true, source: true, sourceUrl: true }, take: 4 },
        _count: { select: { skus: true } },
      },
    });

    return NextResponse.json({
      results: components.map((component) => ({
        id: component.id,
        kind: component.kind,
        canonicalName: component.canonicalName,
        brand: component.brand,
        model: component.model,
        slug: component.slug,
        configurationCount: component._count.skus,
        specs: component.specs.map((spec) => ({
          key: spec.key,
          value: spec.value,
          unit: spec.unit,
        })),
        aliases: component.aliases.map((alias) => alias.alias),
        source: component.aliases[0]?.source ?? null,
        sourceUrl: component.aliases[0]?.sourceUrl ?? null,
      })),
    });
  } catch (error) {
    console.error("Error fetching components:", error);
    return NextResponse.json({ error: "Failed to fetch components" }, { status: 500 });
  }
}
