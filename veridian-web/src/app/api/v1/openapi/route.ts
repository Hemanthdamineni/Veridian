import { NextResponse } from "next/server";
import { OPENAPI_DOCUMENT } from "@/lib/openapi";

export const dynamic = "force-dynamic";

/**
 * The OpenAPI description of the public API.
 *
 * GET /api/v1/openapi
 *
 * The document is public on purpose: a developer needs to read the contract
 * before they have a key.
 */
export async function GET() {
  return NextResponse.json(OPENAPI_DOCUMENT);
}
