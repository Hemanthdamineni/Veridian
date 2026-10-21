import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api-key";
import { loadPriceHistory, parsePriceHistoryQuery } from "@/lib/prices/stats";

export const dynamic = "force-dynamic";

/**
 * Public API — the price history of one configuration.
 *
 * GET /api/v1/skus/{id}/price-history
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
  context: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiKey(request);
  if ("response" in auth) return auth.response;

  const { id } = await context.params;

  if (!id || id.length < 10) {
    return NextResponse.json({ error: "No such configuration" }, { status: 404 });
  }

  const sku = await prisma.sku.findFirst({
    where: { id, catalogVisible: true },
    select: { id: true },
  });

  if (!sku) {
    return NextResponse.json({ error: "No such configuration" }, { status: 404 });
  }

  try {
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
