/**
 * Populate the component knowledge graph.
 *
 * Shared components are first-class entities so the catalog can answer
 * questions a flat specification table cannot: which configurations share
 * this processor, which share this display class, what a given storage
 * technology appears in.
 *
 * Every component is derived from fields the certification actually asserts.
 * Where the source does not name a component (a panel part number, for
 * example) the component is a *class* derived from the asserted
 * specification, and it is labelled as such rather than pretending to be a
 * part number.
 *
 * Usage: npm run db:components
 */

import { prisma } from "../src/lib/db";
import { ENERGY_STAR_SOURCE } from "../src/lib/energy-star/types";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

/** Normalise a processor name so the same chip collapses onto one entity. */
function normalizeCpu(value: string): string {
  return value
    .replace(/[®™]/g, "")
    .replace(/\bprocessor\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function upsertComponent(params: {
  kind: string;
  canonicalName: string;
  brand?: string | null;
  model?: string | null;
  source: string;
  sourceUrl: string | null;
}): Promise<string> {
  const slug = `${params.kind}-${slugify(params.canonicalName)}`;
  const component = await prisma.component.upsert({
    where: { slug },
    update: {
      canonicalName: params.canonicalName,
      brand: params.brand ?? null,
      model: params.model ?? null,
    },
    create: {
      kind: params.kind,
      canonicalName: params.canonicalName,
      slug,
      brand: params.brand ?? null,
      model: params.model ?? null,
    },
  });
  return component.id;
}

async function addAlias(params: {
  componentId: string;
  alias: string;
  source: string;
  sourceUrl: string | null;
  confidence: number;
}): Promise<void> {
  const normalized = params.alias.replace(/\s+/g, " ").trim().toLowerCase();
  if (!normalized) return;
  await prisma.componentAlias.upsert({
    where: {
      componentId_normalized: {
        componentId: params.componentId,
        normalized,
      },
    },
    update: { observedAt: new Date() },
    create: {
      componentId: params.componentId,
      alias: params.alias,
      normalized,
      source: params.source,
      sourceUrl: params.sourceUrl,
      confidence: params.confidence,
    },
  });
}

async function addSpec(params: {
  componentId: string;
  key: string;
  value: string;
  unit?: string | null;
  source: string;
  sourceUrl: string | null;
}): Promise<void> {
  await prisma.componentSpec.upsert({
    where: {
      componentId_key: { componentId: params.componentId, key: params.key },
    },
    update: { value: params.value, unit: params.unit ?? null, observedAt: new Date() },
    create: {
      componentId: params.componentId,
      key: params.key,
      value: params.value,
      unit: params.unit ?? null,
      source: params.source,
      sourceUrl: params.sourceUrl,
    },
  });
}

async function link(params: {
  skuId: string;
  componentId: string;
  role: string;
  source: string;
  sourceUrl: string | null;
}): Promise<void> {
  await prisma.skuComponent.upsert({
    where: {
      skuId_componentId_role: {
        skuId: params.skuId,
        componentId: params.componentId,
        role: params.role,
      },
    },
    update: { observedAt: new Date() },
    create: {
      skuId: params.skuId,
      componentId: params.componentId,
      role: params.role,
      source: params.source,
      sourceUrl: params.sourceUrl,
      confidence: 0.95,
    },
  });
}

async function main() {
  const specs = await prisma.certifiedSkuSpec.findMany({
    include: { sku: { select: { id: true, cpuModel: true, displaySizeIn: true } } },
  });

  let cpuComponents = 0;
  let displayComponents = 0;
  let storageComponents = 0;
  let links = 0;

  for (const spec of specs) {
    const sourceUrl = spec.sourceUrl;

    // --- Processor -------------------------------------------------------
    const observedCpu = spec.cpuModel?.trim();
    if (observedCpu) {
      const canonicalCpu = normalizeCpu(observedCpu);
      const cpuId = await upsertComponent({
        kind: "cpu",
        canonicalName: canonicalCpu,
        brand: spec.cpuBrand,
        model: canonicalCpu,
        source: ENERGY_STAR_SOURCE.name,
        sourceUrl,
      });
      cpuComponents += 1;
      await addAlias({
        componentId: cpuId,
        alias: observedCpu,
        source: ENERGY_STAR_SOURCE.name,
        sourceUrl,
        confidence: 1,
      });
      if (spec.cpuCores !== null) {
        await addSpec({
          componentId: cpuId,
          key: "cores",
          value: String(spec.cpuCores),
          source: ENERGY_STAR_SOURCE.name,
          sourceUrl,
        });
      }
      if (spec.cpuBaseClockGHz !== null) {
        await addSpec({
          componentId: cpuId,
          key: "base_clock",
          value: String(spec.cpuBaseClockGHz),
          unit: "GHz",
          source: ENERGY_STAR_SOURCE.name,
          sourceUrl,
        });
      }
      if (spec.cpuMaxClockGHz !== null) {
        await addSpec({
          componentId: cpuId,
          key: "max_clock",
          value: String(spec.cpuMaxClockGHz),
          unit: "GHz",
          source: ENERGY_STAR_SOURCE.name,
          sourceUrl,
        });
      }
      await link({
        skuId: spec.skuId,
        componentId: cpuId,
        role: "primary",
        source: ENERGY_STAR_SOURCE.name,
        sourceUrl,
      });
      links += 1;
    }

    // --- Display class ---------------------------------------------------
    // The certification does not name a panel part number, so the shared
    // entity is the display *class* the configuration was certified with.
    if (spec.displaySizeIn !== null) {
      const inches = spec.displaySizeIn;
      const megapixels = spec.displayResolutionMp;
      const canonicalDisplay = megapixels
        ? `${inches}-inch ${megapixels} MP display`
        : `${inches}-inch display`;
      const displayId = await upsertComponent({
        kind: "display",
        canonicalName: canonicalDisplay,
        source: ENERGY_STAR_SOURCE.name,
        sourceUrl,
      });
      displayComponents += 1;
      await addAlias({
        componentId: displayId,
        alias: canonicalDisplay,
        source: ENERGY_STAR_SOURCE.name,
        sourceUrl,
        confidence: 0.9,
      });
      await addSpec({
        componentId: displayId,
        key: "diagonal",
        value: String(inches),
        unit: "in",
        source: ENERGY_STAR_SOURCE.name,
        sourceUrl,
      });
      if (megapixels !== null) {
        await addSpec({
          componentId: displayId,
          key: "resolution",
          value: `${megapixels} MP`,
          source: ENERGY_STAR_SOURCE.name,
          sourceUrl,
        });
      }
      if (spec.touchScreen !== null) {
        await addSpec({
          componentId: displayId,
          key: "touch",
          value: spec.touchScreen ? "yes" : "no",
          source: ENERGY_STAR_SOURCE.name,
          sourceUrl,
        });
      }
      await link({
        skuId: spec.skuId,
        componentId: displayId,
        role: "primary",
        source: ENERGY_STAR_SOURCE.name,
        sourceUrl,
      });
      links += 1;
    }

    // --- Storage technology ----------------------------------------------
    const storageType = spec.storageType?.trim();
    if (storageType) {
      const canonicalStorage = storageType.replace(/\s+/g, " ").trim();
      const storageId = await upsertComponent({
        kind: "storage",
        canonicalName: canonicalStorage,
        source: ENERGY_STAR_SOURCE.name,
        sourceUrl,
      });
      storageComponents += 1;
      await addAlias({
        componentId: storageId,
        alias: canonicalStorage,
        source: ENERGY_STAR_SOURCE.name,
        sourceUrl,
        confidence: 0.9,
      });
      if (spec.storageDrives !== null) {
        await addSpec({
          componentId: storageId,
          key: "drives",
          value: String(spec.storageDrives),
          source: ENERGY_STAR_SOURCE.name,
          sourceUrl,
        });
      }
      await link({
        skuId: spec.skuId,
        componentId: storageId,
        role: "primary",
        source: ENERGY_STAR_SOURCE.name,
        sourceUrl,
      });
      links += 1;
    }
  }

  const [components, aliases, componentSpecs, links2] = await Promise.all([
    prisma.component.count(),
    prisma.componentAlias.count(),
    prisma.componentSpec.count(),
    prisma.skuComponent.count(),
  ]);

  console.log(
    JSON.stringify(
      {
        certifiedRecords: specs.length,
        componentsObserved: { cpuComponents, displayComponents, storageComponents },
        totals: { components, aliases, componentSpecs, skuComponentLinks: links2 },
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("Component population failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
