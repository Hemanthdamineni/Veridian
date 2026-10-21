import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { OPENAPI_DOCUMENT } from "@/lib/openapi";

export const dynamic = "force-dynamic";

/**
 * Public API — the index.
 *
 * GET /api/v1
 *
 * The index is public: it describes the endpoints and the provenance model
 * without requiring a key.
 */
export async function GET(request: NextRequest) {
  const { pathname } = new URL(request.url);
  if (pathname.endsWith("/openapi")) {
    return NextResponse.json(OPENAPI_DOCUMENT);
  }

  const manufacturers = await prisma.manufacturer.count();

  return NextResponse.json({
    name: "Veridian Public API",
    version: "1.0",
    documentation: "/api/v1/openapi",
    endpoints: [
      "/api/v1/skus",
      "/api/v1/skus/{id}",
      "/api/v1/manufacturers",
      "/api/v1/components",
      "/api/v1/components/{slug}",
      "/api/v1/compare",
      "/api/v1/recommendations",
    ],
    authentication: {
      type: "API key",
      headers: ["X-API-Key", "Authorization: Bearer <key>"],
      note: "Each key has an hourly request budget. Exceeding it returns 429 with a Retry-After header.",
    },
    provenance:
      "Every configuration carries a provenance tier: certified (a cited certification record), manufacturer (checked against the maker's specification page) or unverified (no citation).",
    prices:
      "Prices are manufacturer suggested prices recorded at the last update. They are reference values, not live retail quotes.",
    coverage: { manufacturers },
  });
}
