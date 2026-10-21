import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { loadPriceHistory, parsePriceHistoryQuery } from "@/lib/prices/stats";

export const dynamic = "force-dynamic";

/**
 * GET /api/skus/:id/price-history
 *
 * Returns the price history of one configuration in one region, and the
 * statistics computed over it.
 *
 * Query parameters:
 *   region   — the region to read, `US` by default.
 *   window   — `7`, `30`, `90` or `all`; the window the observations are
 *              taken from. Every window's statistics are returned regardless.
 *   currency — restrict the history to one currency.
 *
 * The response never invents a price. A statistic computed from fewer than
 * two observations is reported as insufficient with the count that backs it,
 * and every statistic says what kind of evidence it came from, so a
 * manufacturer list price is never read as a street price.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    if (!id || id.length < 10) {
      return NextResponse.json({ error: "Invalid SKU ID" }, { status: 400 });
    }

    // Verify the SKU exists and is visible in the public catalog.
    const sku = await prisma.sku.findFirst({
      where: { id, catalogVisible: true },
      select: { id: true },
    });

    if (!sku) {
      return NextResponse.json({ error: "SKU not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const parsed = parsePriceHistoryQuery(searchParams, id);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const history = await loadPriceHistory(parsed.query);

    return NextResponse.json(history);
  } catch (error) {
    console.error("Error fetching price history:", error);
    return NextResponse.json(
      { error: "Failed to fetch price history" },
      { status: 500 }
    );
  }
}
