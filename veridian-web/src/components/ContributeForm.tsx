"use client";

import { useMemo, useState } from "react";

/**
 * The correction form.
 *
 * A reader picks the field they believe is wrong, says what the value should
 * be, and says where they saw it. The evidence is optional — a report
 * without a source is still filed — but the form makes it obvious that a
 * sourced report is the useful one.
 *
 * The form never changes anything in the catalog. It files a report, and the
 * server answers with what happened to it.
 */

export interface ContributeFormField {
  column: string;
  label: string;
  kind: "text" | "number" | "boolean";
  hint?: string;
  /** The value the catalog holds right now, so the reader can compare. */
  currentValue: string | null;
}

export interface ContributeFormProps {
  skuCode: string;
  modelName: string;
  fields: ContributeFormField[];
  /** Pre-selected field, for example when a reader follows a field link. */
  defaultField?: string;
}

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | { status: "done"; message: string; evidenced: boolean; reference: string };

export function ContributeForm({ skuCode, modelName, fields, defaultField }: ContributeFormProps) {
  const [field, setField] = useState<string>(
    defaultField && fields.some((f) => f.column === defaultField) ? defaultField : ""
  );
  const [value, setValue] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [note, setNote] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<SubmitState>({ status: "idle" });

  const selected = useMemo(
    () => fields.find((f) => f.column === field) ?? null,
    [fields, field]
  );

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "submitting" });

    try {
      const response = await fetch("/api/contributions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sku_code: skuCode,
          field,
          new_value: value,
          evidence_url: evidenceUrl.trim() || null,
          evidence_text: note.trim() || null,
          name: name.trim() || null,
          email: email.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setState({
          status: "error",
          message: typeof data.error === "string" ? data.error : "The report could not be filed.",
        });
        return;
      }

      setState({
        status: "done",
        message:
          typeof data.message === "string"
            ? data.message
            : "Thank you. Your report is with a reviewer.",
        evidenced: Boolean(data.evidenced),
        reference: typeof data.id === "string" ? data.id : "",
      });
    } catch {
      setState({
        status: "error",
        message: "The report could not be sent. Please try again.",
      });
    }
  }

  if (state.status === "done") {
    return (
      <div className="surface p-6 sm:p-8">
        <p className="eyebrow mb-2">Report filed</p>
        <h2 className="font-display text-[24px] tracking-[-.025em]">Thank you</h2>
        <p className="mt-3 text-[14px] leading-6 text-[var(--muted)]" role="status">
          {state.message}
        </p>
        <dl className="mt-5 space-y-2 border-t border-[var(--line)] pt-4 text-[13px]">
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[var(--muted)]">Configuration</dt>
            <dd className="font-mono text-[12px]">{skuCode}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-[var(--muted)]">Evidence</dt>
            <dd className={state.evidenced ? "text-[var(--success)]" : "text-[var(--warning)]"}>
              {state.evidenced ? "Source cited" : "No source cited"}
            </dd>
          </div>
          {state.reference && (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-[var(--muted)]">Reference</dt>
              <dd className="font-mono text-[11px] text-[var(--quiet)]">{state.reference}</dd>
            </div>
          )}
        </dl>
        <p className="mt-4 text-[12px] leading-5 text-[var(--quiet)]">
          Nothing in the catalog changes until a reviewer accepts the report.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="surface p-6 sm:p-8" noValidate>
      <p className="eyebrow mb-2">Correction</p>
      <h2 className="font-display text-[24px] tracking-[-.025em]">Report a wrong value</h2>
      <p className="mt-2 text-[13px] leading-5 text-[var(--muted)]">
        {modelName} · <span className="font-mono text-[12px]">{skuCode}</span>
      </p>

      {state.status === "error" && (
        <div
          className="mt-5 rounded-[5px] border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-[13px] leading-5 text-[var(--danger)]"
          role="alert"
        >
          {state.message}
        </div>
      )}

      <div className="mt-6">
        <label htmlFor="field" className="label">
          Which field is wrong?
        </label>
        <select
          id="field"
          name="field"
          className="field"
          value={field}
          required
          onChange={(event) => {
            setField(event.target.value);
            setValue("");
          }}
        >
          <option value="">Choose a field…</option>
          {fields.map((item) => (
            <option key={item.column} value={item.column}>
              {item.label}
              {item.currentValue !== null ? ` — currently ${item.currentValue}` : " — not reported"}
            </option>
          ))}
        </select>
        {selected?.hint && (
          <p className="mt-1.5 text-[11px] leading-5 text-[var(--quiet)]">{selected.hint}</p>
        )}
      </div>

      <div className="mt-5">
        <label htmlFor="new_value" className="label">
          The value it should have
        </label>
        {selected?.kind === "boolean" ? (
          <select
            id="new_value"
            name="new_value"
            className="field"
            value={value}
            required
            onChange={(event) => setValue(event.target.value)}
          >
            <option value="">Choose…</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        ) : (
          <input
            id="new_value"
            name="new_value"
            className="field"
            type={selected?.kind === "number" ? "number" : "text"}
            step="any"
            value={value}
            required
            disabled={!selected}
            onChange={(event) => setValue(event.target.value)}
            placeholder={selected ? "The correct value" : "Pick a field first"}
          />
        )}
        {selected && (
          <p className="mt-1.5 text-[11px] leading-5 text-[var(--quiet)]">
            The catalog currently says{" "}
            <span className="font-medium text-[var(--muted)]">
              {selected.currentValue ?? "not reported"}
            </span>
            .
          </p>
        )}
      </div>

      <fieldset className="mt-6 border-t border-[var(--line)] pt-5">
        <legend className="label">Your evidence</legend>
        <p className="mb-4 text-[12px] leading-5 text-[var(--muted)]">
          A correction without a source is still filed, but it is recorded as unevidenced and a
          reviewer will ask you for a source before it can be applied.
        </p>

        <div>
          <label htmlFor="evidence_url" className="label">
            Where did you see it? <span className="font-normal normal-case">(a link, if you have one)</span>
          </label>
          <input
            id="evidence_url"
            name="evidence_url"
            className="field"
            type="url"
            inputMode="url"
            autoComplete="url"
            value={evidenceUrl}
            onChange={(event) => setEvidenceUrl(event.target.value)}
            placeholder="https://example.com/specifications"
          />
        </div>

        <div className="mt-5">
          <label htmlFor="evidence_text" className="label">
            Note for the reviewer <span className="font-normal normal-case">(optional)</span>
          </label>
          <textarea
            id="evidence_text"
            name="evidence_text"
            className="field"
            rows={4}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Anything that helps the reviewer check this — which part number, which page, what the source actually says."
          />
        </div>
      </fieldset>

      <fieldset className="mt-6 border-t border-[var(--line)] pt-5">
        <legend className="label">Who you are</legend>
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="name" className="label">
              Name <span className="font-normal normal-case">(optional, shown with the correction)</span>
            </label>
            <input
              id="name"
              name="name"
              className="field"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor="email" className="label">
              Email <span className="font-normal normal-case">(required, never shown publicly)</span>
            </label>
            <input
              id="email"
              name="email"
              className="field"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-[var(--quiet)]">
          The email is used to record the report and to let you vote on other reports. It is never
          published.
        </p>
      </fieldset>

      <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center">
        <button type="submit" className="btn-primary" disabled={state.status === "submitting" || !field}>
          {state.status === "submitting" ? "Filing…" : "File the report"}
        </button>
        <p className="text-[11px] leading-5 text-[var(--quiet)]">
          Filing a report does not change the catalog. A reviewer decides.
        </p>
      </div>
    </form>
  );
}
