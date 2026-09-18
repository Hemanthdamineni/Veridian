import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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

    const sku = await prisma.sku.findUnique({
      where: { id },
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
      },
    });

    if (!sku) {
      return NextResponse.json({ error: "SKU not found" }, { status: 404 });
    }

    const primaryPrice = sku.pricing[0] || null;

    return NextResponse.json({
      id: sku.id,
      skuCode: sku.skuCode,
      modelName: sku.model.name,
      seriesName: sku.model.series.name,
      manufacturerName: sku.model.series.manufacturer.name,
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
    });
  } catch (error) {
    console.error("Error fetching SKU detail:", error);
    return NextResponse.json(
      { error: "Failed to fetch SKU detail" },
      { status: 500 }
    );
  }
}
