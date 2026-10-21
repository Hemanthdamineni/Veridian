import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api-key";

export const dynamic = "force-dynamic";

/**
 * Public API — one shared component and the configurations that use it.
 *
 * GET /api/v1/components/{slug}
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const auth = await authenticateApiKey(request);
  if ("response" in auth) return auth.response;

  const { slug } = await context.params;
  const component = await prisma.component.findUnique({
    where: { slug },
    include: {
      specs: true,
      aliases: true,
      _count: { select: { skus: true } },
    },
  });
  if (!component) {
    return NextResponse.json({ error: "No such component" }, { status: 404 });
  }

  const links = await prisma.skuComponent.findMany({
    where: { componentId: component.id },
    include: {
      sku: {
        select: {
          id: true,
          skuCode: true,
          provenance: true,
          model: {
            select: {
              name: true,
              series: { select: { manufacturer: { select: { name: true } } } },
            },
          },
        },
      },
    },
  });

  const rank: Record<string, number> = { certified: 0, manufacturer: 1, unverified: 2 };
  const configurations = links
    .map((link) => ({
      id: link.sku.id,
      skuCode: link.sku.skuCode,
      modelName: link.sku.model.name,
      manufacturer: link.sku.model.series.manufacturer.name,
      provenance: link.sku.provenance,
    }))
    .sort(
      (a, b) =>
        (rank[a.provenance] ?? 3) - (rank[b.provenance] ?? 3) ||
        a.manufacturer.localeCompare(b.manufacturer) ||
        a.modelName.localeCompare(b.modelName)
    );

  return NextResponse.json({
    slug: component.slug,
    kind: component.kind,
    canonicalName: component.canonicalName,
    brand: component.brand,
    configurationCount: component._count.skus,
    specs: component.specs.map((spec) => ({
      key: spec.key,
      value: spec.value,
      unit: spec.unit,
      sourceUrl: spec.sourceUrl,
    })),
    aliases: component.aliases.map((alias) => alias.alias),
    configurations,
  });
}
