import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { EnergyStarAdapter } from "@/lib/energy-star/adapter";
import { ingestReport } from "@/lib/energy-star/ingest";
import { LAPTOP_PRODUCT_TYPES } from "@/lib/energy-star/validate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Refresh the catalog from its cited sources.
 *
 * This is the bridge between the ingestion pipeline and the database the
 * application reads (ADR-003). It runs the same audited path the CLI does:
 * fetch, validate field by field, append the raw observation, then write the
 * canonical entities. Nothing is inserted that has not been validated, and a
 * record that fails validation is stored with its reason.
 *
 * It is deliberately **not** a side effect of public browsing. The endpoint
 * is admin-authenticated, it is an explicit request, and it reports exactly
 * what it did.
 *
 * POST /api/refresh
 *   ?types=Notebook,Two-In-One%20Notebook   product types to refresh
 *   ?limit=100                              first N rows only (development)
 */
export async function POST(request: NextRequest) {
  // The admin token is compared in constant time. The endpoint writes to the
  // canonical catalog, so it must never be reachable without the token.
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const expected = process.env.ADMIN_TOKEN ?? "";

  if (!expected) {
    return NextResponse.json(
      { error: "ADMIN_TOKEN is not configured; the refresh endpoint is disabled." },
      { status: 503 }
    );
  }
  if (!token || !safeEqual(expected, token)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="admin"' } }
    );
  }

  try {
    const { searchParams } = new URL(request.url);
    const requestedTypes = searchParams.get("types");
    const types = requestedTypes
      ? requestedTypes.split(",").map((t) => t.trim()).filter(Boolean)
      : [...LAPTOP_PRODUCT_TYPES];

    for (const type of types) {
      if (!(LAPTOP_PRODUCT_TYPES as readonly string[]).includes(type)) {
        return NextResponse.json(
          {
            error: `Unsupported product type '${type}'.`,
            supported: LAPTOP_PRODUCT_TYPES,
          },
          { status: 400 }
        );
      }
    }

    const limitValue = searchParams.get("limit");
    const limit = limitValue ? Number(limitValue) : null;
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 1000)) {
      return NextResponse.json(
        { error: "limit must be an integer from 1 to 1000" },
        { status: 400 }
      );
    }

    const adapter = new EnergyStarAdapter();
    const report = limit
      ? await adapter.run(0, limit, types[0])
      : await adapter.runAll(types);
    const persistence = await ingestReport(prisma, report);

    const totals = await prisma.$transaction([
      prisma.sku.count({ where: { catalogVisible: true } }),
      prisma.sku.count({ where: { provenance: "certified" } }),
      prisma.rawObservation.count({ where: { source: report.source } }),
      prisma.certifiedSkuSpec.count(),
    ]);

    return NextResponse.json({
      source: report.source,
      productTypes: types,
      pagesRead: report.pages ?? 1,
      recordsFetched: report.requested,
      accepted: report.accepted,
      rejected: report.rejected,
      canonicalSkusCreated: persistence.created,
      configurationsMerged: persistence.merged,
      alreadyPresent: persistence.unchanged,
      rejectedStored: persistence.rejectedStored,
      totals: {
        visibleSkus: totals[0],
        certifiedSkus: totals[1],
        sourceRawObservations: totals[2],
        certifiedSpecRecords: totals[3],
      },
      rejectedSamples: report.rejectedRecords.slice(0, 5).map(({ sourceRecordId, errors }) => ({
        sourceRecordId,
        errors,
      })),
    });
  } catch (error) {
    console.error("Catalog refresh failed:", error);
    return NextResponse.json(
      { error: "The refresh failed; the catalog was not modified." },
      { status: 500 }
    );
  }
}

/** Constant-time comparison, so a wrong token cannot be found by timing. */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
