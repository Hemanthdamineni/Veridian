"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ApiKeyView } from "@/lib/admin-keys";

/**
 * API key management.
 *
 * A key is shown to its owner exactly once, in the response that creates it.
 * The database stores only a SHA-256 hash, so this component never receives
 * a hash and never renders one: the list is built from fields that are safe
 * to display.
 */

const SCOPES = [
  { value: "read", label: "read", hint: "Read the public catalog." },
  { value: "write", label: "write", hint: "Submit contributions." },
  { value: "admin", label: "admin", hint: "Every scope, including admin routes." },
];

const STATUS_LABEL: Record<ApiKeyView["status"], string> = {
  active: "Active",
  disabled: "Disabled",
  expired: "Expired",
};

const STATUS_CLASS: Record<ApiKeyView["status"], string> = {
  active: "border-[var(--success)] bg-[var(--success-soft)] text-[var(--success)]",
  disabled: "border-[var(--line-strong)] bg-[var(--surface-soft)] text-[var(--muted)]",
  expired: "border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]",
};

function formatMoment(iso: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatExpiry(iso: string | null): string {
  if (!iso) return "No expiry";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "No expiry";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

export interface KeyManagerProps {
  initialKeys: ApiKeyView[];
}

export function KeyManager({ initialKeys }: KeyManagerProps) {
  const [keys, setKeys] = useState<ApiKeyView[]>(initialKeys);
  const [issued, setIssued] = useState<{ key: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({ name: "", scopes: ["read"], rateLimit: "1000", expiresInDays: "0" });

  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const issuedKeyRef = useRef<HTMLDivElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/keys", {
        credentials: "include",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Could not load the API keys");
      }
      const body = (await response.json()) as { keys: ApiKeyView[] };
      setKeys(body.keys);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the API keys");
    }
  }, []);

  // The list arrives from the server, so there is nothing to fetch on mount.
  // It is re-read from the API after every change.

  useEffect(() => {
    if (confirmRevoke) confirmButtonRef.current?.focus();
  }, [confirmRevoke]);

  useEffect(() => {
    if (issued) issuedKeyRef.current?.focus();
  }, [issued]);

  const readError = async (response: Response): Promise<string> => {
    const body = await response.json().catch(() => null);
    if (Array.isArray(body?.details) && body.details.length > 0) {
      return body.details.join("; ");
    }
    return body?.error || "The request failed";
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreating(true);
    setError(null);
    setNotice(null);
    setCopied(false);

    try {
      const response = await fetch("/api/admin/keys", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          scopes: form.scopes,
          rateLimit: Number(form.rateLimit),
          expiresInDays: Number(form.expiresInDays),
        }),
      });
      if (!response.ok) throw new Error(await readError(response));

      const body = (await response.json()) as { key: string; record: ApiKeyView };
      setIssued({ key: body.key, name: body.record.name });
      setForm({ name: "", scopes: ["read"], rateLimit: "1000", expiresInDays: "0" });
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not issue the key");
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (key: ApiKeyView) => {
    setBusy(key.id);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/keys/${encodeURIComponent(key.id)}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: key.status !== "disabled" }),
      });
      if (!response.ok) throw new Error(await readError(response));

      setNotice(
        key.status === "disabled"
          ? `The key ${key.name} is enabled again.`
          : `The key ${key.name} is disabled. It grants no scope until it is enabled again.`
      );
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the key");
    } finally {
      setBusy(null);
    }
  };

  const handleRevoke = async (key: ApiKeyView) => {
    setBusy(key.id);
    setError(null);
    setNotice(null);

    try {
      const response = await fetch(`/api/admin/keys/${encodeURIComponent(key.id)}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await readError(response));

      setNotice(`The key ${key.name} is revoked. It can no longer be used.`);
      setConfirmRevoke(null);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke the key");
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.key);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const toggleScope = (scope: string) => {
    setForm((current) => ({
      ...current,
      scopes: current.scopes.includes(scope)
        ? current.scopes.filter((value) => value !== scope)
        : [...current.scopes, scope],
    }));
  };

  return (
    <div className="space-y-8">
      {/* --- One-time secret ------------------------------------------------ */}
      {issued ? (
        <section
          ref={issuedKeyRef}
          tabIndex={-1}
          className="surface border-[var(--accent)] p-6 sm:p-8"
          aria-labelledby="issued-key-heading"
        >
          <p className="eyebrow mb-2">Shown once</p>
          <h2 id="issued-key-heading" className="font-display text-[25px] tracking-[-.025em]">
            Copy the key for {issued.name} now
          </h2>
          <p className="mt-3 max-w-[68ch] text-[13px] leading-6 text-[var(--muted)]">
            This is the only time the key is shown. Only a hash of it is stored, so it cannot be
            recovered later. If it is lost, revoke it and issue a new one.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <code className="min-w-0 flex-1 break-all rounded-[5px] border border-[var(--line-strong)] bg-[var(--surface-soft)] px-3 py-2.5 font-mono text-[13px]">
              {issued.key}
            </code>
            <button type="button" className="btn-secondary" onClick={handleCopy}>
              {copied ? "Copied" : "Copy key"}
            </button>
            <button type="button" className="btn-quiet" onClick={() => setIssued(null)}>
              Done
            </button>
          </div>
          <p className="mt-3 text-[11px] text-[var(--quiet)]" role="status">
            {copied ? "The key is on the clipboard." : "Copy it before you leave this page."}
          </p>
        </section>
      ) : null}

      {/* --- Messages ------------------------------------------------------- */}
      <div aria-live="polite">
        {error ? (
          <div
            className="rounded-[5px] border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-[13px] text-[var(--danger)]"
            role="alert"
          >
            {error}
          </div>
        ) : null}
        {notice ? (
          <div
            className="rounded-[5px] border border-[var(--success)] bg-[var(--success-soft)] p-3 text-[13px] text-[var(--success)]"
            role="status"
          >
            {notice}
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        {/* --- Issue a key ---------------------------------------------------- */}
        <section className="surface p-6 sm:p-8" aria-labelledby="issue-key-heading">
          <p className="eyebrow mb-2">New key</p>
          <h2 id="issue-key-heading" className="font-display text-[25px] tracking-[-.025em]">
            Issue an API key
          </h2>

          <form onSubmit={handleCreate} noValidate className="mt-6 space-y-5">
            <div>
              <label className="label" htmlFor="key-name">
                Name
              </label>
              <input
                id="key-name"
                className="field"
                type="text"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                placeholder="Acme integration"
                maxLength={120}
                required
                aria-describedby="key-name-hint"
              />
              <p id="key-name-hint" className="mt-1.5 text-[11px] text-[var(--quiet)]">
                Shown in the key list so an operator can tell the keys apart.
              </p>
            </div>

            <fieldset>
              <legend className="label">Scopes</legend>
              <div className="space-y-2">
                {SCOPES.map((scope) => (
                  <label
                    key={scope.value}
                    className="flex cursor-pointer items-start gap-2 text-[13px]"
                  >
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 accent-[var(--accent)]"
                      checked={form.scopes.includes(scope.value)}
                      onChange={() => toggleScope(scope.value)}
                    />
                    <span>
                      <span className="font-mono text-[12px]">{scope.label}</span>
                      <span className="block text-[11px] text-[var(--muted)]">{scope.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="label" htmlFor="key-rate-limit">
                  Requests per hour
                </label>
                <input
                  id="key-rate-limit"
                  className="field"
                  type="number"
                  min={1}
                  max={100000}
                  step={1}
                  value={form.rateLimit}
                  onChange={(event) => setForm({ ...form, rateLimit: event.target.value })}
                  required
                />
              </div>
              <div>
                <label className="label" htmlFor="key-expiry">
                  Expires in (days)
                </label>
                <input
                  id="key-expiry"
                  className="field"
                  type="number"
                  min={0}
                  max={3650}
                  step={1}
                  value={form.expiresInDays}
                  onChange={(event) => setForm({ ...form, expiresInDays: event.target.value })}
                  required
                  aria-describedby="key-expiry-hint"
                />
                <p id="key-expiry-hint" className="mt-1.5 text-[11px] text-[var(--quiet)]">
                  0 means the key does not expire.
                </p>
              </div>
            </div>

            <button type="submit" disabled={creating} className="btn-primary w-full">
              {creating ? "Issuing…" : "Issue key"}
            </button>
            <p className="text-[11px] leading-5 text-[var(--quiet)]">
              The key is shown once, in this response only. The server stores a hash of it, never
              the key itself.
            </p>
          </form>
        </section>

        {/* --- The keys ------------------------------------------------------- */}
        <section className="surface p-6 sm:p-8" aria-labelledby="key-list-heading">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow mb-2">Issued keys</p>
              <h2 id="key-list-heading" className="font-display text-[25px] tracking-[-.025em]">
                Keys in circulation
              </h2>
            </div>
            <span className="font-mono text-[11px] text-[var(--muted)]">{keys.length} issued</span>
          </div>

          {keys.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-[var(--line-strong)] p-8 text-center text-[13px] text-[var(--muted)]">
              No API key has been issued yet.
            </div>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {keys.map((key) => (
                <li key={key.id} className="py-5 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-semibold">{key.name}</p>
                      <p className="mt-0.5 font-mono text-[10px] text-[var(--quiet)]">{key.id}</p>
                    </div>
                    <span
                      className={`inline-flex items-center rounded-[4px] border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[.08em] ${STATUS_CLASS[key.status]}`}
                    >
                      {STATUS_LABEL[key.status]}
                    </span>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
                    <div>
                      <dt className="label mb-1">Scopes</dt>
                      <dd className="font-mono text-[12px]">
                        {key.scopes.length > 0 ? key.scopes.join(", ") : "none"}
                      </dd>
                    </div>
                    <div>
                      <dt className="label mb-1">Rate limit</dt>
                      <dd className="font-mono text-[12px]">{key.rateLimit} / hour</dd>
                    </div>
                    <div>
                      <dt className="label mb-1">Used this hour</dt>
                      <dd className="font-mono text-[12px]">
                        {key.usageThisHour} / {key.rateLimit}
                      </dd>
                    </div>
                    <div>
                      <dt className="label mb-1">Expires</dt>
                      <dd className="font-mono text-[12px]">{formatExpiry(key.expiresAt)}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="label mb-1">Last used</dt>
                      <dd className="font-mono text-[12px]">{formatMoment(key.lastUsedAt)}</dd>
                    </div>
                    <div className="col-span-2">
                      <dt className="label mb-1">Issued</dt>
                      <dd className="font-mono text-[12px]">{formatMoment(key.createdAt)}</dd>
                    </div>
                  </dl>

                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busy === key.id}
                      onClick={() => handleToggle(key)}
                      aria-label={
                        key.status === "disabled"
                          ? `Enable the key named ${key.name}`
                          : `Disable the key named ${key.name}`
                      }
                    >
                      {key.status === "disabled" ? "Enable" : "Disable"}
                    </button>
                    {confirmRevoke === key.id ? (
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-[12px] text-[var(--danger)]">
                          Revoke for good? It cannot be undone.
                        </span>
                        <button
                          ref={confirmButtonRef}
                          type="button"
                          className="btn-primary"
                          disabled={busy === key.id}
                          onClick={() => handleRevoke(key)}
                          aria-label={`Confirm revoking the key named ${key.name}`}
                        >
                          Yes, revoke
                        </button>
                        <button
                          type="button"
                          className="btn-quiet"
                          onClick={() => setConfirmRevoke(null)}
                          aria-label={`Keep the key named ${key.name}`}
                        >
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={busy === key.id}
                        onClick={() => setConfirmRevoke(key.id)}
                        aria-label={`Revoke the key named ${key.name}`}
                      >
                        Revoke
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <p className="mt-6 border-t border-[var(--line)] pt-5 text-[11px] leading-5 text-[var(--quiet)]">
            Disabling a key removes every scope it grants, so the public API refuses it, and
            enabling it restores the scopes it had. Revoking deletes the key and its usage
            history for good.
          </p>
        </section>
      </div>
    </div>
  );
}
