import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatPrice } from "@/lib/format";
import { PROVENANCE_LABELS, type SkuProvenance } from "@/types";

interface ComponentPageProps {
  params: Promise<{ slug: string }>;
}

const KIND_LABELS: Record<string, string> = {
  cpu: "Processor",
  display: "Display",
  storage: "Storage",
};

export async function generateMetadata({ params }: ComponentPageProps): Promise<Metadata> {
  const { slug } = await params;
  const component = await prisma.component.findUnique({
    where: { slug },
    select: { canonicalName: true, kind: true },
  });
  if (!component) return { title: "Component not found | Veridian" };
  const title = `${component.canonicalName} — ${KIND_LABELS[component.kind] ?? component.kind}`;
  return {
    title,
    description: `Every configuration in the Veridian catalog built around ${component.canonicalName}.`,
    alternates: { canonical: `/components/${slug}` },
  };
}

export default async function ComponentPage({ params }: ComponentPageProps) {
  const { slug } = await params;

  const component = await prisma.component.findUnique({
    where: { slug },
    include: {
      specs: { select: { key: true, value: true, unit: true, source: true, sourceUrl: true } },
      aliases: { select: { alias: true, source: true, sourceUrl: true } },
    },
  });
  if (!component) notFound();

  const links = await prisma.skuComponent.findMany({
    where: { componentId: component.id },
    include: {
      sku: {
        select: {
          id: true,
          skuCode: true,
          provenance: true,
          ramGb: true,
          displaySizeIn: true,
          batteryWh: true,
          model: {
            select: {
              name: true,
              series: { select: { name: true, manufacturer: { select: { name: true } } } },
            },
          },
          pricing: { select: { region: true, currency: true, msrp: true }, take: 1 },
        },
      },
    },
  });

  const rank: Record<string, number> = { certified: 0, manufacturer: 1, unverified: 2 };
  const configurations = links
    .map((link) => ({
      id: link.sku.id,
      skuCode: link.sku.skuCode,
      modelName: link.sku.model.name,
      seriesName: link.sku.model.series.name,
      manufacturerName: link.sku.model.series.manufacturer.name,
      provenance: link.sku.provenance as SkuProvenance,
      ramGb: link.sku.ramGb,
      displaySizeIn: link.sku.displaySizeIn,
      batteryWh: link.sku.batteryWh,
      price: link.sku.pricing[0]
        ? {
            region: link.sku.pricing[0].region,
            currency: link.sku.pricing[0].currency,
            msrp: link.sku.pricing[0].msrp,
          }
        : null,
    }))
    .sort(
      (a, b) =>
        (rank[a.provenance] ?? 3) - (rank[b.provenance] ?? 3) ||
        a.manufacturerName.localeCompare(b.manufacturerName) ||
        a.modelName.localeCompare(b.modelName)
    );

  return (
    <div className="container py-10 sm:py-14">
      <nav aria-label="Breadcrumb" className="mb-8 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--muted)]">
        <Link href="/components" className="hover:text-[var(--ink)]">Components</Link>
        <span aria-hidden="true" className="text-[var(--quiet)]">/</span>
        <span className="text-[var(--ink)]">{component.canonicalName}</span>
      </nav>

      <header className="mb-10 max-w-3xl">
        <p className="eyebrow mb-2">{KIND_LABELS[component.kind] ?? component.kind}</p>
        <h1 className="font-display text-[clamp(30px,4.5vw,48px)] leading-[1.05] tracking-[-.035em] text-balance">
          {component.canonicalName}
        </h1>
        <p className="mt-4 max-w-xl text-[14px] leading-6 text-[var(--muted)]">
          {configurations.length.toLocaleString()} configuration
          {configurations.length === 1 ? "" : "s"} in the catalog{" "}
          {configurations.length === 1 ? "is" : "are"} built around this. Every one of them keeps
          its own source record.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="surface p-6">
            <h2 className="label mb-4">Configurations</h2>
            {configurations.length === 0 ? (
              <p className="text-[13px] text-[var(--muted)]">No configurations recorded yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {configurations.map((configuration) => (
                  <li key={configuration.id} className="py-3.5 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <Link
                        href={`/skus/${configuration.id}`}
                        className="text-[14px] font-semibold text-[var(--ink)] hover:text-[var(--accent-dark)]"
                      >
                        {configuration.manufacturerName} {configuration.modelName}
                      </Link>
                      <span className="font-mono text-[12px] tabular-nums text-[var(--muted)]">
                        {configuration.price
                          ? formatPrice(configuration.price.msrp, configuration.price.currency)
                          : "price not reported"}
                      </span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--muted)]">
                      <span className="font-mono">{configuration.skuCode}</span>
                      <span>{configuration.ramGb} GB RAM</span>
                      {configuration.displaySizeIn !== null && (
                        <span>{configuration.displaySizeIn}&quot; display</span>
                      )}
                      {configuration.batteryWh !== null && (
                        <span>{configuration.batteryWh} Wh battery</span>
                      )}
                      <span
                        className={
                          configuration.provenance === "certified"
                            ? "text-[var(--success)]"
                            : configuration.provenance === "manufacturer"
                              ? "text-[var(--accent-dark)]"
                              : "text-[var(--warning)]"
                        }
                      >
                        {PROVENANCE_LABELS[configuration.provenance]}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          {component.specs.length > 0 && (
            <section className="surface p-6">
              <h2 className="label mb-4">Component facts</h2>
              <dl className="space-y-1">
                {component.specs.map((spec) => (
                  <div
                    key={spec.key}
                    className="flex items-baseline justify-between gap-4 border-b border-[var(--line)] py-2.5 last:border-0"
                  >
                    <dt className="text-[13px] text-[var(--muted)]">{spec.key.replace(/_/g, " ")}</dt>
                    <dd className="text-right text-[13px] font-medium text-[var(--ink)]">
                      {spec.value}
                      {spec.unit ? ` ${spec.unit}` : ""}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {component.aliases.length > 0 && (
            <section className="surface p-6">
              <h2 className="label mb-3">Observed names</h2>
              <p className="mb-3 text-[12px] leading-5 text-[var(--muted)]">
                How this component has been spelled by the sources we have read. Aliases are kept so
                future observations can be matched without re-deriving the identity.
              </p>
              <ul className="space-y-1.5">
                {component.aliases.map((alias) => (
                  <li key={alias.alias} className="text-[12px] text-[var(--muted)]">
                    {alias.alias}
                    {alias.sourceUrl && (
                      <>
                        {" · "}
                        <a
                          href={alias.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[var(--accent-dark)] underline underline-offset-4"
                        >
                          source ↗
                        </a>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
