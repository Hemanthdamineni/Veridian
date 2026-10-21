import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual, generateApiKey } from "@/lib/api-key";
import {
  KEY_SELECT,
  encodeScopes,
  listApiKeys,
  toKeyView,
  validateKeyInput,
} from "@/lib/admin-keys";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * API key management.
 *
 * GET  /api/admin/keys      list the issued keys
 * POST /api/admin/keys      issue a new key
 *
 * A key is shown to its owner once and never again: only its SHA-256 hash is
 * stored, so a database leak does not hand over working credentials. No
 * response from this file ever contains a hash.
 *
 * Both routes are admin-authenticated. The middleware already protects every
 * `/api/admin/*` path; the guard below is a second, independent check so the
 * endpoint stays unreachable even if the matcher is narrowed later. The
 * comparison itself is the shared `constantTimeEqual` from the key library.
 */
function isAdmin(request: NextRequest): boolean {
  const expected = process.env.ADMIN_TOKEN ?? "";
  if (!expected) return false;

  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? "";
  const cookie = request.cookies.get("admin_session")?.value ?? "";
  const presented = bearer || cookie;
  if (!presented) return false;

  return constantTimeEqual(expected, presented);
}

function unauthorized(): NextResponse {
  return NextResponse.json(
    { error: "Unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="admin"' } }
  );
}

/**
 * GET /api/admin/keys
 *
 * Lists the issued keys with their name, scopes, rate limit, last use and
 * expiry, plus the usage of the current hourly window. The key hash is never
 * included.
 */
export async function GET(request: NextRequest) {
  const expected = process.env.ADMIN_TOKEN ?? "";
  if (!expected) {
    return NextResponse.json(
      { error: "ADMIN_TOKEN is not configured; key management is disabled." },
      { status: 503 }
    );
  }
  if (!isAdmin(request)) return unauthorized();

  try {
    const { keys, windowStart } = await listApiKeys();
    return NextResponse.json({ keys, windowStart });
  } catch (error) {
    console.error("Error listing API keys:", error);
    return NextResponse.json({ error: "Failed to list the API keys" }, { status: 500 });
  }
}

/**
 * POST /api/admin/keys
 *
 * Issues a new key. The plaintext key is returned once, in this response
 * only, and is never stored: the database keeps its SHA-256 hash.
 */
export async function POST(request: NextRequest) {
  const expected = process.env.ADMIN_TOKEN ?? "";
  if (!expected) {
    return NextResponse.json(
      { error: "ADMIN_TOKEN is not configured; key management is disabled." },
      { status: 503 }
    );
  }
  if (!isAdmin(request)) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const validation = validateKeyInput(body);
  if (!validation.valid) {
    return NextResponse.json(
      { error: "Validation failed", details: validation.errors },
      { status: 400 }
    );
  }

  const { key, hash } = generateApiKey();
  const { name, scopes, rateLimit, expiresInDays } = validation.value;

  try {
    const record = await prisma.apiKey.create({
      data: {
        name,
        keyHash: hash,
        scopes: encodeScopes(scopes, false),
        rateLimit,
        expiresAt:
          expiresInDays > 0 ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null,
      },
      select: KEY_SELECT,
    });

    return NextResponse.json(
      {
        key,
        warning: "This key is shown once and cannot be recovered. Store it now.",
        record: toKeyView(record, 0),
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error issuing an API key:", error);
    return NextResponse.json({ error: "Failed to issue the API key" }, { status: 500 });
  }
}
