import { notFound } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import type { SkuDetail } from "@/types";

interface SkuDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const sku = await prisma.sku.findUnique({
    where: { id },
    include: {
      model: {
        include: {
          series: {
            include: { manufacturer: true },
          },
        },
      },
      pricing: true,
    },
  });
  if (!sku) return { title: "SKU Not Found | Veridian" };
  const mfr = sku.model.series.manufacturer.name;
  const series = sku.model.series.name;
  const model = sku.model.name;
  const title = `${mfr} ${model} (${sku.skuCode}) Specs, Price & History | Veridian`;
  const description = `Detailed specs, regional pricing, and price history for ${mfr} ${series} ${model} (${sku.skuCode}). ${sku.ramGb}GB RAM, ${sku.storageGb}GB ${sku.storageType}, ${sku.displaySizeIn}" ${sku.displayResolution} ${sku.displayType} display.`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
    alternates: {
      canonical: `/skus/${id}`,
    },
    other: {
      "json-ld": JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: `${mfr} ${model}`,
        sku: sku.skuCode,
        brand: { "@type": "Brand", name: mfr },
        category: series,
        additionalProperty: [
          { "@type": "PropertyValue", name: "CPU", value: `${sku.cpuBrand} ${sku.cpuModel}` },
          { "@type": "PropertyValue", name: "RAM", value: `${sku.ramGb}GB ${sku.ramType}` },
          { "@type": "PropertyValue", name: "Storage", value: `${sku.storageGb}GB ${sku.storageType}` },
          { "@type": "PropertyValue", name: "Display Size", value: `${sku.displaySizeIn} inch` },
          { "@type": "PropertyValue", name: "Display Resolution", value: sku.displayResolution },
          { "@type": "PropertyValue", name: "Display Refresh Rate", value: `${sku.displayRefreshHz} Hz` },
          { "@type": "PropertyValue", name: "Weight", value: `${sku.weightKg} kg` },
          { "@type": "PropertyValue", name: "Battery", value: `${sku.batteryWh} Wh` },
        ],
        offer:
          sku.pricing[0]
            ? {
                "@type": "Offer",
                price: sku.pricing[0].msrp,
                priceCurrency: sku.pricing[0].currency,
                availability: sku.pricing[0].available
                  ? "https://schema.org/InStock"
                  : "https://schema.org/OutOfStock",
                url: sku.model.productUrl,
              }
            : undefined,
      }),
    },
  };
}

async function getSku(id: string): Promise<SkuDetail | null> {
  const sku = await prisma.sku.findUnique({
    where: { id },
    include: {
      model: {
        include: {
          series: {
            include: {
              manufacturer: true,
            },
          },
        },
      },
      pricing: true,
      ports: true,
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
    launchDate: sku.launchDate?.toISOString() || null,
    discontinued: sku.discontinued,
    productUrl: sku.model.productUrl,
    price: sku.pricing[0]
      ? {
          region: sku.pricing[0].region,
          currency: sku.pricing[0].currency,
          msrp: sku.pricing[0].msrp,
        }
      : null,
    pricing: sku.pricing.map((p) => ({
      region: p.region,
      currency: p.currency,
      msrp: p.msrp,
    })),
    ports: sku.ports.map((p) => ({
      portType: p.portType,
      count: p.count,
    })),
  };
}

function formatPrice(msrp: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(msrp);
}

export default async function SkuDetailPage({ params }: SkuDetailPageProps) {
  const { id } = await params;
  const sku = await getSku(id);

  if (!sku) {
    notFound();
  }

  // Load price observation history for the primary region (server-side).
  const primaryRegion = sku.pricing[0]?.region || "US";
  const observations = await prisma.priceObservation.findMany({
    where: { skuId: sku.id, region: primaryRegion },
    orderBy: { timestamp: "desc" },
    take: 24,
    select: { price: true, timestamp: true, retailer: true, sourceName: true },
  });

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-zinc-500 mb-6">
        <Link href="/" className="hover:text-zinc-900">
          Home
        </Link>
        <span>/</span>
        <span>{sku.manufacturerName}</span>
        <span>/</span>
        <span>{sku.seriesName}</span>
        <span>/</span>
        <span className="text-zinc-900">{sku.modelName}</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <p className="text-sm text-zinc-500 uppercase tracking-wide">
          {sku.manufacturerName} {sku.seriesName}
        </p>
        <h1 className="text-3xl font-bold text-zinc-900 mt-1">
          {sku.modelName}
        </h1>
        <p className="text-sm font-mono text-zinc-400 mt-1">{sku.skuCode}</p>
        {sku.discontinued && (
          <span className="inline-block mt-2 px-2 py-1 text-xs bg-red-50 text-red-700 rounded">
            Discontinued
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Specs */}
        <div className="lg:col-span-2 space-y-6">
          <SpecSection title="Processor">
            <SpecRow label="CPU" value={`${sku.cpuBrand} ${sku.cpuModel}`} />
            {sku.cpuCores && <SpecRow label="Cores" value={`${sku.cpuCores}`} />}
            {sku.gpuModel && <SpecRow label="GPU" value={sku.gpuModel} />}
            {sku.npuTops && <SpecRow label="NPU" value={`${sku.npuTops} TOPS`} />}
          </SpecSection>

          <SpecSection title="Memory & Storage">
            <SpecRow
              label="RAM"
              value={`${sku.ramGb} GB ${sku.ramType} ${sku.ramSoldered ? "(Soldered)" : "(Upgradeable)"}`}
            />
            <SpecRow
              label="Storage"
              value={`${sku.storageGb >= 1024 ? `${sku.storageGb / 1024} TB` : `${sku.storageGb} GB`} ${sku.storageType}`}
            />
            {sku.storageSlots && (
              <SpecRow label="Storage Slots" value={`${sku.storageSlots}`} />
            )}
          </SpecSection>

          <SpecSection title="Display">
            <SpecRow label="Size" value={`${sku.display.sizeIn}"`} />
            <SpecRow label="Resolution" value={sku.display.resolution} />
            <SpecRow label="Type" value={sku.display.type} />
            <SpecRow label="Refresh Rate" value={`${sku.display.refreshHz} Hz`} />
            <SpecRow label="Touch" value={sku.display.touch ? "Yes" : "No"} />
            {sku.display.nits && (
              <SpecRow label="Brightness" value={`${sku.display.nits} nits`} />
            )}
          </SpecSection>

          <SpecSection title="Physical">
            <SpecRow label="Weight" value={`${sku.weightKg.toFixed(2)} kg`} />
            <SpecRow label="Build Material" value={sku.buildMaterial} />
          </SpecSection>

          <SpecSection title="Battery">
            <SpecRow label="Capacity" value={`${sku.batteryWh} Wh`} />
            {sku.batteryLifeHours && (
              <SpecRow
                label="Claimed Battery Life"
                value={`${sku.batteryLifeHours} hours`}
              />
            )}
          </SpecSection>

          <SpecSection title="Connectivity">
            {sku.ports.length > 0 ? (
              sku.ports.map((port, i) => (
                <SpecRow key={i} label={port.portType} value={`${port.count}x`} />
              ))
            ) : (
              <p className="text-zinc-500 text-sm">No port data available</p>
            )}
          </SpecSection>

          <SpecSection title="Software">
            <SpecRow label="Operating System" value={sku.os} />
            {sku.linuxCompat && (
              <SpecRow label="Linux Compatibility" value={sku.linuxCompat} />
            )}
          </SpecSection>
        </div>

        {/* Sidebar - Pricing */}
        <div className="space-y-6">
          <div className="bg-white border border-zinc-200 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-zinc-900 mb-4">
              Pricing
            </h3>
            {sku.pricing.length > 0 ? (
              <div className="space-y-3">
                {sku.pricing.map((price) => (
                  <div
                    key={price.region}
                    className="flex items-center justify-between"
                  >
                    <span className="text-sm text-zinc-500">{price.region}</span>
                    <span className="font-semibold text-zinc-900">
                      {formatPrice(price.msrp, price.currency)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-zinc-500 text-sm">No pricing available</p>
            )}
          </div>

          <div className="bg-white border border-zinc-200 rounded-xl p-6">
            <h3 className="text-lg font-semibold text-zinc-900 mb-4">
              Price History
            </h3>
            {observations.length > 0 ? (
              <div className="space-y-3 text-sm">
                {observations.map((obs, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="font-medium text-zinc-900">
                      {formatPrice(obs.price, sku.pricing[0]?.currency || "USD")}
                    </span>
                    <span className="text-zinc-500">
                      {new Date(obs.timestamp).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-zinc-500 text-sm">
                No historical observations recorded yet
              </p>
            )}
          </div>

          {sku.productUrl && (
            <a
              href={sku.productUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full px-4 py-3 text-center text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors"
            >
              View Official Page
            </a>
          )}

          {sku.launchDate && (
            <div className="bg-white border border-zinc-200 rounded-xl p-6">
              <h3 className="text-sm font-medium text-zinc-500 mb-1">
                Launch Date
              </h3>
              <p className="text-zinc-900">
                {new Date(sku.launchDate).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "long",
                })}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SpecSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-6">
      <h3 className="text-lg font-semibold text-zinc-900 mb-4">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-zinc-500">{label}</span>
      <span className="text-sm font-medium text-zinc-900">{value}</span>
    </div>
  );
}
