import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { scoreLaptopForRecommendation, type RecommendationInput } from "@/lib/ai";

export const dynamic = "force-dynamic";

/**
 * AI Recommendation API
 *
 * Returns ranked laptop recommendations based on user requirements.
 *
 * Query params:
 * - budget: Maximum budget
 * - currency: Currency code (default: USD)
 * - min_ram: Minimum RAM in GB
 * - preferred_size: Preferred display size
 * - display: Display type preference (IPS, OLED, Mini-LED)
 * - use_case: Use case (programming, gaming, business, creative, student, travel)
 * - max_weight: Maximum weight in kg
 * - limit: Number of recommendations (default: 4)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Parse requirements from query params
    const requirements: RecommendationInput = {
      budget: searchParams.get("budget") ? parseInt(searchParams.get("budget")!, 10) : undefined,
      currency: searchParams.get("currency") || "USD",
      min_ram: searchParams.get("min_ram") ? parseInt(searchParams.get("min_ram")!, 10) : undefined,
      preferred_size: searchParams.get("preferred_size") ? parseFloat(searchParams.get("preferred_size")!) : undefined,
      display_preference: searchParams.get("display") as "IPS" | "OLED" | "Mini-LED" || undefined,
      use_case: searchParams.get("use_case") as RecommendationInput["use_case"] || undefined,
      max_weight: searchParams.get("max_weight") ? parseFloat(searchParams.get("max_weight")!) : undefined,
    };

    const limit = Math.min(10, parseInt(searchParams.get("limit") || "4", 10));
    const region = searchParams.get("region") || "US";

    // Build initial filter query based on hard constraints
    const where: Record<string, unknown> = {
      catalogVisible: true,
    };
    if (requirements.budget) {
      where["pricing"] = {
        some: {
          region,
          available: true,
          msrp: { lte: requirements.budget * 1.2 }, // Allow 20% over for recommendations
        },
      };
    }
    if (requirements.min_ram) {
      where["ramGb"] = { gte: requirements.min_ram };
    }
    if (requirements.display_preference) {
      where["displayType"] = requirements.display_preference;
    }
    if (requirements.max_weight) {
      where["weightKg"] = { lte: requirements.max_weight * 1.2 };
    }

    // Fetch candidate laptops. The candidate set is ordered so the ranking is
    // reproducible: configurations with a cited source come first, then the
    // most recently launched. Without an explicit order the query would
    // return an arbitrary slice and the same request could answer differently.
    const candidates = await prisma.sku.findMany({
      where,
      take: 60,
      orderBy: [{ launchDate: "desc" }, { createdAt: "desc" }],
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
        pricing: {
          where: { region },
        },
      },
    });

    // Score each candidate
    const scored = candidates.map((sku) => {
      const laptop = {
        id: sku.id,
        name: `${sku.model.series.manufacturer.name} ${sku.model.name}`,
        price: sku.pricing[0]?.msrp ?? null,
        currency: sku.pricing[0]?.currency || "USD",
        ram_gb: sku.ramGb,
        display_size_in: sku.displaySizeIn,
        display_type: sku.displayType,
        weight_kg: sku.weightKg,
        battery_wh: sku.batteryWh,
        cpu_brand: sku.cpuBrand,
        brand: sku.model.series.manufacturer.name,
      };
      return {
        ...scoreLaptopForRecommendation(laptop, requirements),
        provenance: sku.provenance,
      };
    });

    // Sort by score and take top N
    const recommendations = scored
      .sort((a, b) => b.match_score - a.match_score)
      .slice(0, limit);

    return NextResponse.json({
      requirements,
      recommendations,
      total_candidates: candidates.length,
    });
  } catch (error) {
    console.error("Error generating recommendations:", error);
    return NextResponse.json(
      { error: "Failed to generate recommendations" },
      { status: 500 }
    );
  }
}
