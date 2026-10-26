/**
 * Keep the documented numbers honest.
 *
 * `README.md`, `ROADMAP.md`, `TODO.md` and the engineering documents quote
 * counts: how many configurations the catalog holds, how many tests pass,
 * how many routes the build produces. Every one of those numbers was once
 * written by hand, and every one of them drifted the moment the code moved.
 *
 * This script is the fix, and it is the same shape as the schema-parity
 * check: the numbers are *generated* from what is measured, and a check mode
 * fails when the documented value no longer matches.
 *
 *   npm run docs:metrics          rewrite the documented numbers
 *   npm run docs:metrics:check    fail when a documented number is stale
 *
 * The catalog figures come from `docs/metrics.json`, which `--write`
 * refreshes from the live database (and which the PostgreSQL CI job
 * regenerates). The code figures (model count, routes, test counts) are
 * recomputed here from the filesystem and the test suites, so a change in the
 * code is caught even when no database is attached.
 *
 * Read-only with respect to the catalog. `--write` edits only the documents
 * named in RULES.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(WEB_ROOT, "..");
const METRICS_PATH = path.join(REPO_ROOT, "docs", "metrics.json");

type MetricKey =
  | "catalogSkus"
  | "certified"
  | "manufacturerTier"
  | "unverified"
  | "manufacturers"
  | "series"
  | "models"
  | "rawObservations"
  | "rejectedObservations"
  | "certifiedSpecs"
  | "components"
  | "skuComponentLinks"
  | "webTests"
  | "pythonTests"
  | "schemaModels"
  | "routeHandlers"
  | "pages"
  | "buildRoutes";

interface Rule {
  /** Repository-relative document the number is written in. */
  file: string;
  /** The metric the number must equal. */
  metric: MetricKey;
  /**
   * Matches the line that states the number. Exactly one capture group, the
   * number itself, which may carry thousands separators. The rule must match
   * exactly once in the file — a rule that matches nothing, or matches twice,
   * is a broken rule and is reported as one.
   */
  pattern: RegExp;
  /** Extra capture groups are ignored; this selects which one is the value. */
  group?: number;
}

/**
 * Every documented number that must be true.
 *
 * If a document stops quoting one of these, the rule fails loudly rather than
 * silently passing — a stale rule is the same defect as a stale number.
 */
const RULES: Rule[] = [
  // ---------------------------------------------------------------- README
  {
    file: "README.md",
    metric: "certified",
    pattern: /\| \*\*Certified\*\* \| ([\d,]+) \|/,
  },
  {
    file: "README.md",
    metric: "manufacturerTier",
    pattern: /\| \*\*Manufacturer\*\* \| ([\d,]+) \|/,
  },
  {
    file: "README.md",
    metric: "unverified",
    pattern: /\| \*\*Unverified\*\* \| ([\d,]+) \|/,
  },

  // --------------------------------------------------------------- ROADMAP
  {
    file: "ROADMAP.md",
    metric: "catalogSkus",
    pattern: /catalog holds \*\*([\d,]+) laptop/,
  },
  {
    file: "ROADMAP.md",
    metric: "manufacturers",
    pattern: /configurations across (\d+) manufacturers\*\*/,
  },
  {
    file: "ROADMAP.md",
    metric: "certified",
    pattern: /\| Certified \| ([\d,]+) \|/,
  },
  {
    file: "ROADMAP.md",
    metric: "manufacturerTier",
    pattern: /\| Manufacturer \| ([\d,]+) \|/,
  },
  {
    file: "ROADMAP.md",
    metric: "unverified",
    pattern: /\| Unverified \| ([\d,]+) \|/,
  },
  {
    file: "ROADMAP.md",
    metric: "rawObservations",
    pattern: /db:audit`\):\*\* ([\d,]+) raw source observations/,
  },
  {
    file: "ROADMAP.md",
    metric: "rejectedObservations",
    pattern: /stored \((\d+) of them rejected/,
  },
  {
    file: "ROADMAP.md",
    metric: "certifiedSpecs",
    pattern: /([\d,]+)\ncertification records/,
  },
  {
    file: "ROADMAP.md",
    metric: "components",
    pattern: /· ([\d,]+) shared components with [\d,]+ configuration links ·/,
  },
  {
    file: "ROADMAP.md",
    metric: "skuComponentLinks",
    pattern: /· [\d,]+ shared components with ([\d,]+) configuration links ·/,
  },
  {
    file: "ROADMAP.md",
    metric: "webTests",
    pattern: /(\d+) web tests · [\d,]+ Python tests · [\d,]+ build routes/,
  },
  {
    file: "ROADMAP.md",
    metric: "pythonTests",
    pattern: /[\d,]+ web tests · (\d+) Python tests · [\d,]+ build routes/,
  },
  {
    file: "ROADMAP.md",
    metric: "buildRoutes",
    pattern: /[\d,]+ web tests · [\d,]+ Python tests · (\d+) build routes/,
  },
  {
    file: "ROADMAP.md",
    metric: "catalogSkus",
    pattern: /the catalog is at ([\d,]+)/,
  },
  {
    file: "ROADMAP.md",
    metric: "components",
    pattern: /knowledge graph ✅ — ([\d,]+) shared components, [\d,]+ links,/,
  },
  {
    file: "ROADMAP.md",
    metric: "skuComponentLinks",
    pattern: /knowledge graph ✅ — [\d,]+ shared components, ([\d,]+) links,/,
  },
  {
    file: "ROADMAP.md",
    metric: "catalogSkus",
    pattern: /Holding \(([\d,]+) configurations\)/,
  },

  // ------------------------------------------------------------------ TODO
  {
    file: "TODO.md",
    metric: "catalogSkus",
    pattern: /\| Configurations in the catalog \| ([\d,]+) \|/,
  },
  {
    file: "TODO.md",
    metric: "certified",
    pattern: /\| Certified configurations \(cited source\) \| ([\d,]+) \|/,
  },
  {
    file: "TODO.md",
    metric: "manufacturerTier",
    pattern: /\(cited page\) \| ([\d,]+) \|/,
  },
  {
    file: "TODO.md",
    metric: "unverified",
    pattern: /\| Unverified configurations \(no citation\) \| ([\d,]+) \|/,
  },
  {
    file: "TODO.md",
    metric: "manufacturers",
    pattern: /\| Manufacturers \| ([\d,]+) \|/,
  },
  {
    file: "TODO.md",
    metric: "series",
    pattern: /\| Product families \(series\) \| ([\d,]+) \|/,
  },
  {
    file: "TODO.md",
    metric: "models",
    pattern: /\| Models \| ([\d,]+) \|/,
  },
  {
    file: "TODO.md",
    metric: "rawObservations",
    pattern: /\| Raw source observations stored \| ([\d,]+) \|/,
  },
  {
    file: "TODO.md",
    metric: "rejectedObservations",
    pattern: /\| Source rows rejected, with reasons \| ([\d,]+) \|/,
  },
  {
    file: "TODO.md",
    metric: "components",
    pattern: /\| Shared components \| ([\d,]+) \|/,
  },
  {
    file: "TODO.md",
    metric: "skuComponentLinks",
    pattern: /Configuration ↔ component links \| ([\d,]+) \|/,
  },
  {
    file: "TODO.md",
    metric: "webTests",
    pattern: /\| Web test suites \| ([\d,]+) passing/,
  },
  {
    file: "TODO.md",
    metric: "pythonTests",
    pattern: /\| Python test suite \| ([\d,]+) passing/,
  },
  {
    file: "TODO.md",
    metric: "buildRoutes",
    pattern: /\| Build routes \| ([\d,]+) \|/,
  },
  {
    file: "TODO.md",
    metric: "certifiedSpecs",
    pattern: /Task 2\.6\.4:\*\* ([\d,]+) accepted/,
  },
  {
    file: "TODO.md",
    metric: "catalogSkus",
    pattern: /the catalog is at ([\d,]+)\./,
  },

  // ----------------------------------------------------- engineering docs
  {
    file: "docs/engineering/architecture.md",
    metric: "buildRoutes",
    pattern: /React server components \| (\d+) routes \|/,
  },
  {
    file: "docs/engineering/architecture.md",
    metric: "webTests",
    pattern: /\| (\d+) web tests, [\d,]+ Python tests \|/,
  },
  {
    file: "docs/engineering/architecture.md",
    metric: "pythonTests",
    pattern: /\| [\d,]+ web tests, ([\d,]+) Python tests \|/,
  },
  {
    file: "docs/engineering/schema.md",
    metric: "schemaModels",
    pattern: /^(\d+) models, \d+ relational groups\.$/m,
  },
  {
    file: "docs/engineering/architecture.md",
    metric: "schemaModels",
    pattern: /the source of truth for all (\d+) models/,
  },
];

/** Format a metric the way the documents write it: thousands separators. */
function format(value: number): string {
  return value.toLocaleString("en-US");
}

/** Count the test cases the Vitest suite declares. */
function countWebTests(): number {
  const dir = path.join(WEB_ROOT, "tests");
  let total = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".test.ts")) continue;
    const source = fs.readFileSync(path.join(dir, name), "utf-8");
    const matches = source.match(/^\s*(?:it|test)\(/gm);
    total += matches ? matches.length : 0;
  }
  return total;
}

/** Count the tests pytest collects, using whichever interpreter is present. */
function countPythonTests(): number | null {
  const candidates = [
    path.join(REPO_ROOT, ".venv", "bin", "python"),
    "python3",
    "python",
  ];
  for (const python of candidates) {
    if (python.includes("/") && !fs.existsSync(python)) continue;
    const result = spawnSync(
      python,
      ["-m", "pytest", "--collect-only", "-q"],
      { cwd: REPO_ROOT, encoding: "utf-8" }
    );
    if (result.status !== 0) continue;
    const match = (result.stdout ?? "").match(/(\d+)\s+tests? collected/);
    if (match) return Number.parseInt(match[1], 10);
  }
  return null;
}

function countSchemaModels(): number {
  const schema = fs.readFileSync(
    path.join(WEB_ROOT, "prisma", "schema.prisma"),
    "utf-8"
  );
  return (schema.match(/^model /gm) ?? []).length;
}

function countFiles(dir: string, name: string): number {
  let total = 0;
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === name) total += 1;
    }
  };
  walk(dir);
  return total;
}

/**
 * Measure the catalog figures from a live database.
 *
 * This is the same query surface `db:audit` reads, so a documented number
 * and the audit number come from one store. When no database is reachable
 * the catalog figures are left to the recorded `docs/metrics.json`, and only
 * the code-side figures are measured — the PostgreSQL CI job is what keeps
 * the catalog numbers honest.
 */
async function measureCatalog(
  values: Partial<Record<MetricKey, number>>,
  live: MetricKey[]
): Promise<boolean> {
  if (!process.env.DATABASE_URL) return false;
  try {
    const dbModule = await import("../src/lib/db");
    const prisma = dbModule.prisma;
    await prisma.$connect();
    try {
      const [
        skus,
        certified,
        manufacturerTier,
        unverified,
        manufacturers,
        series,
        models,
        rawObservations,
        rejectedObservations,
        certifiedSpecs,
        components,
        skuComponentLinks,
      ] = await Promise.all([
        prisma.sku.count(),
        prisma.sku.count({ where: { provenance: "certified" } }),
        prisma.sku.count({ where: { provenance: "manufacturer" } }),
        prisma.sku.count({ where: { provenance: "unverified" } }),
        prisma.manufacturer.count(),
        prisma.series.count(),
        prisma.model.count(),
        prisma.rawObservation.count(),
        prisma.rawObservation.count({ where: { status: "rejected" } }),
        prisma.certifiedSkuSpec.count(),
        prisma.component.count(),
        prisma.skuComponent.count(),
      ]);
      Object.assign(values, {
        catalogSkus: skus,
        certified,
        manufacturerTier,
        unverified,
        manufacturers,
        series,
        models,
        rawObservations,
        rejectedObservations,
        certifiedSpecs,
        components,
        skuComponentLinks,
      });
      live.push(
        "catalogSkus",
        "certified",
        "manufacturerTier",
        "unverified",
        "manufacturers",
        "series",
        "models",
        "rawObservations",
        "rejectedObservations",
        "certifiedSpecs",
        "components",
        "skuComponentLinks"
      );
      return true;
    } finally {
      await prisma.$disconnect().catch(() => {});
    }
  } catch {
    return false;
  }
}

/** Measure what can be measured in this environment. */
async function measuredMetrics(): Promise<{
  values: Partial<Record<MetricKey, number>>;
  live: MetricKey[];
}> {
  const values: Partial<Record<MetricKey, number>> = {};
  const live: MetricKey[] = [];

  values.schemaModels = countSchemaModels();
  values.routeHandlers = countFiles(path.join(WEB_ROOT, "src", "app"), "route.ts");
  values.pages = countFiles(path.join(WEB_ROOT, "src", "app"), "page.tsx");
  // Every route handler and page the build compiles is a served route. This
  // is the filesystem truth; Next's route-table line count can differ by the
  // meta files (/_not-found, /icon.svg, /robots.txt, /sitemap.xml), which are
  // not application routes.
  values.buildRoutes = values.routeHandlers + values.pages;
  live.push("schemaModels", "routeHandlers", "pages", "buildRoutes");

  const web = countWebTests();
  if (web > 0) {
    values.webTests = web;
    live.push("webTests");
  }

  const python = countPythonTests();
  if (python !== null) {
    values.pythonTests = python;
    live.push("pythonTests");
  }

  await measureCatalog(values, live);

  return { values, live };
}

async function main() {
  const write = process.argv.includes("--write");
  const recorded: Record<string, number> = JSON.parse(
    fs.readFileSync(METRICS_PATH, "utf-8")
  );

  const { values: measured, live } = await measuredMetrics();
  const metrics: Record<string, number> = { ...recorded, ...measured };

  // The catalog figures only move when a database was measured. Refuse to
  // write a metrics file whose catalog figures were never recorded, so a
  // fresh clone cannot silently document zeros.
  if (write) {
    const missing = RULES.map((r) => r.metric).filter(
      (m) => typeof metrics[m] !== "number"
    );
    if (missing.length > 0) {
      console.error(
        `docs:metrics cannot write: no value recorded for ${[...new Set(missing)].join(", ")}.`
      );
      console.error(
        "Run `npm run db:audit` in an environment with the catalog loaded, then retry."
      );
      process.exitCode = 1;
      return;
    }
  }

  const failures: string[] = [];
  const edits = new Map<string, string>();

  for (const rule of RULES) {
    const abs = path.join(REPO_ROOT, rule.file);
    const original = edits.get(rule.file) ?? fs.readFileSync(abs, "utf-8");
    const group = rule.group ?? 1;
    const globalPattern = new RegExp(
      rule.pattern.source,
      rule.pattern.flags.includes("g") ? rule.pattern.flags : `${rule.pattern.flags}g`
    );

    const matches = [...original.matchAll(globalPattern)];
    if (matches.length !== 1) {
      failures.push(
        `${rule.file}: the rule for '${rule.metric}' matched ${matches.length} times (expected exactly 1) — ${rule.pattern}`
      );
      edits.set(rule.file, original);
      continue;
    }

    const documented = Number.parseInt(matches[0][group].replace(/,/g, ""), 10);
    const expected = metrics[rule.metric];

    if (documented === expected) {
      edits.set(rule.file, original);
      continue;
    }

    if (!write) {
      failures.push(
        `${rule.file}: documents ${rule.metric} as ${format(documented)}, but it is ${format(expected)}`
      );
      edits.set(rule.file, original);
      continue;
    }

    // Rewrite only this occurrence, preserving the rest of the document.
    const match = matches[0];
    const start = (match.index ?? 0) + match[0].indexOf(match[group]);
    const updated =
      original.slice(0, start) +
      format(expected) +
      original.slice(start + match[group].length);
    edits.set(rule.file, updated);
  }

  if (write && failures.length === 0) {
    for (const [file, content] of edits) {
      const abs = path.join(REPO_ROOT, file);
      if (fs.readFileSync(abs, "utf-8") !== content) {
        fs.writeFileSync(abs, content);
        console.log(`updated ${file}`);
      }
    }
    fs.writeFileSync(METRICS_PATH, `${JSON.stringify(metrics, null, 2)}\n`);
    console.log(`recorded docs/metrics.json`);
    console.log(
      `\nupdated ${RULES.length} documented figure(s) across ${new Set(RULES.map((r) => r.file)).size} document(s).`
    );
    return;
  }

  if (failures.length > 0) {
    console.error("The documented numbers do not match what is measured:\n");
    for (const failure of failures) console.error(`  ✗ ${failure}`);
    console.error(
      `\n${failures.length} stale figure(s). Run \`npm run docs:metrics\` to regenerate them.`
    );
    console.error(
      `Measured live in this environment: ${live.join(", ") || "nothing"}.`
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `All ${RULES.length} documented figures match the measured values (${new Set(RULES.map((r) => r.file)).size} documents).`
  );
}

main().catch((error) => {
  console.error("docs:metrics failed:", error);
  process.exitCode = 1;
});
