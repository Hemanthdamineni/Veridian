import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ slug: string }>;
}

/**
 * A single shared component and the configurations that use it.
 *
 * GET /api/components/:slug
 *
 * This is the question a flat specification table cannot answer: which
 * machines are built around this processor, this display class or this
 * storage technology. The configurations are ordered by provenance so the
 * cited ones come first.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { slug } = await context.params;
    const limit = Math.min(100, Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") || "24", 10) || 24));

    const component = await prisma.component.findUnique({
      where: { slug },
      include: {
        specs: { select: { key: true, value: true, unit: true, source: true, sourceUrl: true } },
        aliases: {
          select: { alias: true, normalized: true, source: true, sourceUrl: true, observedAt: true },
        },
      },
    });

    if (!component) {
      return NextResponse.json({ error: "Component not found" }, { status: 404 });
    }

    const links = await prisma.skuComponent.findMany({
      where: { componentId: component.id },
      take: limit,
      include: {
        sku: {
          select: {
            id: true,
            skuCode: true,
            cpuModel: true,
            ramGb: true,
            displaySizeIn: true,
            batteryWh: true,
            provenance: true,
            model: {
              select: {
                name: true,
                series: { select: { name: true, manufacturer: { select: { name: true } } } },
              },
            },
            pricing: { select: { region: true, currency: true, msrp: true }, take: 1 },
          },
        },
      },
    });

    // The order of the link rows is not meaningful, so order explicitly:
    // cited configurations first, then by manufacturer and model name.
    const rank: Record<string, number> = { certified: 0, manufacturer: 1, unverified: 2 };
    const configurations = links
      .map((link) => ({
        id: link.sku.id,
        skuCode: link.sku.skuCode,
        modelName: link.sku.model.name,
        seriesName: link.sku.model.series.name,
        manufacturerName: link.sku.model.series.manufacturer.name,
        cpuModel: link.sku.cpuModel,
        ramGb: link.sku.ramGb,
        displaySizeIn: link.sku.displaySizeIn,
        batteryWh: link.sku.batteryWh,
        provenance: link.sku.provenance,
        role: link.role,
        price: link.sku.pricing[0]
          ? {
              region: link.sku.pricing[0].region,
              currency: link.sku.pricing[0].currency,
              msrp: link.sku.pricing[0].msrp,
            }
          : null,
      }))
      .sort(
        (a, b) =>
          (rank[a.provenance] ?? 3) - (rank[b.provenance] ?? 3) ||
          a.manufacturerName.localeCompare(b.manufacturerName) ||
          a.modelName.localeCompare(b.modelName)
      );

    return NextResponse.json({
      component: {
        id: component.id,
        kind: component.kind,
        canonicalName: component.canonicalName,
        brand: component.brand,
        model: component.model,
        slug: component.slug,
        specs: component.specs.map((spec) => ({
          key: spec.key,
          value: spec.value,
          unit: spec.unit,
          source: spec.source,
          sourceUrl: spec.sourceUrl,
        })),
        aliases: component.aliases.map((alias) => ({
          alias: alias.alias,
          source: alias.source,
          sourceUrl: alias.sourceUrl,
          observedAt: alias.observedAt.toISOString(),
        })),
      },
      totalConfigurations: await prisma.skuComponent.count({
        where: { componentId: component.id },
      }),
      configurations,
    });
  } catch (error) {
    console.error("Error fetching component:", error);
    return NextResponse.json({ error: "Failed to fetch component" }, { status: 500 });
  }
}
