import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key";
import { recommend } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/**
 * Public API — recommendations.
 *
 * GET /api/v1/recommendations
 *
 * Every pick carries the reasons behind it, including the constraints the
 * scorer could not check.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("response" in auth) return auth.response;

  const search = request.nextUrl.searchParams;
  const number = (name: string): number | undefined => {
    const raw = search.get(name);
    if (raw === null || raw === "") return undefined;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  const result = await recommend({
    budget: number("budget"),
    currency: search.get("currency") ?? "USD",
    min_ram: number("min_ram"),
    preferred_size: number("preferred_size"),
    display_preference: (search.get("display") as "IPS" | "OLED" | "Mini-LED") ?? undefined,
    use_case: (search.get("use_case") as never) ?? undefined,
    max_weight: number("max_weight"),
    region: search.get("region") ?? "US",
    limit: Math.min(10, Math.max(1, number("limit") ?? 4)),
  });

  return NextResponse.json(result);
}
