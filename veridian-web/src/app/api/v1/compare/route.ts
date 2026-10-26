import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api-key";
import { buildComparisonAnalysis, type CompareRow } from "@/lib/compare";

export const dynamic = "force-dynamic";

/**
 * Compare API
 *
 * GET /api/v1/compare?ids=uuid1,uuid2,uuid3
 *
 * Returns side-by-side comparison of multiple SKUs with
 * better/worse/equivalent indicators.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("response" in auth) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const idsParam = searchParams.get("ids");
    const region = searchParams.get("region") || "US";

    if (!idsParam) {
      return NextResponse.json(
        { error: "ids parameter is required (comma-separated IDs)" },
        { status: 400 }
      );
    }

    // Dedupe so the same SKU cannot occupy two columns.
    const ids = Array.from(new Set(idsParam.split(",").map((s) => s.trim()).filter(Boolean)));

    if (ids.length === 0) {
      return NextResponse.json(
        { error: "Provide at least one SKU ID" },
        { status: 400 }
      );
    }

    if (ids.length > 5) {
      return NextResponse.json(
        { error: "Maximum 5 SKUs can be compared at once" },
        { status: 400 }
      );
    }

    const skus = await prisma.sku.findMany({
      where: { id: { in: ids }, catalogVisible: true },
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
        pricing: { where: { region } },
        ports: true,
      },
    });

    // Reject silently-partial comparisons: every requested ID must resolve.
    if (skus.length === 0) {
      return NextResponse.json(
        { error: "No SKUs found with the provided IDs" },
        { status: 404 }
      );
    }
    if (skus.length !== ids.length) {
      return NextResponse.json(
        { error: `${ids.length - skus.length} of the ${ids.length} requested SKUs could not be found` },
        { status: 404 }
      );
    }

    // Preserve the caller's ordering (findMany does not guarantee it).
    const ordered = ids
      .map((id) => skus.find((s) => s.id === id))
      .filter((s): s is (typeof skus)[number] => Boolean(s));

    // Format for comparison
    const comparison = ordered.map((sku) => ({
      id: sku.id,
      sku_code: sku.skuCode,
      name: sku.model.name,
      brand: sku.model.series.manufacturer.name,
      series: sku.model.series.name,
      specs: {
        cpu: {
          brand: sku.cpuBrand,
          model: sku.cpuModel,
          cores: sku.cpuCores,
        },
        memory: {
          ram_gb: sku.ramGb,
          ram_type: sku.ramType,
          ram_soldered: sku.ramSoldered,
        },
        storage: {
          capacity_gb: sku.storageGb,
          type: sku.storageType,
          slots: sku.storageSlots,
        },
        display: {
          size_in: sku.displaySizeIn,
          resolution: sku.displayResolution,
          type: sku.displayType,
          refresh_hz: sku.displayRefreshHz,
          touch: sku.displayTouch,
          nits: sku.displayNits,
        },
        physical: {
          weight_kg: sku.weightKg,
          build_material: sku.buildMaterial,
        },
        battery: {
          capacity_wh: sku.batteryWh,
          life_hours_claimed: sku.batteryLifeHours,
        },
        graphics: {
          gpu: sku.gpuModel,
        },
        os: sku.os,
        ports: sku.ports.map((p) => ({ type: p.portType, count: p.count })),
      },
      pricing: sku.pricing.map((p) => ({
        region: p.region,
        currency: p.currency,
        msrp: p.msrp,
        available: p.available,
      })),
    }));

    // Generate comparison analysis. The rules live in `@/lib/compare` so the
    // comparison page and this endpoint can never disagree about a winner.
    const analysis = buildComparisonAnalysis(ordered.map(toAnalysisRow));

    // Regions we actually hold prices for, so the client only offers a region
    // that can produce a price instead of an empty column.
    const regionRows = await prisma.skuRegionalPricing.findMany({
      distinct: ["region"],
      select: { region: true },
      orderBy: { region: "asc" },
    });

    return NextResponse.json({
      region,
      comparison,
      analysis,
      availableRegions: regionRows.map((r) => r.region),
    });
  } catch (error) {
    console.error("Error generating comparison:", error);
    return NextResponse.json(
      { error: "Failed to generate comparison" },
      { status: 500 }
    );
  }
}

/**
 * The subset of a catalog row the winner map needs.
 *
 * The analysis only ever ranks a metric every compared row reports, so the
 * adapter carries just those fields and leaves the rest unreported.
 */
interface AnalysisSku {
  id: string;
  model: { name: string };
  ramGb: number;
  weightKg: number | null;
  batteryWh: number | null;
  displayType: string | null;
  displayRefreshHz: number | null;
  displayNits: number | null;
}

function toAnalysisRow(sku: AnalysisSku): CompareRow {
  return {
    id: sku.id,
    skuCode: "",
    modelName: sku.model.name,
    brand: "",
    series: "",
    provenance: "unverified",
    values: {
      cpu: null,
      cpuCores: null,
      gpu: null,
      ramGb: sku.ramGb,
      ramType: null,
      ramSoldered: null,
      storageGb: null,
      storageType: null,
      storageSlots: null,
      displaySizeIn: null,
      displayResolution: null,
      displayType: sku.displayType,
      displayRefreshHz: sku.displayRefreshHz,
      displayNits: sku.displayNits,
      displayTouch: null,
      weightKg: sku.weightKg,
      batteryWh: sku.batteryWh,
      batteryLifeHours: null,
      os: null,
      ports: [],
      price: null,
      priceCurrency: null,
      priceUpdatedAt: null,
    },
  };
}
