import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Report a correction | Veridian",
  description:
    "How Veridian's correction system works: report a wrong specification, cite the source, and a reviewer decides. Nothing changes in the catalog until it is accepted.",
};

/**
 * What the correction system is for, and how it works.
 *
 * The catalog is a set of claims. A claim can be wrong, and the only honest
 * way to fix a wrong claim is to show where the right one comes from. This
 * page explains that loop; the form that starts it lives on the page of the
 * configuration you want to correct.
 */
export default async function ContributePage({
  searchParams,
}: {
  searchParams: Promise<{ sku?: string }>;
}) {
  const { sku } = await searchParams;
  const code = (sku ?? "").trim();

  let lookup: { found: boolean; label: string | null };
  if (!code) {
    lookup = { found: false, label: null };
  } else {
    const row = await prisma.sku.findUnique({
      where: { skuCode: code },
      select: {
        skuCode: true,
        model: {
          select: {
            name: true,
            series: { select: { name: true, manufacturer: { select: { name: true } } } },
          },
        },
      },
    });
    lookup = row
      ? {
          found: true,
          label: `${row.model.series.manufacturer.name} ${row.model.name} (${row.skuCode})`,
        }
      : { found: false, label: null };
  }

  return (
    <div className="container py-10 sm:py-14">
      <nav aria-label="Breadcrumb" className="mb-8 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--muted)]">
        <Link href="/" className="hover:text-[var(--ink)]">Catalog</Link>
        <span aria-hidden="true" className="text-[var(--quiet)]">/</span>
        <span className="text-[var(--ink)]">Corrections</span>
      </nav>

      <header className="mb-10 max-w-3xl">
        <p className="eyebrow mb-2">Community corrections</p>
        <h1 className="font-display text-[clamp(32px,4.5vw,48px)] leading-[1.05] tracking-[-.04em] text-balance">
          Found a wrong specification? Report it with the source.
        </h1>
        <p className="mt-4 text-[15px] leading-7 text-[var(--muted)]">
          Every specification in this catalog is a claim about a machine. Some of them are wrong, and
          the fastest way to a correct catalog is for the people who read the sources to say so.
          A report names the field you believe is wrong, the value that should be there instead,
          and where you saw it.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <section className="surface p-6 sm:p-8">
            <h2 className="font-display text-[22px] tracking-[-.025em]">How it works</h2>
            <ol className="mt-5 space-y-5">
              <Step number="1" title="You report one field">
                Open the configuration, press <em>Report an error</em>, and fill in the field, the
                value you believe is correct, and the link to the page you checked. A note is
                optional.
              </Step>
              <Step number="2" title="Nothing in the catalog changes">
                Your report is stored as a report. It is not applied, and it cannot be, by the act
                of filing it. A submission never edits a specification on its own.
              </Step>
              <Step number="3" title="A reviewer checks it">
                A reviewer sees the field, the value you claim, the value the catalog holds, your
                evidence and who sent it. They accept the report, reject it, or ask you for a
                source that settles the question.
              </Step>
              <Step number="4" title="An accepted report is added, not swapped in">
                The corrected value is written, the source you cited is recorded as a source of
                that field, and the value the field held before is kept in the record. The history
                stays visible — a correction adds a source, it does not erase one.
              </Step>
              <Step number="5" title="Other readers vote">
                Anyone can vote on a report: confirmed, disputed, or needs more verification. A
                vote never changes a specification; it tells the reviewer what other people think.
              </Step>
            </ol>
          </section>

          <section className="surface p-6 sm:p-8">
            <h2 className="font-display text-[22px] tracking-[-.025em]">What a report has to carry</h2>
            <ul className="mt-5 space-y-3 text-[14px] leading-6 text-[var(--muted)]">
              <li className="flex gap-3">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                <span>
                  <strong className="font-semibold text-[var(--ink)]">The field.</strong> Which
                  specification of the configuration you are contesting.
                </span>
              </li>
              <li className="flex gap-3">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                <span>
                  <strong className="font-semibold text-[var(--ink)]">The value.</strong> What it
                  should say. A value we cannot store exactly is refused rather than rounded.
                </span>
              </li>
              <li className="flex gap-3">
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" />
                <span>
                  <strong className="font-semibold text-[var(--ink)]">The source.</strong> Where
                  you saw it. This is the part that makes a report useful.
                </span>
              </li>
            </ul>
            <p className="mt-5 border-t border-[var(--line)] pt-4 text-[13px] leading-6 text-[var(--muted)]">
              A report without a source is still allowed and is still filed — but it is recorded
              as <strong className="font-semibold text-[var(--warning)]">unevidenced</strong>, and
              the reviewer sees that label on it. We would rather record a weak claim honestly than
              dress it up.
            </p>
          </section>

          <section className="surface p-6 sm:p-8">
            <h2 className="font-display text-[22px] tracking-[-.025em]">What a correction does not do</h2>
            <p className="mt-4 text-[14px] leading-6 text-[var(--muted)]">
              A community correction is a fourth kind of evidence, alongside the certification
              records, the manufacturer&rsquo;s own specification pages and the retailer listings we
              cite. It is not one of them, and it does not promote a row into one of them. A
              configuration whose specification was corrected by a reader is not thereby certified,
              and it is not thereby manufacturer-verified. The correction is recorded as its own
              source, next to the source it replaces, and the row keeps the provenance it had.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="surface p-6 sm:p-8">
            <h2 className="label mb-4">Report a configuration</h2>
            <p className="mb-4 text-[13px] leading-5 text-[var(--muted)]">
              Find the configuration by its code, then open its correction page.
            </p>
            <form method="get" action="/contribute" className="space-y-3">
              <label htmlFor="sku" className="label">
                Configuration code
              </label>
              <input
                id="sku"
                name="sku"
                className="field"
                type="text"
                defaultValue={code}
                placeholder="For example: IDEAPAD-VIBE-15AKP12-1a2b3c4d"
                required
              />
              <button type="submit" className="btn-primary w-full">
                Find the configuration
              </button>
            </form>

            {code && (
              <div
                className={`mt-4 rounded-[5px] border p-3 text-[13px] leading-5 ${
                  lookup.found
                    ? "border-[var(--line)] bg-[var(--surface-soft)] text-[var(--muted)]"
                    : "border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]"
                }`}
                role="status"
              >
                {lookup.found ? (
                  <>
                    <p className="text-[var(--ink)]">{lookup.label}</p>
                    <Link
                      href={`/contribute/${encodeURIComponent(code)}`}
                      className="mt-2 inline-block text-[var(--accent-dark)] underline underline-offset-4"
                    >
                      Open the correction form ↗
                    </Link>
                  </>
                ) : (
                  <p>
                    No configuration with the code <span className="font-mono">{code}</span>. Check
                    the code on the configuration&rsquo;s page in the{" "}
                    <Link href="/" className="underline underline-offset-4">
                      catalog
                    </Link>
                    .
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="surface p-6 sm:p-8">
            <h2 className="label mb-4">Who reviews the reports</h2>
            <p className="text-[13px] leading-6 text-[var(--muted)]">
              A reviewer reads the report against its evidence and the configuration&rsquo;s other
              sources, and decides. They can accept the report, reject it, or ask the reader for
              more evidence. Nothing is applied automatically, and no report is ever applied without
              a decision.
            </p>
            <p className="mt-4 text-[13px] leading-6 text-[var(--muted)]">
              A reviewer&rsquo;s decision, the report and its evidence stay on the record, including
              when the decision was to reject it.
            </p>
          </section>

          <section className="surface-soft p-6 sm:p-8">
            <h2 className="label mb-4">Where the rules come from</h2>
            <p className="text-[13px] leading-6 text-[var(--muted)]">
              The catalog keeps every value it has ever published next to the source that published
              it. See{" "}
              <Link href="/methodology" className="text-[var(--accent-dark)] underline underline-offset-4">
                how this catalog works
              </Link>{" "}
              for the provenance model behind it.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

function Step({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--line-strong)] font-mono text-[11px] text-[var(--muted)]"
      >
        {number}
      </span>
      <div>
        <p className="text-[14px] font-semibold text-[var(--ink)]">{title}</p>
        <p className="mt-1 text-[13px] leading-6 text-[var(--muted)]">{children}</p>
      </div>
    </li>
  );
}
