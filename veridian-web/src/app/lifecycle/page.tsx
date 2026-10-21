import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { deriveLifecycle, type LifecycleModelInput } from "@/lib/lifecycle";
import { formatDate, plural } from "@/lib/format";

export const metadata: Metadata = {
  title: "Product lifecycle | Veridian",
  description:
    "The product families in the Veridian catalog and the generations inside them, ordered by the dates their certifications were issued.",
  alternates: { canonical: "/lifecycle" },
};

export const dynamic = "force-dynamic";

const AMBIGUITY_LABELS: Record<string, string> = {
  "missing-launch-date": "a date available on the market is missing",
  "launch-date-contradiction": "the dates disagree with the generation markers",
  "incomparable-markers": "two different kinds of generation marker in one line",
  "date-only-order": "only the certification dates order these models",
};

export default async function LifecyclePage() {
  const rows = await prisma.model.findMany({
    include: { series: { include: { manufacturer: true } } },
  });

  const models: LifecycleModelInput[] = rows.map((row) => ({
    id: row.id,
    name: row.name,
    seriesId: row.seriesId,
    seriesName: row.series.name,
    manufacturerName: row.series.manufacturer.name,
    launchDate: row.launchDate,
  }));

  const derivation = deriveLifecycle(models);

  const familiesWithChains = derivation.families.filter((family) => family.chains.length > 0);
  const familiesWithoutChains = derivation.families.filter(
    (family) => family.chains.length === 0 && family.modelCount > 1
  );
  const generationsCovered = derivation.families.reduce(
    (total, family) =>
      total + family.chains.reduce((sum, chain) => sum + chain.generations.length, 0),
    0
  );

  const ambiguityCounts = new Map<string, number>();
  for (const ambiguity of derivation.ambiguities) {
    ambiguityCounts.set(ambiguity.kind, (ambiguityCounts.get(ambiguity.kind) ?? 0) + 1);
  }

  const examples = [
    ...derivation.ambiguities.filter((ambiguity) => ambiguity.kind !== "date-only-order"),
    ...derivation.ambiguities.filter((ambiguity) => ambiguity.kind === "date-only-order"),
  ].slice(0, 6);

  // The pairs that were actually asserted, so the page never draws a link
  // the derivation refused to make.
  const asserted = new Set(derivation.links.map((link) => `${link.predecessorId}>${link.successorId}`));

  return (
    <div className="container py-10 sm:py-14">
      <header className="mb-10 max-w-3xl">
        <p className="eyebrow mb-3">Product lifecycle</p>
        <h1 className="font-display text-[clamp(32px,5vw,56px)] leading-[1.02] tracking-[-.04em] text-balance">
          How a product line evolves.
        </h1>
        <p className="mt-5 max-w-2xl text-[15px] leading-7 text-[var(--muted)]">
          Every laptop family in the catalog has a history: a first generation, then a successor, then
          the one after that. The catalog knows which models belong to the same family, and it knows the
          date every certified configuration reached the market. This page lines the generations up in
          that order.
        </p>
        <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[var(--muted)]">
          <strong className="font-semibold text-[var(--ink)]">These relationships are derived, not
          published.</strong> No manufacturer told us that one model succeeds another. Veridian reads the
          generation marker in the model name and checks it against the certification date, and it
          reports a link only when both agree. Where they do not, the case is listed as ambiguous
          instead of being written into the catalog.
        </p>
      </header>

      <div className="mb-12 grid grid-cols-2 gap-6 border-y border-[var(--line)] py-6 sm:grid-cols-4">
        <Figure value={derivation.seriesExamined.toLocaleString()} label="families examined" />
        <Figure value={derivation.links.length.toLocaleString()} label="links derived" />
        <Figure value={familiesWithChains.length.toLocaleString()} label="families with a lineage" />
        <Figure value={derivation.ambiguities.length.toLocaleString()} label="cases left ambiguous" />
      </div>

      <section className="mb-12 max-w-3xl">
        <h2 className="label">How a link is derived</h2>
        <ol className="space-y-3 text-[14px] leading-7 text-[var(--muted)]">
          <li>
            <strong className="font-semibold text-[var(--ink)]">A name that names a generation.</strong>{" "}
            &ldquo;Gen 8&rdquo;, &ldquo;8th Edition&rdquo;, &ldquo;2nd Gen&rdquo;, &ldquo;G11&rdquo;,{" "}
            &ldquo;(M4)&rdquo; and a plain year are all read as generation markers. Two models of one
            family whose names are otherwise identical, and whose markers differ, are two generations of
            the same line.
          </li>
          <li>
            <strong className="font-semibold text-[var(--ink)]">A date that confirms the order.</strong>{" "}
            The later generation must also have reached the market later. The date available on the
            market is the independent witness; without it, no link is written.
          </li>
          <li>
            <strong className="font-semibold text-[var(--ink)]">Nothing asserted on a hunch.</strong>{" "}
            Two models carrying the same marker are two configurations of one generation, not a
            successor pair. A missing date is not evidence in either direction, and a date that
            contradicts the markers is reported, not resolved.
          </li>
          <li>
            <strong className="font-semibold text-[var(--ink)]">A date on its own stays weak.</strong>{" "}
            Where no name carries a marker, the certification dates still order the models, but that is
            reported as a weaker signal and never written as a lineage.
          </li>
        </ol>
        <p className="mt-4 text-[13px] leading-6 text-[var(--quiet)]">
          The same derivation runs as a script over the whole catalog and writes the answer into each
          model&rsquo;s successor and predecessor fields, so the numbers on this page and the numbers in
          the database cannot drift apart.
        </p>
      </section>

      <section className="mb-14">
        <h2 className="label mb-4">
          Families with a readable lineage
          <span className="ml-2 font-mono text-[11px] text-[var(--quiet)]">
            {familiesWithChains.length} families &middot; {generationsCovered} generations
          </span>
        </h2>
        <ul className="space-y-3">
          {familiesWithChains.map((family) => {
            const familyLinks = derivation.links.filter((link) => link.seriesId === family.seriesId);
            return (
              <li key={family.seriesId} className="surface p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h3 className="text-[15px] font-semibold text-[var(--ink)]">
                    {family.manufacturerName} <span className="text-[var(--muted)]">{family.seriesName}</span>
                  </h3>
                  <p className="font-mono text-[11px] tabular-nums text-[var(--quiet)]">
                    {plural(familyLinks.length, "derived link")}
                  </p>
                </div>

                {family.chains.map((chain) => (
                  <div key={`${chain.lineName}-${chain.markerKind}`} className="mt-3">
                    {chain.lineName !== family.seriesName && (
                      <p className="text-[12px] text-[var(--quiet)]">{chain.lineName}</p>
                    )}
                    <ol className="mt-2 flex flex-wrap items-stretch gap-2">
                      {chain.generations.map((generation, index) => {
                        const previous = chain.generations[index - 1];
                        const isLinked =
                          previous !== undefined && asserted.has(`${previous.modelId}>${generation.modelId}`);
                        return (
                          <li key={generation.modelId} className="flex items-center gap-2">
                            {index > 0 && (
                              <span
                                aria-hidden="true"
                                className={`font-mono text-[12px] ${
                                  isLinked ? "text-[var(--accent)]" : "text-[var(--line-strong)]"
                                }`}
                                title={isLinked ? "derived link" : "no link asserted"}
                              >
                                {isLinked ? "\u2192" : "\u00b7"}
                              </span>
                            )}
                            <span className="surface-soft px-3 py-1.5">
                              <span className="block text-[13px] font-medium text-[var(--ink)]">
                                {generation.markerText}
                              </span>
                              <span className="block font-mono text-[11px] tabular-nums text-[var(--muted)]">
                                {formatDate(generation.launchDate)}
                              </span>
                            </span>
                          </li>
                        );
                      })}
                    </ol>
                    {chain.generations.some(
                      (generation, index) =>
                        index > 0 &&
                        !asserted.has(`${chain.generations[index - 1].modelId}>${generation.modelId}`)
                    ) && (
                      <p className="mt-2 text-[12px] leading-5 text-[var(--quiet)]">
                        A gap marked &ldquo;&middot;&rdquo; is a pair the derivation did not assert: the
                        evidence was missing or the dates disagreed with the markers.
                      </p>
                    )}
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mb-14 max-w-3xl">
        <h2 className="label mb-4">
          What could not be asserted
          <span className="ml-2 font-mono text-[11px] text-[var(--quiet)]">
            {derivation.ambiguities.length}
          </span>
        </h2>
        <p className="mb-4 text-[14px] leading-7 text-[var(--muted)]">
          A catalog that only shows the cases it could prove is easy to misread as a catalog where
          nothing else exists. These are the candidate relationships Veridian found and deliberately did
          not write.
        </p>
        <ul className="mb-5 space-y-1">
          {[...ambiguityCounts.entries()].map(([kind, count]) => (
            <li key={kind} className="flex items-baseline justify-between gap-4 border-b border-[var(--line)] py-2">
              <span className="text-[13px] text-[var(--muted)]">
                {AMBIGUITY_LABELS[kind] ?? kind}
              </span>
              <span className="font-mono text-[12px] tabular-nums text-[var(--quiet)]">{count}</span>
            </li>
          ))}
        </ul>
        <ul className="space-y-2">
          {examples.map((ambiguity, index) => (
            <li key={`${ambiguity.kind}-${index}`} className="surface-soft px-4 py-3">
              <p className="text-[12px] text-[var(--quiet)]">
                {ambiguity.manufacturerName} &middot; {ambiguity.seriesName}
              </p>
              <p className="mt-1 text-[13px] text-[var(--ink)]">
                {ambiguity.fromModel ? (
                  <>
                    <span className="font-mono text-[12px]">{ambiguity.fromModel.name}</span>
                    {ambiguity.fromModel.launchDate && (
                      <span className="text-[var(--quiet)]"> ({formatDate(ambiguity.fromModel.launchDate)})</span>
                    )}
                  </>
                ) : (
                  <span className="text-[var(--muted)]">Two models</span>
                )}
                <span className="px-2 text-[var(--quiet)]">&rarr;</span>
                {ambiguity.toModel ? (
                  <span className="font-mono text-[12px]">{ambiguity.toModel.name}</span>
                ) : (
                  <span className="text-[var(--muted)]">one model</span>
                )}
              </p>
              <p className="mt-1 text-[12px] leading-5 text-[var(--muted)]">{ambiguity.reason}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mb-12 max-w-3xl">
        <h2 className="label mb-4">Families without a readable lineage</h2>
        <p className="text-[14px] leading-7 text-[var(--muted)]">
          {familiesWithoutChains.length.toLocaleString()} other families hold more than one model, but
          their names carry no generation marker and their certification dates do not line up into a
          chain. They are left as they are: a family is a family, and pretending to know its order
          would be a guess.
        </p>
      </section>

      <div className="surface max-w-3xl p-6">
        <p className="eyebrow mb-2">Read this carefully</p>
        <p className="text-[13px] leading-6 text-[var(--muted)]">
          A lineage here is an inference from two public facts: the generation marker a manufacturer
          wrote into a product name, and the date a certification was issued. It is not a manufacturer
          statement, and it is not a guarantee that one model replaced the other in every market.
          Treat it as a well-evidenced reading of the catalog, and check the manufacturer&rsquo;s own
          documentation before making a purchase.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link href="/methodology" className="btn-secondary">
            How the catalog works
          </Link>
          <Link href="/" className="btn-quiet">
            Back to the catalog
          </Link>
        </div>
      </div>
    </div>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="font-mono text-[19px] font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-[var(--muted)]">{label}</p>
    </div>
  );
}
