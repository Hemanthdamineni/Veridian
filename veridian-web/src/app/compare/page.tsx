import type { Metadata } from "next";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { toProvenance } from "@/lib/api";
import { formatCpu } from "@/lib/format";
import {
  COMPARE_MAX_CONFIGS,
  buildComparison,
  parseCompareIds,
  type CompareRow,
} from "@/lib/compare";
import { ComparisonPicker } from "@/components/compare/ComparisonPicker";
import { ComparisonTable } from "@/components/compare/ComparisonTable";
import { ComparisonHighlights } from "@/components/compare/ComparisonHighlights";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Compare laptops",
  description:
    "Compare laptop configurations side by side. Differences are named, missing data stays visible, and every figure says where it came from.",
  alternates: { canonical: "/compare" },
};

interface ComparePageProps {
  searchParams: Promise<{
    ids?: string | string[];
    region?: string | string[];
  }>;
}

/** The comparison reads its state from the URL, so a link always rebuilds it. */
export default async function ComparePage({ searchParams }: ComparePageProps) {
  const params = await searchParams;
  const rawIds = firstValue(params.ids);
  const requestedRegion = firstValue(params.region);

  const parsed = parseCompareIds(rawIds);

  const regionRows = await prisma.skuRegionalPricing.findMany({
    distinct: ["region"],
    select: { region: true },
    orderBy: { region: "asc" },
  });
  const availableRegions = regionRows.map((row) => row.region);
  const region = normalizeRegion(requestedRegion, availableRegions);

  const rows = parsed.ids.length > 0 ? await loadRows(parsed.ids, region) : [];
  const missingCount = parsed.ids.length - rows.length;

  const comparison = buildComparison(rows);

  return (
    <div className="container py-10 sm:py-14">
      <header className="mb-8 max-w-2xl">
        <p className="eyebrow mb-3">Decision workspace</p>
        <h1 className="font-display text-[clamp(34px,5vw,56px)] leading-[1.02] tracking-[-.045em] text-balance">
          Which of these should you pick?
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-7 text-[var(--muted)]">
          Pick up to {COMPARE_MAX_CONFIGS} configurations and this page tells you what actually
          differs between them. A metric one configuration does not report is never counted as a
          difference — and never as a win either.
        </p>
      </header>

      <div className="space-y-6">
        <ComparisonPicker
          selected={rows.map((row) => ({
            id: row.id,
            label: `${row.brand} ${row.modelName}`,
            skuCode: row.skuCode,
            provenance: row.provenance,
          }))}
          region={region}
          availableRegions={availableRegions}
        />

        {parsed.overflow > 0 && (
          <Notice tone="warning">
            A comparison holds at most {COMPARE_MAX_CONFIGS} configurations, so{" "}
            {parsed.overflow === 1 ? "the last one" : `the last ${parsed.overflow}`} in this link{" "}
            {parsed.overflow === 1 ? "was" : "were"} left out.
          </Notice>
        )}

        {parsed.duplicates > 0 && (
          <Notice tone="quiet">
            {parsed.duplicates === 1
              ? "One repeated configuration was dropped."
              : `${parsed.duplicates} repeated configurations were dropped.`}
          </Notice>
        )}

        {missingCount > 0 && (
          <Notice tone="warning">
            {missingCount === 1
              ? "One configuration in this link is no longer in the catalog and was left out."
              : `${missingCount} configurations in this link are no longer in the catalog and were left out.`}{" "}
            <Link href="/" className="underline underline-offset-4">
              Browse the catalog
            </Link>{" "}
            to find a replacement.
          </Notice>
        )}

        {rows.length === 0 ? (
          <div className="surface p-8 text-center sm:p-12">
            <p className="eyebrow mb-3">Start comparing</p>
            <h2 className="font-display text-[26px] tracking-[-.03em]">
              {parsed.ids.length > 0
                ? "None of the configurations in this link exist any more"
                : "Add at least two laptops"}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-[13px] leading-6 text-[var(--muted)]">
              {parsed.ids.length > 0
                ? "The catalog has changed since this link was made. Start a new comparison from the catalog."
                : "Use the picker above to build your shortlist, or open a configuration page and choose “Compare this laptop”."}
            </p>
            <Link href="/" className="btn-secondary mt-6">
              Browse the catalog
            </Link>
          </div>
        ) : (
          <>
            <ComparisonHighlights comparison={comparison} />
            <ComparisonTable comparison={comparison} />
          </>
        )}
      </div>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "warning" | "quiet";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "warning"
      ? "border-[var(--warning)] bg-[var(--warning-soft)] text-[var(--warning)]"
      : "border-[var(--line)] bg-[var(--surface-soft)] text-[var(--muted)]";
  return (
    <p
      role="status"
      className={`rounded-[8px] border px-4 py-3 text-[12px] leading-5 ${toneClass}`}
    >
      {children}
    </p>
  );
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/**
 * Pick the region to show prices for.
 *
 * An unknown region falls back to the default rather than silently showing
 * an empty price column.
 */
function normalizeRegion(requested: string | undefined, available: string[]): string {
  if (requested && available.includes(requested)) return requested;
  if (available.includes("US")) return "US";
  return available[0] ?? "US";
}

type SkuWithRelations = Prisma.SkuGetPayload<{
  include: {
    model: { include: { series: { include: { manufacturer: true } } } };
    pricing: true;
    ports: true;
  };
}>;

async function loadRows(ids: string[], region: string): Promise<CompareRow[]> {
  const skus = await prisma.sku.findMany({
    where: { id: { in: ids }, catalogVisible: true },
    include: {
      model: { include: { series: { include: { manufacturer: true } } } },
      pricing: { where: { region } },
      ports: true,
    },
  });

  // findMany does not guarantee the caller's ordering, and the order of the
  // columns is the reader's own ordering.
  return ids
    .map((id) => skus.find((sku) => sku.id === id))
    .filter((sku): sku is SkuWithRelations => Boolean(sku))
    .map(toCompareRow);
}

function toCompareRow(sku: SkuWithRelations): CompareRow {
  const price = sku.pricing[0] ?? null;
  return {
    id: sku.id,
    skuCode: sku.skuCode,
    modelName: sku.model.name,
    brand: sku.model.series.manufacturer.name,
    series: sku.model.series.name,
    provenance: toProvenance(sku.provenance),
    values: {
      cpu: sku.cpuBrand || sku.cpuModel ? formatCpu(sku.cpuBrand, sku.cpuModel) : null,
      cpuCores: sku.cpuCores,
      gpu: sku.gpuModel,
      ramGb: sku.ramGb,
      ramType: sku.ramType,
      ramSoldered: sku.ramSoldered,
      storageGb: sku.storageGb,
      storageType: sku.storageType,
      storageSlots: sku.storageSlots,
      displaySizeIn: sku.displaySizeIn,
      displayResolution: sku.displayResolution,
      displayType: sku.displayType,
      displayRefreshHz: sku.displayRefreshHz,
      displayNits: sku.displayNits,
      displayTouch: sku.displayTouch,
      weightKg: sku.weightKg,
      batteryWh: sku.batteryWh,
      batteryLifeHours: sku.batteryLifeHours,
      os: sku.os,
      ports: sku.ports.map((port) => ({ type: port.portType, count: port.count })),
      price: price ? price.msrp : null,
      priceCurrency: price ? price.currency : null,
      priceUpdatedAt: price ? price.updatedAt.toISOString() : null,
    },
  };
}
