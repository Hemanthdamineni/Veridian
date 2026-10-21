import Link from "next/link";
import { PROVENANCE_LABELS } from "@/types";
import type { Comparison, CompareMetricResult } from "@/lib/compare";

/**
 * The comparison table.
 *
 * The rule the table enforces: a best value is only ever marked when every
 * compared configuration reports that metric. When a configuration does not
 * report it, the row says so in words instead of naming a winner.
 */

interface ComparisonTableProps {
  comparison: Comparison;
}

export function ComparisonTable({ comparison }: ComparisonTableProps) {
  const { rows, groups } = comparison;

  if (rows.length === 0) {
    return (
      <p className="text-[13px] text-[var(--muted)]">
        Nothing to show yet. Add a configuration to start the comparison.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-[8px] border border-[var(--line)] bg-[var(--surface)]">
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <caption className="sr-only">
          Side-by-side specification comparison for {rows.length} configurations. The best value is
          marked only on metrics every configuration reports.
        </caption>
        <thead>
          <tr className="border-b border-[var(--line)]">
            <th
              scope="col"
              className="sticky left-0 z-10 min-w-[200px] bg-[var(--surface)] px-4 py-4 text-left align-bottom font-semibold text-[var(--muted)]"
            >
              Metric
            </th>
            {rows.map((row) => (
              <th
                key={row.id}
                scope="col"
                className="min-w-[200px] border-l border-[var(--line)] px-4 py-4 text-left align-top font-normal"
              >
                <span className="block text-[10px] uppercase tracking-[.1em] text-[var(--quiet)]">
                  {row.brand}
                </span>
                <Link
                  href={`/skus/${row.id}`}
                  className="mt-0.5 block font-display text-[16px] leading-tight tracking-[-.02em] hover:underline underline-offset-4"
                >
                  {row.modelName}
                </Link>
                <span className="mt-1 block font-mono text-[10px] text-[var(--quiet)]">
                  {row.skuCode}
                </span>
                <span
                  className={`mt-2 inline-block rounded px-2 py-0.5 text-[10px] font-medium ${
                    row.provenance === "certified"
                      ? "bg-[var(--success-soft)] text-[var(--success)]"
                      : row.provenance === "manufacturer"
                        ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]"
                        : "bg-[var(--warning-soft)] text-[var(--warning)]"
                  }`}
                >
                  {PROVENANCE_LABELS[row.provenance]}
                </span>
              </th>
            ))}
          </tr>
        </thead>

        {groups.map((group) => (
          <tbody key={group.name}>
            <tr>
              <th
                scope="colgroup"
                colSpan={rows.length + 1}
                className="bg-[var(--surface-soft)] px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-[.1em] text-[var(--muted)]"
              >
                {group.name}
              </th>
            </tr>
            {group.metrics.map((metric) => (
              <MetricRow key={metric.metric.key} metric={metric} comparison={comparison} />
            ))}
          </tbody>
        ))}
      </table>

      <p className="border-t border-[var(--line)] px-4 py-3 text-[11px] leading-5 text-[var(--quiet)]">
        Prices are the manufacturer&rsquo;s suggested price for the region shown, recorded at our
        last update — not a live retail price. A metric that a configuration does not report is
        never treated as a loss.
      </p>
    </div>
  );
}

function MetricRow({
  metric,
  comparison,
}: {
  metric: CompareMetricResult;
  comparison: Comparison;
}) {
  const { rows } = comparison;
  const bestLabel = metric.metric.bestLabel;

  return (
    <tr className="border-t border-[var(--line)] align-top">
      <th
        scope="row"
        className="sticky left-0 z-10 bg-[var(--surface)] px-4 py-3 text-left font-medium text-[var(--ink)]"
      >
        <span className="block">{metric.metric.label}</span>
        {metric.differs && (
          <span className="mt-1 inline-block rounded-[4px] bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[.06em] text-[var(--accent-dark)]">
            Differs
          </span>
        )}
        {metric.note && (
          <span className="mt-1 block max-w-[220px] text-[10px] font-normal leading-4 text-[var(--muted)]">
            {metric.note}
          </span>
        )}
      </th>

      {metric.cells.map((cell) => {
        const row = rows[cell.rowIndex];
        return (
          <td
            key={row.id}
            className={`border-l border-[var(--line)] px-4 py-3 ${
              cell.best
                ? "bg-[var(--success-soft)] font-semibold text-[var(--ink)]"
                : metric.differs
                  ? "text-[var(--ink)]"
                  : "text-[var(--muted)]"
            }`}
          >
            {cell.reported ? (
              <>
                <span>{cell.text}</span>
                {cell.best && bestLabel ? (
                  <span className="ml-2 inline-block rounded-[4px] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[.06em] text-[var(--success)]">
                    {bestLabel}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-[var(--quiet)]">
                <span aria-hidden="true">—</span>
                <span className="sr-only">Not reported</span>
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}
