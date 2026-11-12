import { readFileSync } from "node:fs";
import { join } from "node:path";
import { UNVERIFIABLE_SKUS } from "../src/lib/verify/reasons";

/**
 * Verify the manufacturer specification registry (Epic 2.9, §6.3).
 *
 * The registry is `data/verify-sources.csv` — the list of SKU codes that
 * carry a `spec_url` pointing at a manufacturer spec page. The invariants
 * below make sure the registry and the reference dataset can never silently
 * drift apart:
 *
 *   G1  Every registered `spec_url` is a well-formed https:// URL on a known
 *       manufacturer host (so the registry never points at a stranger's site).
 *   G2  Every registered `sku_code` exists in `data/laptops.csv` (so a
 *       registry entry always describes a real configuration).
 *   G3  A configuration that is not independently verified is either
 *       registered here or documented in `UNVERIFIABLE_SKUS` with a
 *       machine-readable reason — OR its manufacturer now has a verification
 *       adapter (ASUS, Lenovo, Dell, HP), which is the coverage that Epic 2.9
 *       adds. A row that is none of those is unexplained residue.
 *   G4  Any violation above makes this script exit non-zero, so the CI gate
 *       fails rather than letting the registry rot.
 *
 * Everything is read from saved files; this never touches the network, so it
 * is safe to run on every push.
 */

/** Manufacturers with a spec-page adapter wired into `parseSpecTable`. */
const ADAPTER_MANUFACTURERS = new Set([
  "ASUS",
  "APPLE",
  "LENOVO",
  "DELL",
  "HP",
]);

/** Host suffixes that may own a spec_url in the registry. */
const KNOWN_MFR_HOSTS = [
  "asus.com",
  "apple.com",
  "lenovo.com",
  "psref.lenovo.com",
  "dell.com",
  "hp.com",
];

/** Parse a simple (unquoted) CSV into header-keyed records. */
function parseCsvRecords(text: string): Array<Record<string, string>> {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"));
  if (lines.length === 0) return [];
  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = line.split(",").map((c) => c.trim());
    const record: Record<string, string> = {};
    header.forEach((h, i) => {
      record[h] = cells[i] ?? "";
    });
    return record;
  });
}

/** Does `host` belong to one of the known manufacturer hosts? */
function isKnownMfrHost(host: string): boolean {
  const h = host.toLowerCase();
  return KNOWN_MFR_HOSTS.some((known) => h === known || h.endsWith(`.${known}`));
}

/** A spec_url is well-formed only when it is https on a known host. */
function validSpecUrl(raw: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  return parsed.protocol === "https:" && isKnownMfrHost(parsed.hostname);
}

/** Is a manufacturer covered by an adapter or an unverifiable reason? */
function isExplained(manufacturer: string, skuCode: string): boolean {
  if (ADAPTER_MANUFACTURERS.has(manufacturer.toUpperCase())) return true;
  return skuCode in UNVERIFIABLE_SKUS;
}

export function verifyRegistry(
  registry: Array<Record<string, string>>,
  reference: Array<Record<string, string>>
): {
  g1: string[];
  g2: string[];
  g3: string[];
  ok: boolean;
} {
  const g1: string[] = [];
  const g2: string[] = [];
  const g3: string[] = [];

  const referenceSkus = new Set(
    reference.map((r) => r.sku_code).filter((s) => s.length > 0)
  );
  const registrySkus = new Set(
    registry.map((r) => r.sku_code).filter((s) => s.length > 0)
  );

  // G1 — every spec_url is well-formed https on a known host.
  for (const row of registry) {
    if (!row.spec_url || row.spec_url.length === 0) continue;
    if (!validSpecUrl(row.spec_url)) {
      g1.push(`${row.sku_code} → ${row.spec_url}`);
    }
  }

  // G2 — every registered sku_code exists in the reference dataset.
  for (const sku of registrySkus) {
    if (!referenceSkus.has(sku)) {
      g2.push(sku);
    }
  }

  // G3 — no unexplained unverified residue in the reference dataset.
  for (const row of reference) {
    const verified = row.verified?.toLowerCase() === "true";
    if (verified) continue;
    if (!row.sku_code) continue;
    if (registrySkus.has(row.sku_code)) continue;
    if (isExplained(row.manufacturer ?? "", row.sku_code)) continue;
    g3.push(`${row.sku_code} (${row.manufacturer})`);
  }

  return { g1, g2, g3, ok: g1.length === 0 && g2.length === 0 && g3.length === 0 };
}

function main(): void {
  const dataDir = join(process.cwd(), "data");
  const registry = parseCsvRecords(
    readFileSync(join(dataDir, "verify-sources.csv"), "utf8")
  );
  const reference = parseCsvRecords(
    readFileSync(join(dataDir, "laptops.csv"), "utf8")
  );

  const report = verifyRegistry(registry, reference);
  const lines = [
    `G1 bad spec_urls: ${report.g1.length}`,
    `G2 unknown sku_codes: ${report.g2.length}`,
    `G3 unexplained residue: ${report.g3.length}`,
  ];
  if (report.g1.length > 0) lines.push(`  ${report.g1.join("; ")}`);
  if (report.g2.length > 0) lines.push(`  ${report.g2.join("; ")}`);
  if (report.g3.length > 0) lines.push(`  ${report.g3.join("; ")}`);
  lines.push(report.ok ? "Manufacturer registry verified." : "Manufacturer registry has violations.");
  console.log(JSON.stringify({ ...report, registered: registry.length, reference: reference.length }, null, 2));

  if (!report.ok) process.exitCode = 1;
}

main();