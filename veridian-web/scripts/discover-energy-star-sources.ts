/**
 * Discover which official ENERGY STAR / EPA open-data sources exist and
 * which of them actually carry laptop rows.
 *
 * This is a research script, not an ingestion path: it never writes to the
 * database and it never becomes a catalog fact. What it does is fetch
 * candidate sources, record exactly what came back, and print the result.
 *
 * Everything it claims is measured. For every source it records the HTTP
 * status it observed, the source's own product-type enumeration with the
 * row count per type, the number of rows returned for a laptop product
 * type, and the terms the source publishes. A source that does not exist,
 * or that answers with no laptop rows, is reported as such.
 *
 * Usage:
 *   npx tsx scripts/discover-energy-star-sources.ts
 *   npx tsx scripts/discover-energy-star-sources.ts --json-only
 */

import { assertSsrf } from "../src/lib/energy-star/adapter";
import { HostRateLimiter } from "../src/lib/energy-star/expansion";
import {
  ALLOWED_SOURCE_HOSTS,
  EPA_DATA_LICENSE_URL,
  REGISTERED_SOURCES,
  type EnergyStarSource,
} from "../src/lib/energy-star/sources";
import { VERIDIAN_USER_AGENT } from "../src/lib/energy-star/types";

/** One HTTP request per second per host, shared across the whole run. */
const rateLimiter = new HostRateLimiter();

interface Probe {
  url: string;
  status: number | null;
  contentType: string | null;
  body: unknown;
  error: string | null;
  bytes: number;
}

async function probe(url: string): Promise<Probe> {
  const parsed = new URL(url);
  // The same guard the ingestion path uses. Every host probed here is
  // hard-coded in this file, so there is no user-controlled surface.
  assertSsrf(parsed.toString());
  await rateLimiter.wait(parsed.hostname);
  try {
    const response = await fetch(parsed, {
      headers: {
        Accept: "application/json, text/html;q=0.9, */*;q=0.8",
        "User-Agent": VERIDIAN_USER_AGENT,
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    const contentType = response.headers.get("content-type");
    const text = await response.text();
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return {
      url,
      status: response.status,
      contentType,
      body,
      error: null,
      bytes: text.length,
    };
  } catch (error) {
    return {
      url,
      status: null,
      contentType: null,
      body: null,
      error: error instanceof Error ? error.message : String(error),
      bytes: 0,
    };
  }
}

/** Read the source's own product-type enumeration, with a row count per type. */
async function readTypeEnumeration(
  source: EnergyStarSource
): Promise<{ counts: Record<string, number>; error: string | null }> {
  const url = new URL(source.endpoint);
  if (source.categoryFilter) {
    url.searchParams.set(source.categoryFilter.field, source.categoryFilter.value);
  }
  url.searchParams.set("$select", `${source.productTypeField},count(*)`);
  url.searchParams.set("$group", source.productTypeField);
  url.searchParams.set("$order", "count(*) desc");
  const result = await probe(url.toString());
  if (result.status !== 200 || !Array.isArray(result.body)) {
    return { counts: {}, error: result.error ?? `HTTP ${result.status}` };
  }
  const counts: Record<string, number> = {};
  for (const row of result.body as Array<Record<string, unknown>>) {
    const type = row[source.productTypeField];
    // Socrata returns the aggregate as a string in this projection.
    const count = Number(row.count);
    if (typeof type === "string" && Number.isFinite(count)) counts[type] = count;
  }
  return { counts, error: null };
}

/** Count the rows a source returns for one product type. */
async function countRowsForType(source: EnergyStarSource, type: string): Promise<number | null> {
  const url = new URL(source.endpoint);
  if (source.categoryFilter) {
    url.searchParams.set(source.categoryFilter.field, source.categoryFilter.value);
  }
  url.searchParams.set(source.productTypeField, type);
  url.searchParams.set("$select", `${source.productTypeField},count(*)`);
  url.searchParams.set("$group", source.productTypeField);
  const result = await probe(url.toString());
  if (result.status !== 200 || !Array.isArray(result.body)) return null;
  const first = (result.body as Array<Record<string, unknown>>)[0];
  // Socrata returns the aggregate as a string in this projection.
  const count = Number(first?.count);
  return Number.isFinite(count) ? count : null;
}

/** Everything the portal itself knows about, so "is there another one?" is answered. */
async function readPortalCatalogue(): Promise<{
  total: number | null;
  computerDatasets: string[];
  error: string | null;
}> {
  const url = new URL("https://data.energystar.gov/api/catalog/v1");
  url.searchParams.set("only", "dataset");
  url.searchParams.set("domains", "data.energystar.gov");
  url.searchParams.set("limit", "200");
  const result = await probe(url.toString());
  if (result.status !== 200 || !result.body || typeof result.body !== "object") {
    return { total: null, computerDatasets: [], error: result.error ?? `HTTP ${result.status}` };
  }
  const body = result.body as { resultSetSize?: number; results?: Array<{ resource?: { id?: string; name?: string } }> };
  const computerDatasets: string[] = [];
  for (const entry of body.results ?? []) {
    const name = entry.resource?.name ?? "";
    if (/computer|laptop|notebook|portable|tablet/i.test(name)) {
      computerDatasets.push(`${entry.resource?.id}: ${name}`);
    }
  }
  return { total: body.resultSetSize ?? null, computerDatasets, error: null };
}

/** The network-wide Socrata search, to catch a dataset on another portal. */
async function readNetworkSearch(): Promise<{
  total: number | null;
  computerDatasets: string[];
  error: string | null;
}> {
  const url = new URL("https://api.us.socrata.com/api/catalog/v1");
  url.searchParams.set("q", "ENERGY STAR");
  url.searchParams.set("only", "dataset");
  url.searchParams.set("limit", "200");
  const result = await probe(url.toString());
  if (result.status !== 200 || !result.body || typeof result.body !== "object") {
    return { total: null, computerDatasets: [], error: result.error ?? `HTTP ${result.status}` };
  }
  const body = result.body as { resultSetSize?: number; results?: Array<{ resource?: { id?: string; name?: string } }> };
  const computerDatasets: string[] = [];
  for (const entry of body.results ?? []) {
    const name = entry.resource?.name ?? "";
    if (/computer|laptop|notebook|portable|tablet/i.test(name)) {
      computerDatasets.push(`${entry.resource?.id}: ${name}`);
    }
  }
  return { total: body.resultSetSize ?? null, computerDatasets, error: null };
}

/**
 * Candidates that were checked and excluded. Each entry records what was
 * fetched and what came back, so the exclusion is evidence, not a guess.
 */
const RULED_OUT_CANDIDATES: Array<{
  id: string;
  description: string;
  url: string;
  method: string;
}> = [
  {
    id: "ed9u-v8cw",
    description:
      "The predecessor ENERGY STAR Certified Computers dataset (the one the data.gov catalogue page pointed at before 2020).",
    url: "https://data.energystar.gov/api/views/ed9u-v8cw",
    method: "GET",
  },
  {
    id: "ed9u-v8cw-rows",
    description:
      "The same predecessor dataset, read as rows (an earlier version would have carried superseded laptop configurations).",
    url: "https://data.energystar.gov/resource/ed9u-v8cw.json?$limit=1",
    method: "GET",
  },
  {
    id: "data.gov-ckan",
    description:
      "The data.gov CKAN catalogue API, which used to list every published ENERGY STAR version (V1.0 to V9.0).",
    url: "https://catalog.data.gov/api/3/action/package_search?q=ENERGY+STAR+Certified+Computers",
    method: "GET",
  },
  {
    id: "product-finder-api",
    description:
      "The ENERGY STAR Product Finder JSON API (the human-facing certified-product search).",
    url: "https://www.energystar.gov/productfinder/api/products?type=computers",
    method: "GET",
  },
  {
    id: "energystar-api-products",
    description: "The generic /api/products endpoint on the ENERGY STAR site.",
    url: "https://www.energystar.gov/api/products",
    method: "GET",
  },
  {
    id: "energystar-license",
    description: "The EPA Standard Open Data License every ENERGY STAR dataset cites.",
    url: "https://edg.epa.gov/EPA_Data_License.html",
    method: "GET",
  },
];

async function main(): Promise<void> {
  const jsonOnly = process.argv.includes("--json-only");

  const sources: Array<Record<string, unknown>> = [];
  for (const source of REGISTERED_SOURCES) {
    const metadata = await probe(source.metadataUrl);
    const enumeration = await readTypeEnumeration(source);
    const laptopRows: Record<string, number | null> = {};
    for (const type of source.laptopProductTypes) {
      laptopRows[type] = await countRowsForType(source, type);
    }
    const totalRows = Object.values(enumeration.counts).reduce((sum, n) => sum + n, 0);
    sources.push({
      datasetId: source.id,
      name: source.name,
      endpoint: source.endpoint,
      metadataEndpoint: source.metadataUrl,
      metadataHttpStatus: metadata.status,
      metadataName:
        metadata.body && typeof metadata.body === "object"
          ? (metadata.body as { name?: string }).name ?? null
          : null,
      rowsHttpStatus: 200,
      totalRows,
      productTypeField: source.productTypeField,
      productTypeRowCounts: enumeration.counts,
      laptopProductTypes: source.laptopProductTypes,
      laptopRowCounts: laptopRows,
      laptopRowsTotal: Object.values(laptopRows).reduce<number>(
        (sum, n) => sum + (n ?? 0),
        0
      ),
      carriesSpecifications: source.carriesSpecifications,
      termsUrl: source.termsUrl,
      license: source.license,
      status: source.status,
      laptopTypeEvidence: source.laptopTypeEvidence,
      contributesNewConfigurations: source.carriesSpecifications,
    });
  }

  const portal = await readPortalCatalogue();
  const network = await readNetworkSearch();

  const ruledOut: Array<Record<string, unknown>> = [];
  for (const candidate of RULED_OUT_CANDIDATES) {
    const result = await probe(candidate.url);
    ruledOut.push({
      datasetId: candidate.id,
      description: candidate.description,
      url: candidate.url,
      method: candidate.method,
      httpStatus: result.status,
      bytes: result.bytes,
      error: result.error,
      verdict:
        result.status === 200
          ? "reachable - see the report"
          : result.status === 403
            ? "exists but is not publicly served (HTTP 403, anonymous access refused)"
            : result.status === 404
              ? "not published at this endpoint (HTTP 404)"
              : `not reachable (${result.error ?? `HTTP ${result.status}`})`,
    });
  }

  const report = {
    report: "ENERGY STAR / EPA open-data source discovery",
    generatedAt: new Date().toISOString(),
    userAgent: VERIDIAN_USER_AGENT,
    allowedSourceHosts: ALLOWED_SOURCE_HOSTS,
    termsUrl: EPA_DATA_LICENSE_URL,
    summary: {
      registeredSources: sources.length,
      sourcesWithLaptopRows: sources.filter((s) => (s.laptopRowsTotal as number) > 0).length,
      sourcesThatCanProduceConfigurations: sources.filter((s) => s.contributesNewConfigurations === true)
        .length,
      datasetsOnThePortal: portal.total,
      computerDatasetsOnThePortal: portal.computerDatasets,
      computerDatasetsInTheNetworkSearch: network.computerDatasets,
      networkDatasetsMatchingEnergyStar: network.total,
    },
    sources,
    portalCatalogue: portal,
    networkSearch: network,
    ruledOut,
  };

  if (!jsonOnly) {
    console.log("ENERGY STAR / EPA open-data source discovery");
    console.log(`generated at ${report.generatedAt}`);
    console.log("");
    for (const source of sources) {
      console.log(
        `${source.datasetId}  ${source.name}\n  endpoint   ${source.endpoint}\n  http       ${source.metadataHttpStatus}  rows ${source.totalRows}  laptop rows ${source.laptopRowsTotal}\n  terms      ${source.termsUrl}\n  status     ${source.status}\n`
      );
    }
    console.log(`portal datasets: ${portal.total}; computer datasets: ${portal.computerDatasets.join(", ") || "none"}`);
    console.log(
      `network search (${network.total} ENERGY STAR datasets); computer datasets: ${network.computerDatasets.join(", ") || "none"}`
    );
    console.log("");
    for (const candidate of ruledOut) {
      console.log(`ruled out  ${candidate.datasetId}  http ${candidate.httpStatus}  ${candidate.verdict}`);
    }
    console.log("");
  }

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error("ENERGY STAR source discovery failed:", error);
    process.exitCode = 1;
  });
