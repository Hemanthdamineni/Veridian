import Link from "next/link";
import { QualityPanel } from "@/components/admin/QualityPanel";
import { runDataQualityAudit } from "@/lib/data-quality";
import type { DataQualityReport } from "@/lib/data-quality";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Data quality | Veridian admin",
  robots: { index: false, follow: false },
};

/**
 * The data-quality dashboard.
 *
 * The page reads the same checks the CLI audit runs, straight from the
 * database, so what an operator sees here is what `npm run db:audit` prints.
 * The route is protected by the admin middleware; this page is only reachable
 * with a valid admin token.
 */
export default async function AdminQualityPage() {
  let report: DataQualityReport | null = null;
  let error: string | null = null;

  try {
    report = await runDataQualityAudit();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Unknown error";
  }

  return (
    <div className="container py-10 sm:py-14">
      <nav aria-label="Admin sections" className="mb-8">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link
              href="/admin"
              className="inline-flex min-h-[34px] items-center rounded-[5px] border border-[var(--line-strong)] px-3 text-[12px] text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
            >
              Catalog
            </Link>
          </li>
          <li>
            <Link
              href="/admin/quality"
              aria-current="page"
              className="inline-flex min-h-[34px] items-center rounded-[5px] border border-[var(--ink)] bg-[var(--ink)] px-3 text-[12px] text-white"
            >
              Data quality
            </Link>
          </li>
          <li>
            <Link
              href="/admin/keys"
              className="inline-flex min-h-[34px] items-center rounded-[5px] border border-[var(--line-strong)] px-3 text-[12px] text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
            >
              API keys
            </Link>
          </li>
        </ul>
      </nav>

      <header className="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow mb-2">Internal workspace</p>
          <h1 className="font-display text-[40px] tracking-[-.04em]">Data quality</h1>
          <p className="mt-2 max-w-[62ch] text-[13px] leading-6 text-[var(--muted)]">
            Every check the audit runs, measured against the live catalog. A check with a non-zero
            count is a gap in the catalog, not a pass.
          </p>
        </div>
        <span className="font-mono text-[11px] text-[var(--quiet)]">
          {report ? `Generated ${new Date(report.generatedAt).toLocaleString()}` : "Not measured"}
        </span>
      </header>

      {error ? (
        <div className="surface border-[var(--danger)] p-6" role="alert">
          <p className="font-semibold">The measures could not be computed</p>
          <p className="mt-2 text-[13px] text-[var(--muted)]">{error}</p>
          <p className="mt-3 text-[13px] text-[var(--muted)]">
            Please ensure DATABASE_URL is configured and the database is accessible.
          </p>
        </div>
      ) : report ? (
        <QualityPanel report={report} />
      ) : null}
    </div>
  );
}
