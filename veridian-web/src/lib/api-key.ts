import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Public API authentication and rate limiting.
 *
 * A key is shown to its owner once and never stored: only its SHA-256 hash
 * is kept, so a database leak does not hand over working credentials.
 *
 * Rate limiting is per key, per hour, and durable: the counter lives in the
 * database, so several server instances share one budget and a restart does
 * not reset it.
 */

const KEY_PREFIX = "vk_";

/** Generate a new key. The plaintext is returned once and never stored. */
export function generateApiKey(): { key: string; hash: string } {
  const key = `${KEY_PREFIX}${randomBytes(24).toString("base64url")}`;
  return { key, hash: hashApiKey(key) };
}

/** Hash a key for storage and lookup. */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  scopes: string[];
  rateLimit: number;
}

/**
 * Authenticate a request and charge it against the key's budget.
 *
 * Returns the key record on success, or a response to return to the caller
 * on failure. The caller must not proceed when a response is returned.
 */
export async function authenticateApiKey(
  request: NextRequest,
  requiredScope = "read"
): Promise<{ key: ApiKeyRecord } | { response: NextResponse }> {
  const presented =
    request.headers.get("x-api-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ??
    "";

  if (!presented) {
    return {
      response: NextResponse.json(
        {
          error: "unauthorized",
          message: "Provide an API key in the X-API-Key header or as a bearer token.",
        },
        { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="veridian-api"' } }
      ),
    };
  }

  const record = await prisma.apiKey.findUnique({
    where: { keyHash: hashApiKey(presented) },
    select: { id: true, name: true, scopes: true, rateLimit: true, expiresAt: true },
  });

  if (!record) {
    return {
      response: NextResponse.json(
        { error: "unauthorized", message: "That API key is not recognised." },
        { status: 401 }
      ),
    };
  }
  if (record.expiresAt && record.expiresAt.getTime() < Date.now()) {
    return {
      response: NextResponse.json(
        { error: "unauthorized", message: "That API key has expired." },
        { status: 401 }
      ),
    };
  }

  const scopes = record.scopes.split(",").map((s) => s.trim()).filter(Boolean);
  if (!scopes.includes(requiredScope) && !scopes.includes("admin")) {
    return {
      response: NextResponse.json(
        {
          error: "forbidden",
          message: `This key does not carry the '${requiredScope}' scope.`,
        },
        { status: 403 }
      ),
    };
  }

  // --- Rate limit ---------------------------------------------------------
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);

  const usage = await prisma.apiKeyUsage.upsert({
    where: { apiKeyId_windowStart: { apiKeyId: record.id, windowStart } },
    update: { count: { increment: 1 } },
    create: { apiKeyId: record.id, windowStart, count: 1 },
  });

  if (usage.count > record.rateLimit) {
    const resetAt = new Date(windowStart.getTime() + 60 * 60 * 1000);
    const retryAfter = Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000));
    return {
      response: NextResponse.json(
        {
          error: "rate_limited",
          message: `This key is limited to ${record.rateLimit} requests per hour.`,
          limit: record.rateLimit,
          resetAt: resetAt.toISOString(),
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfter),
            "X-RateLimit-Limit": String(record.rateLimit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": resetAt.toISOString(),
          },
        }
      ),
    };
  }

  await prisma.apiKey.update({
    where: { id: record.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    key: {
      id: record.id,
      name: record.name,
      scopes,
      rateLimit: record.rateLimit,
    },
  };
}

/**
 * Compare two strings in constant time.
 *
 * Used when a plaintext key has to be checked against a stored value, for
 * example during a smoke test of a newly issued key.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
