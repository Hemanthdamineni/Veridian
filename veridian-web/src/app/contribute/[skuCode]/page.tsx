import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import {
  CORRECTABLE_FIELDS,
  contributorLabel,
  currentValueOf,
  findCorrectableField,
  voteTallies,
} from "@/lib/contributions";
import { ContributeForm } from "@/components/ContributeForm";
import type { ContributeFormField } from "@/components/ContributeForm";

export const dynamic = "force-dynamic";

interface SkuCorrectionPageProps {
  params: Promise<{ skuCode: string }>;
  searchParams: Promise<{ field?: string }>;
}

export async function generateMetadata({
  params,
}: SkuCorrectionPageProps): Promise<Metadata> {
  const { skuCode } = await params;
  const sku = await prisma.sku.findUnique({
    where: { skuCode },
    select: { model: { select: { name: true } } },
  });
  if (!sku) return { title: "Configuration not found | Veridian" };
  return {
    title: `Report an error — ${sku.model.name} | Veridian`,
    description: `Report a wrong specification for ${sku.model.name} (${skuCode}), with the source that shows the correct value.`,
  };
}

/**
 * The correction page for one configuration.
 *
 * The form is pre-filled with the configuration and shows what the catalog
 * currently says, so the reader is correcting a specific value rather than
 * describing a machine in the abstract. The reports already filed for this
 * configuration are listed underneath, with the state each one is in.
 */
export default async function SkuCorrectionPage({
  params,
  searchParams,
}: SkuCorrectionPageProps) {
  const { skuCode } = await params;
  const { field } = await searchParams;

  const sku = await prisma.sku.findUnique({
    where: { skuCode },
    include: {
      model: { include: { series: { include: { manufacturer: true } } } },
    },
  });
  if (!sku) notFound();

  const row = sku as unknown as Record<string, unknown>;
  const fields: ContributeFormField[] = CORRECTABLE_FIELDS.map((item) => ({
    column: item.column,
    label: item.label,
    kind: item.kind,
    hint: item.hint,
    currentValue: currentValueOf(row, item.column),
  }));

  const contributions = await prisma.contribution.findMany({
    where: { skuId: sku.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { user: { select: { name: true } } },
  });
  const tallies = await voteTallies(
    prisma,
    contributions.map((contribution) => contribution.id)
  );

  const modelName = `${sku.model.series.manufacturer.name} ${sku.model.name}`;

  return (
    <div className="container py-10 sm:py-14">
      <nav aria-label="Breadcrumb" className="mb-8 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--muted)]">
        <Link href="/" className="hover:text-[var(--ink)]">Catalog</Link>
        <span aria-hidden="true" className="text-[var(--quiet)]">/</span>
        <Link href="/contribute" className="hover:text-[var(--ink)]">Corrections</Link>
        <span aria-hidden="true" className="text-[var(--quiet)]">/</span>
        <span className="text-[var(--ink)]">{sku.skuCode}</span>
      </nav>

      <header className="mb-10 max-w-3xl">
        <p className="eyebrow mb-2">Report an error</p>
        <h1 className="font-display text-[clamp(30px,4vw,44px)] leading-[1.05] tracking-[-.04em] text-balance">
          {modelName}
        </h1>
        <p className="mt-3 font-mono text-[12px] text-[var(--quiet)]">{sku.skuCode}</p>
        <p className="mt-4 max-w-xl text-[15px] leading-7 text-[var(--muted)]">
          One field, one value, one source. Tell us which specification of this configuration is
          wrong and where you saw the right one. Nothing in the catalog changes until a reviewer
          accepts your report.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <ContributeForm
            skuCode={sku.skuCode}
            modelName={modelName}
            fields={fields}
            defaultField={field}
          />

          <section className="surface p-6 sm:p-8">
            <h2 className="label mb-4">What the catalog says</h2>
            <dl className="divide-y divide-[var(--line)]">
              {fields.map((item) => (
                <div
                  key={item.column}
                  className="flex items-baseline justify-between gap-4 py-2.5"
                >
                  <dt className="text-[13px] text-[var(--muted)]">{item.label}</dt>
                  <dd className="text-right text-[13px] font-medium">
                    {item.currentValue ?? <span className="text-[var(--quiet)]">not reported</span>}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-4 border-t border-[var(--line)] pt-4 text-[11px] leading-5 text-[var(--quiet)]">
              Values that are not reported stay visible as unreported. We do not fill a gap with a
              guess.
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="surface p-6 sm:p-8">
            <h2 className="label mb-4">Reports on this configuration</h2>
            {contributions.length === 0 ? (
              <p className="text-[13px] leading-6 text-[var(--muted)]">
                No one has reported a problem with this configuration yet.
              </p>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {contributions.map((contribution) => {
                  const contributionField = contribution.field
                    ? findCorrectableField(contribution.field)
                    : undefined;
                  const tally = tallies[contribution.id];
                  return (
                    <li key={contribution.id} className="py-3.5 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-[13px] font-medium text-[var(--ink)]">
                          {contributionField?.label ?? contribution.field}
                        </p>
                        <StatusPill status={contribution.status} />
                      </div>
                      <p className="mt-1 text-[12px] text-[var(--muted)]">
                        Claimed{" "}
                        <span className="font-medium text-[var(--ink)]">
                          {contribution.newValue}
                        </span>
                        {contribution.oldValue && (
                          <>
                            {" "}
                            · was{" "}
                            <span className="font-mono text-[11px]">{contribution.oldValue}</span>
                          </>
                        )}
                      </p>
                      <p className="mt-1 text-[11px] text-[var(--quiet)]">
                        {contributorLabel(contribution.user.name)} ·{" "}
                        {contribution.evidenceUrl ? "source cited" : "no source cited"} ·{" "}
                        {tally.total === 0
                          ? "no votes"
                          : `${tally.confirmed} confirmed, ${tally.disputed} disputed`}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-4 border-t border-[var(--line)] pt-4 text-[11px] leading-5 text-[var(--quiet)]">
              A report on this list is not a change to the catalog. Only an accepted one is.
            </p>
          </section>

          <section className="surface-soft p-6 sm:p-8">
            <h2 className="label mb-4">Why we ask for the source</h2>
            <p className="text-[13px] leading-6 text-[var(--muted)]">
              A correction is a claim like any other, and it needs the same thing every other claim
              in this catalog has: somewhere to check it. The source you cite is recorded next to
              the corrected value, so the next reader can see where the number came from — and so
              that a later correction can supersede it the same way.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: "Waiting for review",
  approved: "Applied",
  rejected: "Rejected",
  needs_evidence: "Needs a source",
};

function StatusPill({ status }: { status: string }) {
  const tone =
    status === "approved"
      ? "bg-[var(--success-soft)] text-[var(--success)]"
      : status === "rejected"
        ? "bg-[var(--danger-soft)] text-[var(--danger)]"
        : status === "needs_evidence"
          ? "bg-[var(--warning-soft)] text-[var(--warning)]"
          : "bg-[var(--accent-soft)] text-[var(--accent-dark)]";
  return (
    <span className={`rounded-[5px] px-2 py-0.5 text-[10px] font-semibold ${tone}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}
