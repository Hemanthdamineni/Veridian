import Link from "next/link";
import { PROVENANCE_DESCRIPTIONS, PROVENANCE_LABELS } from "@/types";
import type { Comparison } from "@/lib/compare";

/**
 * The highlights: a short, honest account of what actually differs.
 *
 * Only real differences are named. A metric that one configuration does not
 * report is never counted as a difference and never counted as a similarity
 * either — it is called out as missing.
 */

interface ComparisonHighlightsProps {
  comparison: Comparison;
}

export function ComparisonHighlights({ comparison }: ComparisonHighlightsProps) {
  const { rows, summary, provenance, leads, analysis } = comparison;
  const differing = comparison.metrics.filter((metric) => metric.differs);
  const incomplete = comparison.metrics.filter((metric) => !metric.comparable);
  const displayLeader = analysis?.display;

  return (
    <section aria-labelledby="compare-verdict" className="surface p-6">
      <p className="eyebrow mb-2">What differs</p>
      <h2
        id="compare-verdict"
        className="font-display text-[clamp(20px,2.4vw,28px)] leading-[1.15] tracking-[-.03em] text-balance"
      >
        {summary.sentence}
      </h2>

      {rows.length === 1 && (
        <p className="mt-3 text-[13px] leading-6 text-[var(--muted)]">
          One configuration is selected. Add a second one and this panel will tell you exactly
          what changes between them.
        </p>
      )}

      {summary.nothingToCompare && (
        <p className="mt-3 text-[13px] leading-6 text-[var(--muted)]">
          These configurations share no metric at all, so there is no honest way to rank them
          against each other. Their individual specification pages still list whatever each one
          does report.
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="label">What separates them</h3>
          {differing.length === 0 ? (
            <p className="text-[13px] leading-6 text-[var(--muted)]">
              {rows.length < 2
                ? "Nothing to separate yet."
                : "No metric they both report holds a different value."}
            </p>
          ) : (
            <ul className="space-y-4">
              {differing.map((metric) => (
                <li key={metric.metric.key}>
                  <p className="text-[13px] font-semibold">{metric.metric.label}</p>
                  <ul className="mt-1 space-y-0.5">
                    {metric.cells.map((cell) => {
                      const row = rows[cell.rowIndex];
                      return (
                        <li key={row.id} className="text-[12px] leading-5 text-[var(--muted)]">
                          <span className="text-[var(--ink)]">
                            {row.brand} {row.modelName}
                          </span>
                          {cell.reported ? <> — {cell.text}</> : " — not reported"}
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          {incomplete.length > 0 && (
            <p className="mt-4 border-t border-[var(--line)] pt-3 text-[12px] leading-5 text-[var(--muted)]">
              {incomplete.length === 1
                ? "One metric is not reported by every configuration, so nothing is concluded from it."
                : `${incomplete.length} metrics are not reported by every configuration, so nothing is concluded from them.`}{" "}
              A missing value is never counted as a difference.
            </p>
          )}
        </div>

        <div>
          <h3 className="label">Where each one leads</h3>
          {leads.length === 0 ? (
            <p className="text-[13px] leading-6 text-[var(--muted)]">
              No configuration holds a best value on any metric they all report.
            </p>
          ) : (
            <ul className="space-y-4">
              {leads.map((lead) => {
                const row = rows[lead.rowIndex];
                return (
                  <li key={row.id}>
                    <p className="text-[13px] font-semibold">
                      <Link
                        href={`/skus/${row.id}`}
                        className="hover:underline underline-offset-4"
                      >
                        {row.brand} {row.modelName}
                      </Link>
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {lead.items.map((item) => (
                        <li key={item.metric.key} className="text-[12px] leading-5 text-[var(--muted)]">
                          <span className="text-[var(--ink)]">{item.metric.bestLabel}</span> —{" "}
                          {item.text}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}

          {displayLeader && (
            <p className="mt-4 border-t border-[var(--line)] pt-3 text-[12px] leading-5 text-[var(--muted)]">
              On the combined display score, {displayLeader.explanation}.
            </p>
          )}
        </div>
      </div>

      <div className="mt-6 border-t border-[var(--line)] pt-4">
        <h3 className="label">Where these figures come from</h3>
        <p className="text-[13px] leading-6 text-[var(--muted)]">{provenance.sentence}</p>
        <ul className="mt-3 flex flex-wrap gap-2">
          {rows.map((row) => (
            <li
              key={row.id}
              className="rounded-[5px] border border-[var(--line)] px-2.5 py-1.5 text-[11px] text-[var(--muted)]"
            >
              <span className="font-medium text-[var(--ink)]">{row.brand}</span>{" "}
              {row.modelName} — {PROVENANCE_LABELS[row.provenance]}
              <span className="sr-only">. {PROVENANCE_DESCRIPTIONS[row.provenance]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] leading-5 text-[var(--quiet)]">
          Prices are the manufacturer&rsquo;s suggested price for each region, recorded at our last
          update — not a live retail price. See{" "}
          <Link href="/methodology" className="text-[var(--accent-dark)] underline underline-offset-4">
            how this catalog works
          </Link>{" "}
          for the full breakdown.
        </p>
      </div>
    </section>
  );
}
