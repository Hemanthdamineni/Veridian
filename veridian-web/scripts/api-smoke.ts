import { NextRequest } from "next/server";
import { prisma } from "../src/lib/db";
import { generateApiKey } from "../src/lib/api-key";
import { GET as index } from "@/app/api/v1/route";
import { GET as openapi } from "@/app/api/v1/openapi/route";
import { GET as skus } from "@/app/api/v1/skus/route";
import { GET as sku } from "@/app/api/v1/skus/[id]/route";
import { GET as manufacturers } from "@/app/api/v1/manufacturers/route";
import { GET as components } from "@/app/api/v1/components/route";
import { GET as component } from "@/app/api/v1/components/[slug]/route";
import { GET as recommendations } from "@/app/api/v1/recommendations/route";
import { GET as compare } from "@/app/api/v1/compare/route";

/**
 * A live smoke test of the public API.
 *
 * It issues a real key, calls every endpoint, and checks the rate limiter
 * actually stops a key that runs out of budget. It is not part of the unit
 * suite because it writes to the database.
 *
 * Usage: npm run db:api:smoke
 */

function request(path: string, key?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: key ? { "x-api-key": key } : {},
  });
}

async function main() {
  const { key, hash } = generateApiKey();
  await prisma.apiKey.create({
    data: { name: "smoke test", keyHash: hash, scopes: "read", rateLimit: 200 },
  });

  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail = "") => {
    console.log(`${ok ? "  ok  " : "  FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures.push(name);
  };

  // Public endpoints need no key.
  let response: Response = await index(request("/api/v1"));
  check("GET /api/v1 is public", response.status === 200);

  response = await openapi();
  const document = (await response.json()) as { paths?: Record<string, unknown> };
  check(
    "GET /api/v1/openapi describes the paths",
    response.status === 200 && Object.keys(document.paths ?? {}).length >= 7,
    `${Object.keys(document.paths ?? {}).length} paths`
  );

  // Everything else needs one.
  response = await skus(request("/api/v1/skus"));
  check("GET /api/v1/skus rejects a missing key", response.status === 401);

  response = await skus(request("/api/v1/skus?limit=3", key));
  const list = (await response.json()) as { results?: unknown[]; pagination?: { totalResults?: number } };
  check(
    "GET /api/v1/skus returns configurations",
    response.status === 200 && (list.results?.length ?? 0) > 0,
    `${list.results?.length ?? 0} of ${list.pagination?.totalResults ?? 0}`
  );

  const firstId = (list.results as Array<{ id: string }>)[0]?.id;
  response = await sku(request(`/api/v1/skus/${firstId}`, key), { params: Promise.resolve({ id: firstId }) });
  const detail = (await response.json()) as { provenance?: string; sources?: unknown[] };
  check(
    "GET /api/v1/skus/{id} returns provenance",
    response.status === 200 && typeof detail.provenance === "string" && (detail.sources?.length ?? 0) > 0,
    detail.provenance
  );

  response = await manufacturers(request("/api/v1/manufacturers", key));
  const makers = (await response.json()) as { results?: unknown[] };
  check("GET /api/v1/manufacturers returns manufacturers", response.status === 200 && (makers.results?.length ?? 0) > 0);

  response = await components(request("/api/v1/components?kind=cpu&limit=5", key));
  const parts = (await response.json()) as { results?: Array<{ slug: string }> };
  check("GET /api/v1/components returns components", response.status === 200 && (parts.results?.length ?? 0) > 0);

  const componentSlug = parts.results?.[0]?.slug;
  response = await component(
    request(`/api/v1/components/${componentSlug}`, key),
    { params: Promise.resolve({ slug: componentSlug ?? "" }) }
  );
  const graph = (await response.json()) as { configurations?: unknown[] };
  check(
    "GET /api/v1/components/{slug} returns the configurations that use it",
    response.status === 200 && (graph.configurations?.length ?? 0) > 0,
    `${graph.configurations?.length ?? 0} configurations`
  );

  response = await recommendations(request("/api/v1/recommendations?use_case=travel&limit=3", key));
  const recs = (await response.json()) as { recommendations?: unknown[] };
  check("GET /api/v1/recommendations returns picks", response.status === 200 && (recs.recommendations?.length ?? 0) > 0);

  const secondId = (list.results as Array<{ id: string }>)[1]?.id;
  response = await compare(
    request(`/api/v1/compare?ids=${firstId},${secondId}`, key),
  );
  check("GET /api/v1/compare compares two configurations", response.status === 200);

  // A separate key with a tiny budget, so the limiter can be exercised
  // without starving the calls above.
  const limited = generateApiKey();
  await prisma.apiKey.create({
    data: { name: "smoke test (limited)", keyHash: limited.hash, scopes: "read", rateLimit: 2 },
  });
  const statuses: number[] = [];
  for (let i = 0; i < 4; i++) {
    const response = await skus(request("/api/v1/skus?limit=1", limited.key));
    statuses.push(response.status);
  }
  check(
    "the rate limiter stops a key that runs out of budget",
    statuses.includes(429) && statuses.filter((s) => s === 200).length === 2,
    statuses.join(",")
  );

  // Clean up the keys we issued.
  await prisma.apiKey.deleteMany({ where: { keyHash: { in: [hash, limited.hash] } } });

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exitCode = 1;
    return;
  }
  console.log("\nAll public API checks passed.");
}

main()
  .catch((error) => {
    console.error("Public API smoke test failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
