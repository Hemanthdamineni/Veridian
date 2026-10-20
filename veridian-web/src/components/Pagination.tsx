"use client";

interface Props {
  page: number;
  totalPages: number;
  totalResults: number;
  onChange: (page: number) => void;
}

export function Pagination({ page, totalPages, totalResults, onChange }: Props) {
  if (totalPages <= 1) return null;

  const pages = visiblePages(page, totalPages);

  return (
    <div className="mt-10 flex flex-col items-center justify-between gap-4 sm:flex-row">
      <p className="text-[12px] text-[var(--muted)]" role="status">
        Page {page} of {totalPages} · {totalResults.toLocaleString()} result{totalResults === 1 ? "" : "s"}
      </p>
      <nav aria-label="Pagination" className="flex items-center gap-1">
        <PageBtn disabled={page <= 1} onClick={() => onChange(page - 1)} label="Previous page">
          ← Prev
        </PageBtn>
        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`e${i}`} className="px-1 text-[12px] text-[var(--quiet)]" aria-hidden="true">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p as number)}
              aria-current={p === page ? "page" : undefined}
              aria-label={`Page ${p}`}
              className={`min-h-[36px] min-w-[36px] rounded-[5px] px-2 text-[12px] font-medium transition-colors ${
                p === page
                  ? "bg-[var(--ink)] text-white"
                  : "text-[var(--muted)] hover:bg-[#eceae5] hover:text-[var(--ink)]"
              }`}
            >
              {p}
            </button>
          )
        )}
        <PageBtn disabled={page >= totalPages} onClick={() => onChange(page + 1)} label="Next page">
          Next →
        </PageBtn>
      </nav>
    </div>
  );
}

function PageBtn({
  children,
  disabled,
  onClick,
  label,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      className="min-h-[36px] rounded-[5px] border border-[var(--line-strong)] px-3 text-[12px] font-medium text-[var(--muted)] transition-colors hover:border-[var(--ink)] hover:text-[var(--ink)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[var(--line-strong)] disabled:hover:text-[var(--muted)]"
    >
      {children}
    </button>
  );
}

function visiblePages(page: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "…")[] = [1];
  if (page > 3) out.push("…");
  for (let i = Math.max(2, page - 1); i <= Math.min(total - 1, page + 1); i++) out.push(i);
  if (page < total - 2) out.push("…");
  out.push(total);
  return out;
}
