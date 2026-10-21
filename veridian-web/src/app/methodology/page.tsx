import Link from "next/link";
import { prisma } from "@/lib/db";

export const metadata = {
  title: "How the catalog works | Veridian",
  description: "Where Veridian's laptop data comes from, how it is verified, and what its limits are.",
};

export const dynamic = "force-dynamic";

export default async function MethodologyPage() {
  const [
    certifiedTotal,
    manufacturerTotal,
    unverifiedTotal,
    certifiedSpecTotal,
    sourceRows,
    rejectedRows,
    componentTotal,
    linkTotal,
    regionRows,
  ] = await Promise.all([
    prisma.sku.count({ where: { catalogVisible: true, provenance: "certified" } }),
    prisma.sku.count({ where: { catalogVisible: true, provenance: "manufacturer" } }),
    prisma.sku.count({ where: { catalogVisible: true, provenance: "unverified" } }),
    prisma.certifiedSkuSpec.count(),
    prisma.rawObservation.count(),
    prisma.rawObservation.count({ where: { status: "rejected" } }),
    prisma.component.count(),
    prisma.skuComponent.count(),
    prisma.skuRegionalPricing.findMany({
      distinct: ["region"],
      select: { region: true },
      orderBy: { region: "asc" },
    }),
  ]);

  const regions = regionRows.map((r) => r.region);

  return (
    <div className="container py-12 sm:py-16">
      <div className="max-w-3xl">
        <p className="eyebrow mb-3">About the data</p>
        <h1 className="font-display text-[clamp(38px,5vw,58px)] leading-[1] tracking-[-.045em] text-balance">How this catalog works</h1>
        <p className="mt-6 text-[16px] leading-7 text-[var(--muted)]">
          Veridian collects laptop specifications into one structured catalog so you can filter on
          the details that matter — RAM, weight, display, battery, price — without hopping between
          manufacturer sites. This page explains where the numbers come from — and, just as
          importantly, where they don&rsquo;t.
        </p>
      </div>

      <div className="mt-10 grid max-w-3xl grid-cols-2 gap-6 border-y border-[var(--line)] py-6 sm:grid-cols-4">
        <Figure value={certifiedTotal.toLocaleString()} label="certified configurations" />
        <Figure value={(manufacturerTotal + unverifiedTotal).toLocaleString()} label="reference configurations" />
        <Figure value={sourceRows.toLocaleString()} label="raw source observations" />
        <Figure value={componentTotal.toLocaleString()} label="shared components" />
      </div>

      <div className="mt-12 space-y-3">
        <Section n="01" title="Three tiers of data, and they are not the same">
          <p>
            The catalog mixes three clearly separated kinds of record, and every listing is labelled
            with which one it is:
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="font-semibold">Certified</strong> — {certifiedTotal.toLocaleString()}{" "}
              configurations that carry a cited certification record with a verifiable source link, a
              certification date, and a stored hash of the original payload. These are marked{" "}
              <span className="font-mono text-[11px]">Certified</span> in the catalog.
            </li>
            <li>
              <strong className="font-semibold">Manufacturer</strong> —{" "}
              {manufacturerTotal.toLocaleString()} configurations whose figures were checked
              against the manufacturer&rsquo;s own technical specification page, which is cited on
              the configuration page. These are marked{" "}
              <span className="font-mono text-[11px]">Manufacturer</span>.
            </li>
            <li>
              <strong className="font-semibold">Unverified</strong> —{" "}
              {unverifiedTotal.toLocaleString()} configurations from our own reference dataset.
              They have no citation and have <em className="italic">not</em> been checked against
              the manufacturer. They are marked{" "}
              <span className="font-mono text-[11px]">Unverified</span>, and their pages say so in
              plain words.
            </li>
          </ul>
          <p>
            The unverified tier exists so the product can be developed and demonstrated against a
            realistic dataset. It is not a claim that each row was transcribed from a manufacturer
            page, and it should not be read as one. Where a figure can be checked, it is checked
            and the row moves up a tier.
          </p>
        </Section>

        <Section n="02" title="Where the certified data comes from">
          <p>
            The certified tier is ingested from the{" "}
            <strong className="font-semibold">US EPA ENERGY STAR Certified Computers V9.0</strong>{" "}
            dataset, published through the US government&rsquo;s open-data portal. It is a public
            domain source published under the Open Government Data Initiative. Each record is
            validated field by field before it is allowed into the catalog, and the verbatim
            payload is stored alongside a SHA-256 hash so the normalized figures can always be
            traced back to what was actually published.
          </p>
          <p>
            {certifiedSpecTotal.toLocaleString()} certification records are currently stored,
            written by an audited path that records every accepted and every rejected source row.
            {rejectedRows.toLocaleString()} source rows failed validation and were kept with their
            exact error rather than being dropped, so a bad figure can never quietly become a
            catalog fact.
          </p>
          <p>
            One certification record is not one configuration. The same machine is certified again
            when it is re-tested, and one product line can be certified in several configurations.
            Veridian therefore keys a configuration on the part number plus a signature of the
            specifications the source asserts, so re-certifications collapse onto one entry and
            genuinely different configurations stay apart.
          </p>
        </Section>

        <Section n="03" title="What &ldquo;Not reported&rdquo; means">
          <p>
            A field shown as &ldquo;—&rdquo; or &ldquo;Not reported&rdquo; is genuinely absent from
            our sources. We deliberately do <em className="italic">not</em> guess, extrapolate, or
            backfill missing values. An honest gap beats an invented number — this is the single
            most important rule here, and it applies to prices as much as to specifications.
          </p>
        </Section>

        <Section n="04" title="Prices">
          <p>
            The prices shown are manufacturer suggested prices recorded per region on our last
            update, and they come from the reference tier — they are not live marketplace prices
            and they will drift. Use them to compare configurations against each other, not to
            budget for a purchase. A configuration with no price recorded for your selected region
            is shown as <span className="font-mono text-[11px]">price not reported</span> rather
            than being hidden or given an invented number.
          </p>
          <p>
            Price regions currently available:{" "}
            <span className="font-mono text-[11px]">{regions.join(", ") || "none"}</span>. Choosing a
            region changes which currency is displayed; it never changes which configurations are
            eligible to appear in the results.
          </p>
          <p>
            Live retailer pricing is the largest piece of work still outstanding. The schema,
            identity resolution and append-only history are in place for it, but no retailer feed is
            connected yet, so no price in the system should be read as a street price.
          </p>
        </Section>

        <Section n="05" title="Components, not just rows">
          <p>
            Every certified configuration is also broken down into the components it is built
            around — the processor, the display class, the storage technology. {componentTotal.toLocaleString()}{" "}
            components are shared across {linkTotal.toLocaleString()} configuration links, so you can
            follow a processor across the whole catalog and see every machine built around it.{" "}
            <Link href="/components" className="text-[var(--accent-dark)] underline underline-offset-4">
              Browse the component graph
            </Link>
            .
          </p>
        </Section>

        <Section n="06" title="What is not tracked yet">
          <ul className="list-disc space-y-2 pl-5">
            <li>Live retailer price tracking, price history, or alerts — still on the roadmap.</li>
            <li>
              Every model ever made. The catalog covers what our sources certify, which is
              weighted towards current business and education machines, and may simply not cover a
              machine you own.
            </li>
            <li>
              Independent benchmark results. Our figures are sourced specifications, not measured
              performance.
            </li>
            <li>
              Marketing names for every product. Where a manufacturer certifies an internal chassis
              code, we look for the marketing name in the same source record; where there is none,
              the code is shown and the part number is kept.
            </li>
          </ul>
        </Section>

        <Section n="07" title="Verification expectations">
          <p>
            Manufacturer-classified values can sometimes differ from a real unit in the field — a
            different RAM config, a regional variation, a revision. Treat any field as &ldquo;reported
            specification&rdquo;, not a guarantee, and confirm the exact SKU code with the official
            product page before a purchase. Even the certified tier reproduces what the
            certification asserted; it does not independently re-measure the hardware.
          </p>
        </Section>
      </div>

      <div className="surface mt-12 p-6">
        <p className="eyebrow mb-2">Still curious?</p>
        <p className="text-[13px] leading-6 text-[var(--muted)]">
          The full product specification lives in the repository&rsquo;s{" "}
          <span className="font-mono text-[var(--ink)]">Veridian-spec.md</span>, and the roadmap in{" "}
          <span className="font-mono text-[var(--ink)]">ROADMAP.md</span>. Find a mistake? The
          catalog is open for contribution.
        </p>
        <Link href="/" className="btn-secondary mt-5">Return to the catalog</Link>
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

function Section({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <section className="surface-soft p-6 sm:p-8">
      <div className="flex items-start gap-5">
        <span className="font-mono text-[12px] font-semibold text-[var(--accent)]">{n}</span>
        <div className="max-w-2xl">
          <h2 className="font-display text-[22px] tracking-[-.02em]">{title}</h2>
          <div className="mt-3 space-y-3 text-[14px] leading-7 text-[var(--muted)]">{children}</div>
        </div>
      </div>
    </section>
  );
}
