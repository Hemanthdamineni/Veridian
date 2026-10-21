import type { DataQualityReport, QualityCheck, QualitySeverity } from "@/lib/data-quality";
import { summariseQuality } from "@/lib/data-quality";

/**
 * The data-quality panel.
 *
 * It renders the same measures the CLI audit prints, and it is deliberately
 * blunt about what they mean:
 *
 *   - A check with a non-zero count is a GAP. It is listed as a gap, with
 *     the number of affected rows, and never as a pass.
 *   - A check with a zero count is listed separately, as a check that was
 *     measured and currently holds. It is not evidence that the catalog is
 *     free of other problems.
 *   - Severity is written out in words next to the colour, so the report
 *     never depends on colour alone.
 */

const SEVERITY_META: Record<
  QualitySeverity,
  { label: string; chip: string; meaning: string }
> = {
  error: {
    label: "Error",
    chip: "border-[var(--danger)] bg-[var(--danger-soft)] text-[var(--danger)]",
    meaning: "The catalog contradicts itself, or states something it cannot back up.",
  },
  warning: {
    label: "Warning",
    chip: "border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]",
    meaning: "A measurable gap: the catalog is incomplete or cannot be checked against its source.",
  },
  info: {
    label: "Note",
    chip: "border-[var(--line-strong)] bg-[var(--surface-soft)] text-[var(--muted)]",
    meaning: "Measured for completeness. Not a defect on its own.",
  },
};

const TOTAL_LABELS: Array<[keyof DataQualityReport["totals"], string]> = [
  ["skus", "Configurations"],
  ["visibleSkus", "Visible"],
  ["manufacturers", "Manufacturers"],
  ["models", "Models"],
  ["skuSourceRecords", "Provenance records"],
  ["priceObservations", "Price observations"],
];

function SeverityChip({ severity }: { severity: QualitySeverity }) {
  const meta = SEVERITY_META[severity];
  return (
    <span
      className={`inline-flex items-center rounded-[4px] border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.08em] ${meta.chip}`}
    >
      {meta.label}
    </span>
  );
}

function CheckId({ id }: { id: string }) {
  return <span className="font-mono text-[12px] text-[var(--ink)]">{id}</span>;
}

function Samples({ samples }: { samples: string[] }) {
  if (samples.length === 0) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[.06em] text-[var(--muted)] hover:text-[var(--ink)]">
        {samples.length === 1 ? "Show the affected value" : `Show ${samples.length} affected values`}
      </summary>
      <ul className="mt-2 space-y-1">
        {samples.map((sample, index) => (
          <li key={`${sample}-${index}`} className="font-mono text-[11px] text-[var(--muted)]">
            {sample}
          </li>
        ))}
      </ul>
    </details>
  );
}

function CheckRow({ check }: { check: QualityCheck }) {
  const failing = check.count > 0;
  return (
    <tr className="border-t border-[var(--line)] align-top">
      <th scope="row" className="py-3 pr-4 text-left font-normal">
        <CheckId id={check.id} />
        <span className="mt-1 block text-[11px] font-normal text-[var(--muted)]">
          {failing
            ? `${check.count.toLocaleString()} ${check.count === 1 ? "row" : "rows"} affected`
            : "Measured, currently holding"}
        </span>
      </th>
      <td className="py-3 pr-4">
        <SeverityChip severity={check.severity} />
      </td>
      <td className="py-3 pr-4 font-mono text-[13px]">
        {check.count.toLocaleString()}
      </td>
      <td className="py-3 text-[12px] leading-5 text-[var(--muted)]">
        {check.message}
        {failing ? <Samples samples={check.samples} /> : null}
      </td>
    </tr>
  );
}

export interface QualityPanelProps {
  report: DataQualityReport;
}

export function QualityPanel({ report }: QualityPanelProps) {
  const summary = summariseQuality(report);
  const failing = report.checks.filter((check) => check.count > 0);
  const holding = report.checks.filter((check) => check.count === 0);

  return (
    <div className="space-y-8">
      {/* --- Catalog at a glance ------------------------------------------- */}
      <section className="surface p-6 sm:p-8" aria-labelledby="quality-totals">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div>
            <p className="eyebrow mb-2">Catalog at a glance</p>
            <h2 id="quality-totals" className="font-display text-[25px] tracking-[-.025em]">
              What these measures are taken from
            </h2>
          </div>
          <p className="font-mono text-[11px] text-[var(--quiet)]">
            Measured {new Date(report.generatedAt).toLocaleString()}
          </p>
        </div>

        <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-5 border-t border-[var(--line)] pt-6 sm:grid-cols-3 lg:grid-cols-6">
          {TOTAL_LABELS.map(([key, label]) => (
            <div key={key}>
              <dt className="label mb-1">{label}</dt>
              <dd className="font-mono text-[18px] font-semibold">
                {report.totals[key].toLocaleString()}
              </dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 border-t border-[var(--line)] pt-5">
          <p className="label mb-3">Provenance split</p>
          <ul className="flex flex-wrap gap-2">
            {Object.entries(report.provenance).map(([tier, count]) => (
              <li
                key={tier}
                className="rounded-[5px] border border-[var(--line-strong)] bg-[var(--surface-soft)] px-2.5 py-1 text-[12px]"
              >
                <span className="font-mono font-semibold">{count.toLocaleString()}</span>{" "}
                <span className="text-[var(--muted)]">{tier}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* --- Severity summary ---------------------------------------------- */}
      <section className="surface p-6 sm:p-8" aria-labelledby="quality-summary">
        <p className="eyebrow mb-2">Summary</p>
        <h2 id="quality-summary" className="font-display text-[25px] tracking-[-.025em]">
          {summary.failingChecks === 0
            ? "Every checked invariant currently holds"
            : `${summary.failingChecks} of ${summary.totalChecks} checks found a gap`}
        </h2>
        <p className="mt-3 max-w-[68ch] text-[13px] leading-6 text-[var(--muted)]">
          {summary.failingChecks === 0
            ? "All checks were run against the live catalog and none of them found a violating row. The remaining checks are listed below so it is clear what was measured."
            : `These are known, measurable gaps in the catalog, not passes. ${summary.failingChecks} of ${summary.totalChecks} checks found at least one violating row; the other ${summary.holdingChecks} were measured and currently hold. A finding is only closed when its count reaches zero.`}
        </p>

        <dl className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {(["error", "warning", "info"] as QualitySeverity[]).map((severity) => {
            const meta = SEVERITY_META[severity];
            const entry = summary.bySeverity[severity];
            return (
              <div
                key={severity}
                className={`rounded-[8px] border p-4 ${meta.chip}`}
              >
                <dt className="text-[11px] font-semibold uppercase tracking-[.08em]">
                  {meta.label}
                </dt>
                <dd className="mt-2 font-mono text-[24px] font-semibold leading-none">
                  {entry.checks.toLocaleString()}
                  <span className="ml-1.5 text-[11px] font-normal">
                    {entry.checks === 1 ? "check" : "checks"}
                  </span>
                </dd>
                <dd className="mt-2 text-[11px] leading-4">
                  {entry.affected.toLocaleString()} affected rows · {meta.meaning}
                </dd>
              </div>
            );
          })}
        </dl>
      </section>

      {/* --- The gaps ------------------------------------------------------ */}
      <section className="surface p-6 sm:p-8" aria-labelledby="quality-gaps">
        <p className="eyebrow mb-2">Open gaps</p>
        <h2 id="quality-gaps" className="font-display text-[25px] tracking-[-.025em]">
          {failing.length === 0
            ? "Nothing outstanding"
            : `${failing.length} ${failing.length === 1 ? "check has" : "checks have"} something to fix`}
        </h2>
        {failing.length === 0 ? (
          <p className="mt-3 text-[13px] text-[var(--muted)]">
            No check found a violating row in this run of the audit.
          </p>
        ) : (
          <ul className="mt-6 space-y-4">
            {failing.map((check) => (
              <li
                key={check.id}
                className="rounded-[8px] border border-[var(--line)] bg-[var(--surface-soft)] p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <SeverityChip severity={check.severity} />
                  <CheckId id={check.id} />
                  <span className="font-mono text-[13px] font-semibold">
                    {check.count.toLocaleString()}{" "}
                    <span className="font-normal text-[var(--muted)]">
                      {check.count === 1 ? "row affected" : "rows affected"}
                    </span>
                  </span>
                </div>
                <p className="mt-2 text-[12px] leading-5 text-[var(--muted)]">{check.message}</p>
                <Samples samples={check.samples} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Every check ---------------------------------------------------- */}
      <section className="surface p-6 sm:p-8" aria-labelledby="quality-checks">
        <p className="eyebrow mb-2">Full report</p>
        <h2 id="quality-checks" className="font-display text-[25px] tracking-[-.025em]">
          Every check, and what it measures
        </h2>
        <p className="mt-3 max-w-[68ch] text-[13px] leading-6 text-[var(--muted)]">
          All {report.checks.length} checks are listed, including the {holding.length} that were
          measured and currently hold. A zero count means the invariant was measured and found
          intact; it is not a claim that the catalog is free of other problems.
        </p>

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <caption className="sr-only">
              Every data-quality check with its severity, the number of affected rows and what the
              check measures.
            </caption>
            <thead>
              <tr className="border-b border-[var(--line-strong)]">
                <th scope="col" className="label py-2 pr-4">
                  Check
                </th>
                <th scope="col" className="label py-2 pr-4">
                  Severity
                </th>
                <th scope="col" className="label py-2 pr-4">
                  Affected
                </th>
                <th scope="col" className="label py-2">
                  What it measures
                </th>
              </tr>
            </thead>
            <tbody>
              {report.checks.map((check) => (
                <CheckRow key={check.id} check={check} />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
