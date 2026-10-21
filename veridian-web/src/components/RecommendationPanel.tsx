"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * Use-case recommendations.
 *
 * The scoring engine behind `/api/recommendations` explains every choice:
 * it reports the pros and cons it weighed, and it says plainly when a
 * constraint could not be checked because no price is recorded. Showing the
 * reasoning is what separates a recommendation from an advert.
 */

interface Recommendation {
  sku_id: string;
  name: string;
  price: number | null;
  currency: string;
  match_score: number;
  pros: string[];
  cons: string[];
  reason: string;
}

interface Response {
  requirements: Record<string, unknown>;
  recommendations: Recommendation[];
  total_candidates: number;
}

const USE_CASES: Array<{ id: string; label: string; detail: string }> = [
  { id: "programming", label: "Programming", detail: "Memory and processor headroom" },
  { id: "travel", label: "Travel", detail: "Weight and battery" },
  { id: "business", label: "Business", detail: "A balanced, dependable machine" },
  { id: "creative", label: "Creative work", detail: "Display quality" },
  { id: "student", label: "Student", detail: "Value first" },
  { id: "gaming", label: "Gaming", detail: "Graphics and refresh rate" },
];

export function RecommendationPanel() {
  const [useCase, setUseCase] = useState("travel");
  const [result, setResult] = useState<{
    useCase: string;
    data: Response | null;
    error: string | null;
  }>({ useCase: "travel", data: null, error: null });

  // The panel is loading whenever the answer in hand is not the answer for
  // the use case that is selected. Deriving the flag this way keeps the
  // effect free of a synchronous state update, which would cause a second
  // render on every change.
  const loading = result.useCase !== useCase;
  const data = loading ? null : result.data;
  const error = loading ? null : result.error;

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/recommendations?use_case=${useCase}&limit=4`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Recommendations request failed (${response.status})`);
        return (await response.json()) as Response;
      })
      .then((body) => {
        setResult({ useCase, data: body, error: null });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setResult({
          useCase,
          data: null,
          error: err instanceof Error ? err.message : "Could not load recommendations.",
        });
      });
    return () => controller.abort();
  }, [useCase]);

  const active = USE_CASES.find((u) => u.id === useCase);

  return (
    <section aria-label="Recommendations" className="surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <h2 className="font-display text-[24px] tracking-[-.03em]">Start from a use case</h2>
          <p className="mt-1 text-[12px] text-[var(--muted)]">
            {active?.detail}. Every pick lists the reasons behind it, including the ones it did not
            meet.
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-1.5" role="group" aria-label="Use case">
        {USE_CASES.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={useCase === option.id}
            onClick={() => setUseCase(option.id)}
            className={`rounded-[5px] border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              useCase === option.id
                ? "border-[var(--ink)] bg-[var(--ink)] text-white"
                : "border-[var(--line-strong)] text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="mt-6 text-[13px] text-[var(--danger)]" role="alert">
          {error}
        </p>
      ) : loading ? (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <li key={index} className="h-32 animate-pulse rounded-[6px] bg-[var(--surface-soft)]" />
          ))}
        </ul>
      ) : data && data.recommendations.length > 0 ? (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.recommendations.map((item) => (
            <li key={item.sku_id} className="rounded-[6px] border border-[var(--line)] p-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-[14px] font-semibold leading-snug">{item.name}</h3>
                <span
                  className="shrink-0 rounded-[4px] bg-[var(--surface-soft)] px-2 py-1 font-mono text-[11px] tabular-nums text-[var(--muted)]"
                  title="Match score out of 100"
                >
                  {Math.round(item.match_score)}
                </span>
              </div>
              <p className="mt-1.5 text-[12px] leading-5 text-[var(--muted)]">{item.reason}</p>
              {item.pros.length > 0 && (
                <ul className="mt-2.5 space-y-1">
                  {item.pros.slice(0, 3).map((pro) => (
                    <li key={pro} className="text-[11px] leading-4 text-[var(--success)]">
                      + {pro}
                    </li>
                  ))}
                </ul>
              )}
              {item.cons.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {item.cons.slice(0, 2).map((con) => (
                    <li key={con} className="text-[11px] leading-4 text-[var(--warning)]">
                      − {con}
                    </li>
                  ))}
                </ul>
              )}
              <Link
                href={`/skus/${item.sku_id}`}
                className="mt-3 inline-block text-[12px] font-semibold text-[var(--accent-dark)] underline decoration-[var(--accent-soft)] underline-offset-4"
              >
                Inspect <span aria-hidden="true">→</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-6 text-[13px] text-[var(--muted)]">
          No configuration matches this use case yet.
        </p>
      )}
    </section>
  );
}
