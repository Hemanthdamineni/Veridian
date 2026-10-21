import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { toProvenance } from "@/lib/api";

// Force dynamic rendering
export const dynamic = "force-dynamic";

/**
 * GET /api/skus/:id
 *
 * Returns full SKU details including:
 * - All spec fields
 * - Regional pricing
 * - Ports
 * - Parent model/series/manufacturer names
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || id.length < 10) {
      return NextResponse.json(
        { error: "Invalid SKU ID" },
        { status: 400 }
      );
    }

    const sku = await prisma.sku.findFirst({
      where: { id, catalogVisible: true },
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
        pricing: true,
        ports: true,
        certifiedSpecs: true,
        sources: {
          select: {
            source: true,
            kind: true,
            sourceUrl: true,
            observedAt: true,
            confidence: true,
            note: true,
          },
        },
        components: { include: { component: true } },
      },
    });

    if (!sku) {
      return NextResponse.json({ error: "SKU not found" }, { status: 404 });
    }

    const primaryPrice = sku.pricing[0] || null;

    return NextResponse.json({
      id: sku.id,
      skuCode: sku.skuCode,
      partNumber: sku.mpn,
      upc: sku.upc,
      productType: sku.productType,
      modelName: sku.model.name,
      seriesName: sku.model.series.name,
      manufacturerName: sku.model.series.manufacturer.name,
      // The provenance tier is a written field, not an inference.
      provenance: toProvenance(sku.provenance),
      sources: sku.sources.map((source) => ({
        source: source.source,
        kind: source.kind,
        sourceUrl: source.sourceUrl,
        observedAt: source.observedAt.toISOString(),
        confidence: source.confidence,
        note: source.note,
      })),
      components: sku.components.map((link) => ({
        id: link.component.id,
        kind: link.component.kind,
        name: link.component.canonicalName,
        slug: link.component.slug,
        role: link.role,
      })),
      cpuBrand: sku.cpuBrand,
      cpuModel: sku.cpuModel,
      cpuCores: sku.cpuCores,
      gpuModel: sku.gpuModel,
      ramGb: sku.ramGb,
      ramType: sku.ramType,
      ramSoldered: sku.ramSoldered,
      storageGb: sku.storageGb,
      storageType: sku.storageType,
      storageSlots: sku.storageSlots,
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
      npuTops: sku.npuTops,
      os: sku.os,
      buildMaterial: sku.buildMaterial,
      linuxCompat: sku.linuxCompat,
      launchDate: sku.launchDate?.toISOString() || null,
      discontinued: sku.discontinued,
      productUrl: sku.model.productUrl,
      price: primaryPrice
        ? {
            region: primaryPrice.region,
            currency: primaryPrice.currency,
            msrp: primaryPrice.msrp,
          }
        : null,
      pricing: sku.pricing.map((p) => ({
        region: p.region,
        currency: p.currency,
        msrp: p.msrp,
      })),
      ports: sku.ports.map((p) => ({
        portType: p.portType,
        count: p.count,
      })),
      certifiedSpecs: sku.certifiedSpecs.map((spec) => ({
        source: spec.source,
        sourceUrl: spec.sourceUrl,
        observedAt: spec.observedAt.toISOString(),
        certifiedAt: spec.certifiedAt?.toISOString() || null,
        marketDate: spec.marketDate?.toISOString() || null,
        energyStarId: spec.energyStarId,
        cpuBrand: spec.cpuBrand,
        cpuModel: spec.cpuModel,
        cpuCores: spec.cpuCores,
        cpuBaseClockGHz: spec.cpuBaseClockGHz,
        cpuMaxClockGHz: spec.cpuMaxClockGHz,
        cpuPackages: spec.cpuPackages,
        ramGb: spec.ramGb,
        storageType: spec.storageType,
        storageDrives: spec.storageDrives,
        displaySizeIn: spec.displaySizeIn,
        displayResolutionMp: spec.displayResolutionMp,
        displayAreaSqIn: spec.displayAreaSqIn,
        touchScreen: spec.touchScreen,
        batteryWh: spec.batteryWh,
        os: spec.os,
        npu: spec.npu,
        markets: spec.markets,
      })),
    });
  } catch (error) {
    console.error("Error fetching SKU detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch SKU detail" },
      { status: 500 }
    );
  }
}
