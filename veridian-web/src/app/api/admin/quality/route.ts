import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/api-key";
import { runDataQualityAudit, summariseQuality } from "@/lib/data-quality";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/quality
 *
 * Returns the data-quality measures for the live catalog: every check, with
 * its severity, how many rows violate it, and the affected values. The checks
 * are the same ones the CLI audit runs (`npm run db:audit`), read from
 * `src/lib/data-quality.ts`, so the dashboard and the audit can never
 * disagree.
 *
 * A check with a non-zero count is a measurable gap, not a pass. Checks that
 * currently hold are reported with a count of zero so a reader can tell
 * "measured and clean" from "not measured".
 *
 * The route is admin-authenticated. The middleware already protects every
 * `/api/admin/*` path; the guard below is a second, independent check so the
 * endpoint stays unreachable even if the matcher is narrowed later.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.ADMIN_TOKEN ?? "";
  if (!expected) {
    return NextResponse.json(
      { error: "ADMIN_TOKEN is not configured; the quality endpoint is disabled." },
      { status: 503 }
    );
  }

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const cookie = request.cookies.get("admin_session")?.value ?? "";
  const presented = bearer || cookie;
  if (!presented || !constantTimeEqual(expected, presented)) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="admin"' } }
    );
  }

  try {
    const report = await runDataQualityAudit();

    return NextResponse.json({
      generatedAt: report.generatedAt,
      totals: report.totals,
      provenance: report.provenance,
      checks: report.checks,
      summary: summariseQuality(report),
    });
  } catch (error) {
    console.error("Error computing data quality measures:", error);
    return NextResponse.json(
      { error: "Failed to compute the data quality measures" },
      { status: 500 }
    );
  }
}
