import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { authenticateApiKey } from "@/lib/api-key";

export const dynamic = "force-dynamic";

/**
 * Public API — the shared component graph.
 *
 * GET /api/v1/components
 *
 * This is the question a flat specification table cannot answer: which
 * machines are built around this processor, this display class or this
 * storage technology.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("response" in auth) return auth.response;

  const kind = request.nextUrl.searchParams.get("kind") ?? undefined;
  const limit = Math.min(
    200,
    Math.max(1, Number(request.nextUrl.searchParams.get("limit") ?? 50) || 50)
  );

  const components = await prisma.component.findMany({
    where: kind ? { kind } : undefined,
    orderBy: { canonicalName: "asc" },
    take: limit,
    include: { _count: { select: { skus: true } } },
  });

  return NextResponse.json({
    results: components.map((component) => ({
      slug: component.slug,
      kind: component.kind,
      canonicalName: component.canonicalName,
      brand: component.brand,
      configurationCount: component._count.skus,
    })),
  });
}
