import { prisma } from "@/lib/db";

/**
 * Shared logic for the admin API-key workspace.
 *
 * The list route, the per-key route and the admin page all need to agree on
 * two things: what a key looks like when it is shown, and how a disabled key
 * is stored. They read both from here, so the three of them cannot drift
 * apart.
 *
 * A key is shown to its owner once and never again. Only its SHA-256 hash is
 * stored, so nothing in this module reads, returns or logs a hash.
 */

const ALLOWED_SCOPES = ["read", "write", "admin"] as const;

export const MAX_NAME_LENGTH = 120;
export const MAX_RATE_LIMIT = 100000;
export const MAX_EXPIRY_DAYS = 3650;

export type ApiKeyStatus = "active" | "disabled" | "expired";

export interface ApiKeyView {
  id: string;
  name: string;
  scopes: string[];
  rateLimit: number;
  status: ApiKeyStatus;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  /** Requests charged to this key in the current hourly window. */
  usageThisHour: number;
}

/**
 * How a disabled key is stored.
 *
 * The `ApiKey` model has no disabled flag, and `authenticateApiKey` grants
 * access when the stored scopes contain the requested scope. A disabled key is
 * therefore stored as a single scope string that cannot be mistaken for a
 * real scope: `disabled;read;write`. The public API splits that on commas,
 * so it sees one scope named `disabled;read;write` and grants nothing.
 *
 * The scopes the key had before it was disabled are kept after the marker,
 * so enabling it restores exactly what it was.
 */
const DISABLED_MARKER = "disabled;";

/** Split a stored scope string into the scopes it grants and its disabled state. */
export function decodeScopes(stored: string | null | undefined): {
  scopes: string[];
  disabled: boolean;
} {
  const raw = (stored ?? "").trim();
  if (!raw) return { scopes: [], disabled: false };

  if (raw.startsWith(DISABLED_MARKER)) {
    return {
      scopes: raw
        .slice(DISABLED_MARKER.length)
        .split(",")
        .map((scope) => scope.trim())
        .filter(Boolean),
      disabled: true,
    };
  }

  return {
    scopes: raw
      .split(",")
      .map((scope) => scope.trim())
      .filter(Boolean),
    disabled: false,
  };
}

/** Encode the scopes of a key, disabled or not. */
export function encodeScopes(scopes: string[], disabled: boolean): string {
  const clean = Array.from(new Set(scopes.map((scope) => scope.trim()).filter(Boolean)));
  return disabled ? `${DISABLED_MARKER}${clean.join(",")}` : clean.join(",");
}

/** The start of the current hourly rate-limit window. */
export function currentWindowStart(): Date {
  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);
  return windowStart;
}

/** The fields this module is allowed to read. `keyHash` is not among them. */
export const KEY_SELECT = {
  id: true,
  name: true,
  scopes: true,
  rateLimit: true,
  lastUsedAt: true,
  expiresAt: true,
  createdAt: true,
} as const;

export type KeyRecord = {
  id: string;
  name: string;
  scopes: string;
  rateLimit: number;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
};

/** Turn a stored key into the shape that is safe to display. */
export function toKeyView(record: KeyRecord, usageThisHour: number): ApiKeyView {
  const { scopes, disabled } = decodeScopes(record.scopes);
  const expired = record.expiresAt !== null && record.expiresAt.getTime() <= Date.now();

  return {
    id: record.id,
    name: record.name,
    scopes,
    rateLimit: record.rateLimit,
    status: disabled ? "disabled" : expired ? "expired" : "active",
    createdAt: record.createdAt.toISOString(),
    lastUsedAt: record.lastUsedAt ? record.lastUsedAt.toISOString() : null,
    expiresAt: record.expiresAt ? record.expiresAt.toISOString() : null,
    usageThisHour,
  };
}

/**
 * List every issued key with the usage of the current hourly window.
 *
 * The stored hash is never selected and never returned.
 */
export async function listApiKeys(): Promise<{ keys: ApiKeyView[]; windowStart: string }> {
  const windowStart = currentWindowStart();
  const windowEnd = new Date(windowStart.getTime() + 60 * 60 * 1000);

  const [records, usage] = await Promise.all([
    prisma.apiKey.findMany({
      select: KEY_SELECT,
      orderBy: { createdAt: "desc" },
    }),
    prisma.apiKeyUsage.groupBy({
      by: ["apiKeyId"],
      where: { windowStart: { gte: windowStart, lt: windowEnd } },
      _count: { _all: true },
    }),
  ]);

  const usageByKey = new Map(usage.map((row) => [row.apiKeyId, row._count._all]));

  return {
    keys: records.map((record) => toKeyView(record, usageByKey.get(record.id) ?? 0)),
    windowStart: windowStart.toISOString(),
  };
}

/**
 * The usage of one key in the current hourly window.
 *
 * The counter lives in the database, so several server instances share one
 * budget and a restart does not reset it.
 */
export async function usageInCurrentWindow(apiKeyId: string): Promise<number> {
  const windowStart = currentWindowStart();
  const windowEnd = new Date(windowStart.getTime() + 60 * 60 * 1000);

  const rows = await prisma.apiKeyUsage.groupBy({
    by: ["apiKeyId"],
    where: { apiKeyId, windowStart: { gte: windowStart, lt: windowEnd } },
    _count: { _all: true },
  });

  return rows[0]?._count._all ?? 0;
}

export interface KeyInput {
  name: string;
  scopes: string[];
  rateLimit: number;
  expiresInDays: number;
}

/** Validate the body of a key-creation request. */
export function validateKeyInput(body: unknown): {
  valid: boolean;
  errors: string[];
  value: KeyInput;
} {
  const errors: string[] = [];
  const input = (body ?? {}) as Record<string, unknown>;

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) errors.push("A name is required.");
  else if (name.length > MAX_NAME_LENGTH) {
    errors.push(`The name must be ${MAX_NAME_LENGTH} characters or fewer.`);
  }

  const rawScopes = Array.isArray(input.scopes) ? input.scopes : [];
  const scopes: string[] = [];
  for (const scope of rawScopes) {
    if (typeof scope !== "string") {
      errors.push("Every scope must be a string.");
      continue;
    }
    const value = scope.trim();
    if (!value) continue;
    if (!(ALLOWED_SCOPES as readonly string[]).includes(value)) {
      errors.push(`Unknown scope '${value}'. Allowed: ${ALLOWED_SCOPES.join(", ")}.`);
      continue;
    }
    if (!scopes.includes(value)) scopes.push(value);
  }
  if (scopes.length === 0) {
    errors.push(`At least one scope is required. Allowed: ${ALLOWED_SCOPES.join(", ")}.`);
  }

  const rateLimit = Number(input.rateLimit);
  if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > MAX_RATE_LIMIT) {
    errors.push(`The rate limit must be a whole number from 1 to ${MAX_RATE_LIMIT}.`);
  }

  const expiresInDays =
    input.expiresInDays === undefined || input.expiresInDays === null || input.expiresInDays === ""
      ? 0
      : Number(input.expiresInDays);
  if (!Number.isInteger(expiresInDays) || expiresInDays < 0 || expiresInDays > MAX_EXPIRY_DAYS) {
    errors.push(`The expiry must be a whole number of days from 0 to ${MAX_EXPIRY_DAYS}.`);
  }

  return {
    valid: errors.length === 0,
    errors,
    value: { name, scopes, rateLimit, expiresInDays },
  };
}
