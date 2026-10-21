import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { toProvenance } from "@/lib/api";
import { PROVENANCE_LABELS } from "@/types";
import type { SkuDetail } from "@/types";
import { formatCpu, formatDate, formatPrice, formatStorage, formatWeight } from "@/lib/format";

interface SkuDetailPageProps {
  params: Promise<{ id: string }>;
}

const COMPONENT_KIND_LABELS: Record<string, string> = {
  cpu: "Processor",
  display: "Display",
  storage: "Storage",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const sku = await prisma.sku.findFirst({
    where: { id, catalogVisible: true },
    include: { model: { include: { series: { include: { manufacturer: true } } } }, pricing: true },
  });
  if (!sku) return { title: "Configuration not found | Veridian" };
  const mfr = sku.model.series.manufacturer.name;
  const series = sku.model.series.name;
  const model = sku.model.name;
  const title = `${mfr} ${model} — specs & pricing | Veridian`;
  const specBits = [
    sku.ramGb !== null ? `${sku.ramGb} GB RAM` : null,
    sku.storageGb !== null ? `${formatStorage(sku.storageGb)}` : null,
    sku.displaySizeIn !== null ? `${sku.displaySizeIn}" display` : null,
  ].filter(Boolean).join(", ");
  const description = `Specifications and regional pricing for the ${mfr} ${series} ${model} (${sku.skuCode}).${specBits ? ` ${specBits}.` : ""}`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    alternates: { canonical: `/skus/${id}` },
  };
}

async function getSku(id: string): Promise<SkuDetail | null> {
  const sku = await prisma.sku.findFirst({
    where: { id, catalogVisible: true },
    include: {
      model: { include: { series: { include: { manufacturer: true } } } },
      pricing: true,
      ports: true,
      certifiedSpecs: true,
      sources: {
        select: {
          source: true,
          kind: true,
          sourceUrl: true,
          observedAt: true,
          confidence: true,
          note: true,
        },
      },
      components: {
        include: {
          component: {
            select: {
              id: true,
              kind: true,
              canonicalName: true,
              slug: true,
            },
          },
        },
      },
    },
  });
  if (!sku) return null;
  return {
    id: sku.id,
    skuCode: sku.skuCode,
    modelName: sku.model.name,
    seriesName: sku.model.series.name,
    manufacturerName: sku.model.series.manufacturer.name,
    storeUrl: sku.model.productUrl,
    cpuBrand: sku.cpuBrand,
    cpuModel: sku.cpuModel,
    cpuCores: sku.cpuCores,
    gpuModel: sku.gpuModel,
    ramGb: sku.ramGb,
    ramType: sku.ramType,
    ramSoldered: sku.ramSoldered,
    storageGb: sku.storageGb,
    storageType: sku.storageType,
    storageSlots: sku.storageSlots,
    display: {
      sizeIn: sku.displaySizeIn,
      resolution: sku.displayResolution,
      type: sku.displayType,
      refreshHz: sku.displayRefreshHz,
      touch: sku.displayTouch,
      nits: sku.displayNits,
    },
    weightKg: sku.weightKg,
    batteryWh: sku.batteryWh,
    batteryLifeHours: sku.batteryLifeHours,
    npuTops: sku.npuTops,
    os: sku.os,
    buildMaterial: sku.buildMaterial,
    linuxCompat: sku.linuxCompat,
    provenance: toProvenance(sku.provenance),
    sources: sku.sources.map((source) => ({
      source: source.source,
      kind: source.kind,
      sourceUrl: source.sourceUrl,
      observedAt: source.observedAt.toISOString(),
      confidence: source.confidence,
      note: source.note,
    })),
    launchDate: sku.launchDate?.toISOString() || null,
    discontinued: sku.discontinued,
    productUrl: sku.model.productUrl,
    price: sku.pricing[0] ? { region: sku.pricing[0].region, currency: sku.pricing[0].currency, msrp: sku.pricing[0].msrp } : null,
    pricing: sku.pricing.map((p) => ({ region: p.region, currency: p.currency, msrp: p.msrp })),
    ports: sku.ports.map((p) => ({ portType: p.portType, count: p.count })),
    components: sku.components.map((link) => ({
      id: link.component.id,
      kind: link.component.kind,
      name: link.component.canonicalName,
      slug: link.component.slug,
      role: link.role,
    })),
    certifiedSpecs: sku.certifiedSpecs.map((s) => ({
      source: s.source, sourceUrl: s.sourceUrl, observedAt: s.observedAt.toISOString(),
      certifiedAt: s.certifiedAt?.toISOString() || null, marketDate: s.marketDate?.toISOString() || null,
      energyStarId: s.energyStarId, cpuBrand: s.cpuBrand, cpuModel: s.cpuModel, cpuCores: s.cpuCores,
      cpuBaseClockGHz: s.cpuBaseClockGHz, cpuMaxClockGHz: s.cpuMaxClockGHz, cpuPackages: s.cpuPackages,
      ramGb: s.ramGb, storageType: s.storageType, storageDrives: s.storageDrives, displaySizeIn: s.displaySizeIn,
      displayResolutionMp: s.displayResolutionMp, displayAreaSqIn: s.displayAreaSqIn, touchScreen: s.touchScreen,
      batteryWh: s.batteryWh, os: s.os, npu: s.npu, markets: s.markets,
    })),
  };
}

export default async function SkuDetailPage({ params }: SkuDetailPageProps) {
  const { id } = await params;
  const sku = await getSku(id);
  if (!sku) notFound();

  const primaryRegion = sku.pricing[0]?.region || "US";
  const observations = await prisma.priceObservation.findMany({
    where: { skuId: sku.id, region: primaryRegion },
    orderBy: { timestamp: "desc" },
    take: 24,
    select: { price: true, timestamp: true, retailer: true, sourceName: true, sourceUrl: true },
  });
  const hasSynthetic = observations.some((o) => o.sourceName?.toLowerCase().includes("seed") || !o.sourceUrl);

  return (
    <div className="container py-10 sm:py-14">
      <nav aria-label="Breadcrumb" className="mb-8 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--muted)]">
        <Link href="/" className="hover:text-[var(--ink)]">Catalog</Link>
        <span aria-hidden="true" className="text-[var(--quiet)]">/</span>
        <span>{sku.manufacturerName}</span>
        <span aria-hidden="true" className="text-[var(--quiet)]">/</span>
        <span className="text-[var(--ink)]">{sku.modelName}</span>
      </nav>

      <header className="mb-10 max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <p className="eyebrow">{sku.manufacturerName} · {sku.seriesName}</p>
          <span
            className={`rounded-[5px] px-2 py-1 text-[10px] font-semibold ${
              sku.provenance === "certified"
                ? "bg-[var(--success-soft)] text-[var(--success)]"
                : sku.provenance === "manufacturer"
                  ? "bg-[var(--accent-soft)] text-[var(--accent-dark)]"
                  : "bg-[var(--warning-soft)] text-[var(--warning)]"
            }`}
          >
            {PROVENANCE_LABELS[sku.provenance]}
          </span>
          {sku.discontinued && <span className="rounded-[5px] bg-[var(--danger-soft)] px-2 py-1 text-[10px] font-semibold text-[var(--danger)]">Discontinued</span>}
        </div>
        <h1 className="mt-2 font-display text-[clamp(34px,5vw,56px)] leading-[1.02] tracking-[-.04em] text-balance">{sku.modelName}</h1>
        <p className="mt-3 font-mono text-[12px] text-[var(--quiet)]">{sku.skuCode}</p>
        <p className="mt-4 max-w-xl text-[14px] leading-6 text-[var(--muted)]">
          {summaryLine(sku)}
        </p>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <SpecSection title="Processor"><SpecRow label="CPU" value={formatCpu(sku.cpuBrand, sku.cpuModel)} />
            {sku.cpuCores !== null && <SpecRow label="Cores" value={String(sku.cpuCores)} />}
            {sku.gpuModel && <SpecRow label="Graphics" value={sku.gpuModel} />}
            {sku.npuTops !== null && <SpecRow label="NPU" value={`${sku.npuTops} TOPS`} />}
          </SpecSection>
          <SpecSection title="Memory & storage">
            <SpecRow label="RAM" value={`${sku.ramGb} GB${sku.ramType ? ` ${sku.ramType}` : ""}${sku.ramSoldered === null ? "" : sku.ramSoldered ? " · soldered" : " · upgradeable"}`} />
            <SpecRow label="Storage" value={`${formatStorage(sku.storageGb)}${sku.storageType ? ` · ${sku.storageType}` : ""}`} />
            {sku.storageSlots !== null && <SpecRow label="Storage slots" value={String(sku.storageSlots)} />}
          </SpecSection>
          {hasDisplay(sku) && (
            <SpecSection title="Display">
              <SpecRow label="Size" value={sku.display.sizeIn !== null ? `${sku.display.sizeIn}"` : "—"} />
              {sku.display.resolution && <SpecRow label="Resolution" value={sku.display.resolution} />}
              {sku.display.type && <SpecRow label="Type" value={sku.display.type} />}
              {sku.display.refreshHz !== null && <SpecRow label="Refresh rate" value={`${sku.display.refreshHz} Hz`} />}
              {sku.display.nits !== null && <SpecRow label="Brightness" value={`${sku.display.nits} nits`} />}
              <SpecRow label="Touch" value={sku.display.touch === null ? "—" : sku.display.touch ? "Yes" : "No"} />
            </SpecSection>
          )}
          {hasPhysical(sku) && (
            <SpecSection title="Physical">
              {sku.weightKg !== null && <SpecRow label="Weight" value={formatWeight(sku.weightKg)} />}
              {sku.buildMaterial && <SpecRow label="Build material" value={sku.buildMaterial} />}
            </SpecSection>
          )}
          {hasBattery(sku) && (
            <SpecSection title="Battery & power">
              {sku.batteryWh !== null && <SpecRow label="Capacity" value={`${sku.batteryWh} Wh`} />}
              {sku.batteryLifeHours !== null && <SpecRow label="Claimed battery life" value={`${sku.batteryLifeHours} hours`} />}
            </SpecSection>
          )}
          {sku.ports.length > 0 && (
            <SpecSection title="Connectivity">
              {sku.ports.map((port) => <SpecRow key={port.portType} label={port.portType} value={`${port.count}×`} />)}
            </SpecSection>
          )}
          <SpecSection title="Software">
            <SpecRow label="Operating system" value={sku.os} />
            {sku.linuxCompat && <SpecRow label="Linux compatibility" value={sku.linuxCompat} />}
          </SpecSection>
          {sku.components && sku.components.length > 0 && (
            <SpecSection title="Shared components">
              <p className="mb-3 text-[12px] leading-5 text-[var(--muted)]">
                These are the parts this configuration is built around. Following one shows every
                other machine in the catalog that shares it.
              </p>
              <ul className="space-y-2">
                {sku.components.map((component) => (
                  <li key={`${component.kind}-${component.id}`}>
                    <Link
                      href={`/components/${component.slug}`}
                      className="flex items-baseline justify-between gap-3 rounded-[5px] border border-[var(--line)] px-3 py-2 transition-colors hover:border-[var(--line-strong)]"
                    >
                      <span className="min-w-0">
                        <span className="block text-[10px] uppercase tracking-[.08em] text-[var(--quiet)]">
                          {COMPONENT_KIND_LABELS[component.kind] ?? component.kind}
                        </span>
                        <span className="block truncate text-[13px] font-medium text-[var(--ink)]">
                          {component.name}
                        </span>
                      </span>
                      <span aria-hidden="true" className="shrink-0 text-[var(--quiet)]">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </SpecSection>
          )}
          {sku.certifiedSpecs && sku.certifiedSpecs.length > 0 ? (
            <SpecSection title="Certified provenance">
              <div className="space-y-4 text-[12px] leading-5 text-[var(--muted)]">
                {sku.certifiedSpecs.map((spec) => (
                  <div key={spec.energyStarId}>
                    <p><strong className="font-semibold text-[var(--ink)]">{spec.source}</strong> · Energy Star ID <span className="font-mono text-[11px]">{spec.energyStarId}</span></p>
                    <p className="mt-1">Certified {spec.certifiedAt ? formatDate(spec.certifiedAt) : "date not reported"}; observed {formatDate(spec.observedAt)}.</p>
                    {spec.sourceUrl && <a href={spec.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[var(--accent-dark)] underline underline-offset-4">View source record ↗</a>}
                  </div>
                ))}
                <p className="border-t border-[var(--line)] pt-3 text-[11px] text-[var(--quiet)]">Certification values are reproduced as asserted by the source. Missing fields are not inferred.</p>
              </div>
            </SpecSection>
          ) : (
            <SpecSection title="Provenance">
              <div className="space-y-3 text-[12px] leading-5 text-[var(--muted)]">
                <p>
                  {sku.provenance === "manufacturer" ? (
                    <>
                      These figures were checked against the manufacturer&rsquo;s own specification
                      page, which is linked below. The page lists every configuration of this
                      family, so a field the page does not state for this exact part number is
                      shown as reported rather than filled in.
                    </>
                  ) : (
                    <>
                      This configuration has no cited source. Its figures come from our own
                      reference dataset and have <strong className="font-semibold text-[var(--ink)]">not
                      been checked against the manufacturer</strong>. Treat every value as a
                      reported specification and confirm the exact part number on the
                      manufacturer&rsquo;s own page before buying.
                    </>
                  )}
                </p>
                {sku.sources && sku.sources.length > 0 && (
                  <ul className="space-y-2 border-t border-[var(--line)] pt-3">
                    {sku.sources.map((source) => (
                      <li key={source.source}>
                        <p>
                          <strong className="font-semibold text-[var(--ink)]">{source.source}</strong>
                          <span className="text-[var(--quiet)]"> · {source.kind} · observed {formatDate(source.observedAt)}</span>
                        </p>
                        {source.sourceUrl && (
                          <a href={source.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-block text-[var(--accent-dark)] underline underline-offset-4">View the page this came from ↗</a>
                        )}
                        {source.note && <p className="mt-0.5 text-[11px] text-[var(--quiet)]">{source.note}</p>}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[11px] text-[var(--quiet)]">
                  See <Link href="/methodology" className="text-[var(--accent-dark)] underline underline-offset-4">how this catalog works</Link> for the full breakdown.
                </p>
              </div>
            </SpecSection>
          )}
        </div>

        <div className="space-y-6">
          <section className="surface p-6">
            <h2 className="label mb-4">Pricing</h2>
            {sku.pricing.length > 0 ? (
              <ul className="divide-y divide-[var(--line)]">
                {sku.pricing.map((p) => (
                  <li key={p.region} className="flex items-center justify-between py-2.5">
                    <span className="text-[13px] text-[var(--muted)]">{p.region}</span>
                    <span className="font-mono text-[15px] font-semibold">{formatPrice(p.msrp, p.currency)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-[var(--muted)]">No pricing recorded for this configuration.</p>
            )}
            <p className="mt-4 text-[11px] leading-5 text-[var(--quiet)]">Manufacturer suggested price for each region at our last update — not a live retail price.</p>
          </section>

          <section className="surface p-6">
            <h2 className="label mb-4">Price observations</h2>
            {hasSynthetic && observations.length > 0 && (
              <p className="mb-4 border border-[var(--warning)] bg-[var(--warning-soft)] rounded-[5px] p-3 text-[12px] leading-5 text-[var(--warning)]">
                These are seed reference values, not verified live retailer prices.
              </p>
            )}
            {observations.length > 0 ? (
              <ul className="divide-y divide-[var(--line)]">
                {observations.slice(0, 8).map((obs, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                    <span className="font-mono font-medium">{formatPrice(obs.price, sku.pricing[0]?.currency || "USD")}</span>
                    <span className="text-right text-[11px] text-[var(--muted)]">
                      {new Date(obs.timestamp).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-[var(--muted)]">No observations recorded yet.</p>
            )}
          </section>

          {sku.launchDate && (
            <section className="surface p-6">
              <h2 className="label mb-2">Launch</h2>
              <p className="text-[14px] font-medium">{formatDate(sku.launchDate)}</p>
            </section>
          )}

          <div className="flex flex-col gap-2">
            {sku.productUrl && (
              <a href={sku.productUrl} target="_blank" rel="noopener noreferrer" className="btn-primary">View official page ↗</a>
            )}
            <Link href={`/compare?ids=${sku.id}`} className="btn-secondary">Compare this laptop</Link>
            <Link href="/" className="btn-quiet">Back to catalog</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function SpecSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="surface p-6">
      <h2 className="label mb-4">{title}</h2>
      <dl className="space-y-1">{children}</dl>
    </section>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line)] py-2.5 last:border-0">
      <dt className="text-[13px] text-[var(--muted)]">{label}</dt>
      <dd className="text-right text-[13px] font-medium text-[var(--ink)]">{value || "—"}</dd>
    </div>
  );
}

function hasDisplay(sku: SkuDetail): boolean {
  return sku.display.sizeIn !== null || sku.display.resolution !== null || sku.display.type !== null ||
    sku.display.refreshHz !== null || sku.display.nits !== null;
}

function hasPhysical(sku: SkuDetail): boolean {
  return sku.weightKg !== null || sku.buildMaterial !== null;
}

function hasBattery(sku: SkuDetail): boolean {
  return sku.batteryWh !== null || sku.batteryLifeHours !== null;
}

/** One-sentence summary that only mentions facts actually reported. */
function summaryLine(sku: SkuDetail): string {
  const bits: string[] = [`${sku.ramGb} GB RAM`, formatStorage(sku.storageGb)];
  if (sku.display.sizeIn !== null) bits.push(`${sku.display.sizeIn}" display`);
  if (sku.weightKg !== null) bits.push(formatWeight(sku.weightKg));
  if (sku.batteryWh !== null) bits.push(`${sku.batteryWh} Wh battery`);
  return `${sku.modelName.split("(")[0].trim()} — ${bits.join(", ")}. What isn&rsquo;t reported stays visible.`;
}
