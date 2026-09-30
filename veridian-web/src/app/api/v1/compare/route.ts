import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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
  try {
    const { searchParams } = new URL(request.url);
    const idsParam = searchParams.get("ids");

    if (!idsParam) {
      return NextResponse.json(
        { error: "ids parameter is required (comma-separated UUIDs)" },
        { status: 400 }
      );
    }

    const ids = idsParam.split(",").filter(Boolean);

    if (ids.length < 2) {
      return NextResponse.json(
        { error: "At least 2 SKU IDs are required for comparison" },
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
        pricing: true,
        ports: true,
      },
    });

    if (skus.length === 0) {
      return NextResponse.json(
        { error: "No SKUs found with the provided IDs" },
        { status: 404 }
      );
    }

    // Format for comparison
    const comparison = skus.map((sku) => ({
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

    // Generate comparison analysis
    const analysis = generateComparisonAnalysis(skus);

    return NextResponse.json({
      comparison,
      analysis,
    });
  } catch (error) {
    console.error("Error generating comparison:", error);
    return NextResponse.json(
      { error: "Failed to generate comparison" },
      { status: 500 }
    );
  }
}

interface ComparableSku {
  id: string;
  model: { name: string };
  ramGb: number;
  weightKg: number | null;
  batteryWh: number | null;
  displayType: string | null;
  displayRefreshHz: number | null;
  displayNits: number | null;
}

function generateComparisonAnalysis(skus: ComparableSku[]) {
  if (skus.length < 2) return null;

  const analysis: Record<string, { winner: string; explanation: string }> = {};

  // Compare RAM
  const maxRam = Math.max(...skus.map((s) => s.ramGb));
  const ramWinners = skus.filter((s) => s.ramGb === maxRam);
  if (ramWinners.length === 1) {
    analysis.memory = {
      winner: ramWinners[0].id,
      explanation: `${ramWinners[0].model.name} has the most RAM at ${maxRam}GB`,
    };
  }

  // Compare weight (lighter is better) — only among SKUs that report weight
  const withWeight = skus.filter((s) => s.weightKg !== null) as (ComparableSku & { weightKg: number })[];
  if (withWeight.length > 0) {
    const minWeight = Math.min(...withWeight.map((s) => s.weightKg));
    const weightWinners = withWeight.filter((s) => s.weightKg === minWeight);
    if (weightWinners.length === 1) {
      analysis.portability = {
        winner: weightWinners[0].id,
        explanation: `${weightWinners[0].model.name} is the lightest at ${minWeight}kg`,
      };
    }
  }

  // Compare battery — only among SKUs that report capacity
  const withBattery = skus.filter((s) => s.batteryWh !== null) as (ComparableSku & { batteryWh: number })[];
  if (withBattery.length > 0) {
    const maxBattery = Math.max(...withBattery.map((s) => s.batteryWh));
    const batteryWinners = withBattery.filter((s) => s.batteryWh === maxBattery);
    if (batteryWinners.length === 1) {
      analysis.battery = {
        winner: batteryWinners[0].id,
        explanation: `${batteryWinners[0].model.name} has the largest battery at ${maxBattery}Wh`,
      };
    }
  }

  // Compare display — only among SKUs with a measured refresh rate
  const displayScores = skus
    .filter((s) => s.displayRefreshHz !== null && s.displayType !== null)
    .map((s) => {
      let score = 0;
      if (s.displayType === "OLED") score += 3;
      else if (s.displayType === "Mini-LED") score += 2;
      else if (s.displayType === "IPS") score += 1;
      score += (s.displayRefreshHz as number) / 60;
      score += (s.displayNits || 300) / 500;
      return { sku: s, score };
    });
  displayScores.sort((a, b) => b.score - a.score);
  if (displayScores.length > 1 && displayScores[0].score > displayScores[1].score) {
    analysis.display = {
      winner: displayScores[0].sku.id,
      explanation: `${displayScores[0].sku.model.name} has the best display (${displayScores[0].sku.displayType}, ${displayScores[0].sku.displayRefreshHz}Hz)`,
    };
  }

  return analysis;
}
