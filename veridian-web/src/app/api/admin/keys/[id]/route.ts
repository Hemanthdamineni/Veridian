import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/api-key";
import { KEY_SELECT, decodeScopes, encodeScopes, toKeyView, usageInCurrentWindow } from "@/lib/admin-keys";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * A single issued API key.
 *
 * PATCH  /api/admin/keys/:id   disable or enable the key
 * DELETE /api/admin/keys/:id   revoke the key
 *
 * Revoking deletes the key and its usage history. Disabling is reversible:
 * the key stays in the database but grants no scope, so the public API
 * refuses it until it is enabled again.
 *
 * The stored hash is never selected and never returned.
 */

/**
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
 * PATCH /api/admin/keys/:id
 *
 * Body: `{ "enabled": boolean }`. Disabling a key removes every scope it
 * grants; enabling restores the scopes it had.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const expected = process.env.ADMIN_TOKEN ?? "";
  if (!expected) {
    return NextResponse.json(
      { error: "ADMIN_TOKEN is not configured; key management is disabled." },
      { status: 503 }
    );
  }
  if (!isAdmin(request)) return unauthorized();

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "The request body must be valid JSON." }, { status: 400 });
  }

  const enabled = (body as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json(
      { error: "The body must carry a boolean 'enabled' field." },
      { status: 400 }
    );
  }

  try {
    const record = await prisma.apiKey.findUnique({ where: { id }, select: KEY_SELECT });
    if (!record) {
      return NextResponse.json({ error: "No such API key." }, { status: 404 });
    }

    const { scopes, disabled } = decodeScopes(record.scopes);
    const nextDisabled = !enabled;

    if (nextDisabled !== disabled) {
      await prisma.apiKey.update({
        where: { id },
        data: { scopes: encodeScopes(scopes, nextDisabled) },
      });
    }

    return NextResponse.json({
      record: toKeyView(
        { ...record, scopes: encodeScopes(scopes, nextDisabled) },
        await usageInCurrentWindow(record.id)
      ),
    });
  } catch (error) {
    console.error("Error updating an API key:", error);
    return NextResponse.json({ error: "Failed to update the API key" }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/keys/:id
 *
 * Revokes the key for good. The record and its usage history are removed.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const expected = process.env.ADMIN_TOKEN ?? "";
  if (!expected) {
    return NextResponse.json(
      { error: "ADMIN_TOKEN is not configured; key management is disabled." },
      { status: 503 }
    );
  }
  if (!isAdmin(request)) return unauthorized();

  const { id } = await params;

  try {
    const existing = await prisma.apiKey.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "No such API key." }, { status: 404 });
    }

    await prisma.apiKey.delete({ where: { id } });

    return NextResponse.json({ revoked: true, id: existing.id, name: existing.name });
  } catch (error) {
    console.error("Error revoking an API key:", error);
    return NextResponse.json({ error: "Failed to revoke the API key" }, { status: 500 });
  }
}
