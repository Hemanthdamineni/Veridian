"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The review queue.
 *
 * One card per queued correction: the field it contests, the value it claims,
 * the value the catalog holds right now, the evidence it carries, the reader
 * who sent it and what other readers voted. The reviewer accepts, rejects, or
 * asks for more evidence.
 *
 * Accepting is the only action that touches the catalog, and it does so by
 * adding a source rather than overwriting the record.
 */

interface QueueItem {
  id: string;
  type: string;
  status: string;
  field: string | null;
  fieldLabel: string | null;
  claimedValue: string;
  currentValue: string | null;
  reportedValue: string | null;
  evidenced: boolean;
  evidenceUrl: string | null;
  evidenceText: string | null;
  submitter: {
    id: string;
    name: string | null;
    email: string;
    emailVerified: boolean;
    reputation: number;
  };
  votes: {
    confirmed: number;
    disputed: number;
    needsVerification: number;
    total: number;
  };
  sku: {
    id: string;
    skuCode: string;
    modelName: string;
    seriesName: string;
    manufacturerName: string;
  };
  createdAt: string;
}

const FILTERS = [
  { key: "", label: "Waiting for a decision" },
  { key: "pending", label: "Waiting for a first look" },
  { key: "needs_evidence", label: "Waiting for more evidence" },
  { key: "approved", label: "Applied" },
  { key: "rejected", label: "Rejected" },
];

const STATUS_LABELS: Record<string, string> = {
  pending: "Waiting for review",
  approved: "Applied",
  rejected: "Rejected",
  needs_evidence: "Needs a source",
};

export function ContributionQueue() {
  const [filter, setFilter] = useState("");
  const [items, setItems] = useState<QueueItem[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (status: string, signal?: AbortSignal): Promise<QueueItem[]> => {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      const response = await fetch(`/api/admin/contributions${query}`, {
        credentials: "include",
        signal,
      });
      if (response.status === 401) {
        throw new Error("This queue needs an admin session. Sign in again.");
      }
      if (!response.ok) {
        throw new Error("The queue could not be loaded.");
      }
      const data = await response.json();
      return Array.isArray(data.results) ? (data.results as QueueItem[]) : [];
    },
    []
  );

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    load(filter, controller.signal).then(
      (items) => {
        if (!active) return;
        setItems(items);
        setError(null);
        setLoading(false);
      },
      (reason: unknown) => {
        if (!active) return;
        setItems([]);
        setError(
          reason instanceof Error && reason.name === "AbortError"
            ? null
            : reason instanceof Error
              ? reason.message
              : "The queue could not be loaded."
        );
        setLoading(false);
      }
    );
    return () => {
      active = false;
      controller.abort();
    };
  }, [filter, load]);

  async function act(item: QueueItem, action: "accept" | "reject" | "request_evidence") {
    setBusy(item.id);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/contributions/${item.id}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          note: notes[item.id]?.trim() || null,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "The decision could not be recorded.");
        return;
      }
      setMessage(typeof data.message === "string" ? data.message : "Recorded.");
      setNotes((current) => ({ ...current, [item.id]: "" }));
      const refreshed = await load(filter);
      setItems(refreshed);
    } catch {
      setError("The decision could not be recorded.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-col gap-3 border-b border-[var(--line)] pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow mb-2">Review queue</p>
          <h2 className="font-display text-[25px] tracking-[-.025em]">Community corrections</h2>
        </div>
        <div className="sm:w-64">
          <label htmlFor="queue-filter" className="label">
            Show
          </label>
          <select
            id="queue-filter"
            className="field"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setLoading(true);
            }}
          >
            {FILTERS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div aria-live="polite">
        {message && (
          <p className="mb-4 rounded-[5px] border border-[var(--success)] bg-[var(--success-soft)] p-3 text-[13px] leading-5 text-[var(--success)]" role="status">
            {message}
          </p>
        )}
        {error && (
          <p className="mb-4 rounded-[5px] border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-[13px] leading-5 text-[var(--danger)]" role="alert">
            {error}
          </p>
        )}
      </div>

      {loading ? (
        <p className="text-[13px] text-[var(--muted)]">Loading the queue…</p>
      ) : items.length === 0 ? (
        <p className="rounded-[8px] border border-dashed border-[var(--line-strong)] p-8 text-center text-[13px] text-[var(--muted)]">
          Nothing is waiting for a decision.
        </p>
      ) : (
        <ul className="space-y-4">
          {items.map((item) => (
            <li key={item.id} className="surface p-5 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[14px] font-semibold text-[var(--ink)]">
                    {item.fieldLabel ?? item.field ?? "Unnamed field"}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-[var(--quiet)]">
                    {item.sku.manufacturerName} {item.sku.modelName} · {item.sku.skuCode}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {!item.evidenced && (
                    <span className="rounded-[5px] bg-[var(--warning-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--warning)]">
                      Unevidenced
                    </span>
                  )}
                  <span className="rounded-[5px] bg-[var(--accent-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--accent-dark)]">
                    {STATUS_LABELS[item.status] ?? item.status}
                  </span>
                </div>
              </div>

              <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="surface-soft p-3">
                  <dt className="text-[10px] uppercase tracking-[.08em] text-[var(--quiet)]">
                    Claimed
                  </dt>
                  <dd className="mt-1 text-[14px] font-medium">{item.claimedValue}</dd>
                </div>
                <div className="surface-soft p-3">
                  <dt className="text-[10px] uppercase tracking-[.08em] text-[var(--quiet)]">
                    In the catalog now
                  </dt>
                  <dd className="mt-1 text-[14px] font-medium">
                    {item.currentValue ?? <span className="text-[var(--quiet)]">not reported</span>}
                  </dd>
                </div>
                <div className="surface-soft p-3">
                  <dt className="text-[10px] uppercase tracking-[.08em] text-[var(--quiet)]">
                    Reported as
                  </dt>
                  <dd className="mt-1 text-[14px] font-medium">
                    {item.reportedValue ?? <span className="text-[var(--quiet)]">unknown</span>}
                  </dd>
                </div>
              </dl>

              <div className="mt-4 space-y-2 text-[12px] leading-5 text-[var(--muted)]">
                <p>
                  <span className="font-semibold text-[var(--ink)]">Evidence:</span>{" "}
                  {item.evidenceUrl ? (
                    <a
                      href={item.evidenceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--accent-dark)] underline underline-offset-4"
                    >
                      {item.evidenceUrl} ↗
                    </a>
                  ) : (
                    <span className="text-[var(--warning)]">
                      none supplied — recorded as an unevidenced correction
                    </span>
                  )}
                </p>
                {item.evidenceText && (
                  <p className="whitespace-pre-line border-l-2 border-[var(--line)] pl-3">
                    {item.evidenceText}
                  </p>
                )}
                <p>
                  <span className="font-semibold text-[var(--ink)]">Submitted by:</span>{" "}
                  {item.submitter.name ?? "Unnamed reader"} ({item.submitter.email}){" "}
                  {item.submitter.emailVerified ? null : "· address not verified"}
                </p>
                <p>
                  <span className="font-semibold text-[var(--ink)]">Votes:</span>{" "}
                  {item.votes.confirmed} confirmed · {item.votes.disputed} disputed ·{" "}
                  {item.votes.needsVerification} need verification
                </p>
              </div>

              {item.status === "pending" || item.status === "needs_evidence" ? (
                <>
                  <div className="mt-4">
                    <label htmlFor={`note-${item.id}`} className="label">
                      Note to the reader <span className="font-normal normal-case">(optional, used when you ask for more evidence)</span>
                    </label>
                    <input
                      id={`note-${item.id}`}
                      className="field"
                      type="text"
                      value={notes[item.id] ?? ""}
                      onChange={(event) =>
                        setNotes((current) => ({ ...current, [item.id]: event.target.value }))
                      }
                      placeholder="Which page states the value, and what does it say?"
                    />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={busy === item.id}
                      onClick={() => void act(item, "accept")}
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy === item.id}
                      onClick={() => void act(item, "request_evidence")}
                    >
                      Ask for more evidence
                    </button>
                    <button
                      type="button"
                      className="btn-quiet"
                      disabled={busy === item.id}
                      onClick={() => void act(item, "reject")}
                    >
                      Reject
                    </button>
                  </div>
                </>
              ) : (
                <p className="mt-4 text-[11px] text-[var(--quiet)]">
                  This report has already been decided. It is kept on the record.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
