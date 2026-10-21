import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key";
import { getConfiguration } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/**
 * Public API — one configuration.
 *
 * GET /api/v1/skus/{id}
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiKey(request);
  if ("response" in auth) return auth.response;

  const { id } = await context.params;
  const sku = await getConfiguration(id);
  if (!sku) {
    return NextResponse.json({ error: "No such configuration" }, { status: 404 });
  }

  return NextResponse.json({
    id: sku.id,
    skuCode: sku.skuCode,
    partNumber: sku.mpn,
    upc: sku.upc,
    productType: sku.productType,
    modelName: sku.model.name,
    seriesName: sku.model.series.name,
    manufacturer: sku.model.series.manufacturer.name,
    provenance: sku.provenance,
    launchDate: sku.launchDate?.toISOString() ?? null,
    discontinued: sku.discontinued,
    cpu: { brand: sku.cpuBrand, model: sku.cpuModel, cores: sku.cpuCores },
    memory: { gb: sku.ramGb, type: sku.ramType, soldered: sku.ramSoldered },
    storage: { gb: sku.storageGb, type: sku.storageType, slots: sku.storageSlots },
    display: {
      sizeIn: sku.displaySizeIn,
      resolution: sku.displayResolution,
      type: sku.displayType,
      refreshHz: sku.displayRefreshHz,
      touch: sku.displayTouch,
      nits: sku.displayNits,
    },
    weightKg: sku.weightKg,
    batteryWh: sku.batteryWh,
    batteryLifeHours: sku.batteryLifeHours,
    os: sku.os,
    buildMaterial: sku.buildMaterial,
    pricing: sku.pricing.map((price) => ({
      region: price.region,
      currency: price.currency,
      msrp: price.msrp,
      note: "Manufacturer suggested price recorded at the last update. Not a live retail price.",
    })),
    sources: sku.sources.map((source) => ({
      source: source.source,
      kind: source.kind,
      sourceUrl: source.sourceUrl,
      observedAt: source.observedAt.toISOString(),
      confidence: source.confidence,
      note: source.note,
    })),
    components: sku.components.map((link) => ({
      kind: link.component.kind,
      canonicalName: link.component.canonicalName,
      slug: link.component.slug,
      role: link.role,
    })),
  });
}
