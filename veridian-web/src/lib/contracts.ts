import type { PrismaClient } from "@prisma/client";

/**
 * The catalog's trust contract.
 *
 * These are the properties that make the catalog worth trusting. They are
 * written as functions over the database rather than as assertions inside a
 * test, so that the same checks can run in three places: the test suite,
 * the data-quality audit, and the admin dashboard.
 *
 * Every check is expressed so that an EMPTY catalog passes it. A check that
 * fails on an empty database is a check that cannot be used in a pipeline
 * that builds the catalog from nothing.
 */

export const PROVENANCE_TIERS = ["certified", "manufacturer", "unverified"] as const;
export const PRICE_EVIDENCE_KINDS = ["retail", "manufacturer", "review"] as const;

/**
 * The one source allowed to publish a price without a source URL.
 *
 * The reference dataset is uncited by construction - it is our own
 * transcription of published configurations - so its prices are labelled a
 * reference value rather than a quote. Every other source must cite a page.
 */
export const REFERENCE_SOURCE = "Veridian reference dataset";

export type ContractSeverity = "error" | "warning" | "info";

export interface ContractFinding {
  id: string;
  severity: ContractSeverity;
  count: number;
  message: string;
  samples: string[];
}

export interface ContractCheck {
  id: string;
  severity: ContractSeverity;
  message: string;
  run: (prisma: PrismaClient) => Promise<{ count: number; samples: string[] }>;
}

/** Every check, in the order they should be reported. */
export const CONTRACT_CHECKS: ContractCheck[] = [
  {
    id: "provenance/unknown-tier",
    severity: "error",
    message: "Configurations whose provenance tier is not one the product knows about",
    async run(prisma) {
      const rows = await prisma.sku.findMany({
        where: { provenance: { notIn: [...PROVENANCE_TIERS] } },
        select: { skuCode: true, provenance: true },
      });
      return {
        count: rows.length,
        samples: rows.slice(0, 10).map((r) => `${r.skuCode} (${r.provenance})`),
      };
    },
  },
  {
    id: "provenance/no-source",
    severity: "error",
    message: "Configurations with no source record at all",
    async run(prisma) {
      const rows = await prisma.sku.findMany({
        where: { sources: { none: {} } },
        select: { skuCode: true, provenance: true },
      });
      return {
        count: rows.length,
        samples: rows.slice(0, 10).map((r) => `${r.skuCode} (${r.provenance})`),
      };
    },
  },
  {
    id: "provenance/certified-without-citation",
    severity: "error",
    message: "Certified configurations with no certified source that names a page",
    async run(prisma) {
      const rows = await prisma.sku.findMany({
        where: { provenance: "certified" },
        select: {
          skuCode: true,
          sources: { select: { kind: true, sourceUrl: true } },
        },
      });
      const offenders = rows.filter(
        (row) =>
          !row.sources.some(
            (source) => source.kind === "certified" && !!source.sourceUrl
          )
      );
      return {
        count: offenders.length,
        samples: offenders.slice(0, 10).map((r) => r.skuCode),
      };
    },
  },
  {
    id: "provenance/tier-understated",
    severity: "error",
    message:
      "Configurations filed as unverified that carry a certified source, or the reverse",
    async run(prisma) {
      const rows = await prisma.sku.findMany({
        select: { skuCode: true, provenance: true, sources: { select: { kind: true } } },
      });
      const offenders = rows.filter((row) => {
        const kinds = new Set(row.sources.map((source) => source.kind));
        if (row.provenance === "unverified" && kinds.has("certified")) return true;
        if (row.provenance === "certified" && !kinds.has("certified")) return true;
        return false;
      });
      return {
        count: offenders.length,
        samples: offenders.slice(0, 10).map((r) => `${r.skuCode} (${r.provenance})`),
      };
    },
  },
  {
    id: "provenance/uncited-price",
    severity: "warning",
    message:
      "Price observations published without a source URL, from a source that is not the reference dataset",
    async run(prisma) {
      const rows = await prisma.priceObservation.findMany({
        where: { sourceUrl: null, sourceName: { not: REFERENCE_SOURCE } },
        select: { sourceName: true, sku: { select: { skuCode: true } } },
      });
      return {
        count: rows.length,
        samples: rows.slice(0, 10).map((r) => `${r.sku.skuCode} · ${r.sourceName}`),
      };
    },
  },
  {
    id: "price/unknown-evidence",
    severity: "error",
    message: "Price observations whose evidence class is not one the product knows about",
    async run(prisma) {
      const rows = await prisma.priceObservation.findMany({
        where: { kind: { notIn: [...PRICE_EVIDENCE_KINDS] } },
        select: { kind: true, sku: { select: { skuCode: true } } },
      });
      return {
        count: rows.length,
        samples: rows.slice(0, 10).map((r) => `${r.sku.skuCode} (${r.kind})`),
      };
    },
  },
  {
    id: "price/snapshot-without-observation",
    severity: "warning",
    message:
      "Regional price snapshots with no matching price observation, so the number a reader sees has no history",
    async run(prisma) {
      const rows = await prisma.skuRegionalPricing.findMany({
        select: { skuId: true, region: true, currency: true, msrp: true },
      });
      const offenders: string[] = [];
      for (const row of rows) {
        const observation = await prisma.priceObservation.findFirst({
          where: {
            skuId: row.skuId,
            region: row.region,
            currency: row.currency,
            price: row.msrp,
          },
          select: { id: true },
        });
        if (!observation) {
          const sku = await prisma.sku.findUnique({
            where: { id: row.skuId },
            select: { skuCode: true },
          });
          offenders.push(`${sku?.skuCode ?? row.skuId} · ${row.region} · ${row.currency}`);
        }
      }
      return { count: offenders.length, samples: offenders.slice(0, 10) };
    },
  },
  {
    id: "observation/rejected-without-reason",
    severity: "error",
    message: "Rejected source observations kept without their reason",
    async run(prisma) {
      const rows = await prisma.rawObservation.findMany({
        where: { status: "rejected" },
        select: { errors: true },
      });
      const offenders = rows.filter((row) => !row.errors || row.errors.length === 0);
      return { count: offenders.length, samples: [] };
    },
  },
  {
    id: "observation/accepted-without-payload",
    severity: "error",
    message: "Accepted source observations kept without the payload they were derived from",
    async run(prisma) {
      const rows = await prisma.rawObservation.findMany({
        where: { status: "accepted" },
        select: { payload: true, payloadHash: true },
      });
      const offenders = rows.filter(
        (row) =>
          !row.payload ||
          row.payload.length === 0 ||
          !/^[0-9a-f]{64}$/.test(row.payloadHash)
      );
      return { count: offenders.length, samples: [] };
    },
  },
  {
    id: "graph/dangling-component-link",
    severity: "error",
    message: "Component links pointing at a component that does not exist",
    async run(prisma) {
      const componentIds = new Set(
        (await prisma.component.findMany({ select: { id: true } })).map((c) => c.id)
      );
      const links = await prisma.skuComponent.findMany({
        select: { componentId: true, sku: { select: { skuCode: true } } },
      });
      const offenders = links.filter((link) => !componentIds.has(link.componentId));
      return {
        count: offenders.length,
        samples: offenders.slice(0, 10).map((l) => l.sku.skuCode),
      };
    },
  },
  {
    id: "catalog/dangling-series",
    severity: "error",
    message: "Visible configurations whose model does not resolve to a series",
    async run(prisma) {
      const rows = await prisma.sku.findMany({
        where: { catalogVisible: true },
        select: { skuCode: true, model: { select: { seriesId: true } } },
      });
      const offenders = rows.filter((row) => !row.model?.seriesId);
      return {
        count: offenders.length,
        samples: offenders.slice(0, 10).map((r) => r.skuCode),
      };
    },
  },
  {
    id: "catalog/certified-without-part-number",
    severity: "warning",
    message: "Certified configurations with no manufacturer part number",
    async run(prisma) {
      const rows = await prisma.sku.findMany({
        where: { provenance: "certified", OR: [{ mpn: null }, { mpn: "" }] },
        select: { skuCode: true },
      });
      return {
        count: rows.length,
        samples: rows.slice(0, 10).map((r) => r.skuCode),
      };
    },
  },
];

/** Run every contract check and return the findings. */
export async function runContractChecks(
  prisma: PrismaClient
): Promise<ContractFinding[]> {
  const findings: ContractFinding[] = [];
  for (const check of CONTRACT_CHECKS) {
    try {
      const { count, samples } = await check.run(prisma);
      findings.push({
        id: check.id,
        severity: check.severity,
        count,
        message: check.message,
        samples,
      });
    } catch (error) {
      findings.push({
        id: check.id,
        severity: "error",
        count: 1,
        message: `The check could not run: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
        samples: [],
      });
    }
  }
  return findings;
}
