import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import type { PrismaClient } from "@prisma/client";

/**
 * The database is replaced by a double: these tests are about the shape of
 * the responses and about who is allowed to ask for them, not about the
 * catalog. The catalog itself is exercised by the audit and the ingestion
 * suites.
 *
 * The double deliberately returns rows that still carry a key hash. The API
 * must not leak it, whatever the database hands back.
 */

const KEY_HASH = "9f2c1d0e5b6a4c8f7e3d1b2a9c0f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c";

const db = vi.hoisted(() => {
  const counter = (count: number) => ({
    count: vi.fn(async () => count),
    groupBy: vi.fn(async () => [] as unknown[]),
    findMany: vi.fn(async () => [] as unknown[]),
  });

  const sku = {
    ...counter(1165),
    groupBy: vi.fn(async (args?: { by?: string[] }) =>
      args?.by?.[0] === "provenance"
        ? [{ provenance: "certified", _count: { _all: 1122 } }]
        : []
    ),
  };

  const priceObservation = {
    ...counter(85),
    groupBy: vi.fn(async () => [] as unknown[]),
  };

  type Row = Record<string, unknown>;

  const initialRow = (): Row => ({
    id: "key-1",
    name: "Acme integration",
    keyHash: "9f2c1d0e5b6a4c8f7e3d1b2a9c0f8e7d6c5b4a39281706f5e4d3c2b1a09f8e7d6c",
    scopes: "read",
    rateLimit: 1000,
    lastUsedAt: new Date("2026-01-01T09:30:00.000Z"),
    expiresAt: null,
    createdAt: new Date("2026-01-01T09:00:00.000Z"),
  });

  const rows: Row[] = [initialRow()];

  const findRow = (id: unknown) => rows.find((row) => row.id === id);

  return {
    rows,
    reset() {
      rows.length = 0;
      rows.push(initialRow());
    },
    prisma: {
      sku,
      manufacturer: counter(36),
      series: counter(577),
      model: counter(999),
      certifiedSkuSpec: counter(1133),
      rawObservation: counter(1177),
      skuSource: counter(1165),
      priceObservation,
      skuRegionalPricing: counter(81),
      component: counter(477),
      skuComponent: counter(3359),
      seller: counter(0),
      retailerListing: counter(0),
      apiKey: {
        findMany: vi.fn(async () => rows.map((row) => ({ ...row }))),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
          const found = findRow(where.id);
          return found ? { ...found } : null;
        }),
        create: vi.fn(async ({ data }: { data: Row }) => {
          const row = { ...initialRow(), id: "key-new", ...data };
          rows.push(row);
          return { ...row };
        }),
        update: vi.fn(async ({ where, data }: { where: { id: string }; data: Row }) => {
          const row = findRow(where.id);
          if (row) Object.assign(row, data);
          return { ...row };
        }),
        delete: vi.fn(async ({ where }: { where: { id: string } }) => {
          const index = rows.findIndex((row) => row.id === where.id);
          if (index === -1) throw new Error("No such key");
          const [row] = rows.splice(index, 1);
          return { ...row };
        }),
      },
      apiKeyUsage: {
        groupBy: vi.fn(async () => [] as unknown[]),
        findMany: vi.fn(async () => [] as unknown[]),
      },
      $disconnect: vi.fn(async () => undefined),
    },
  };
});

vi.mock("@/lib/db", () => ({ prisma: db.prisma as unknown as PrismaClient }));

const { GET: getQuality } = await import("@/app/api/admin/quality/route");
const { GET: getKeys, POST: postKey } = await import("@/app/api/admin/keys/route");
const { PATCH: patchKey, DELETE: deleteKey } = await import("@/app/api/admin/keys/[id]/route");

const ADMIN_TOKEN = "the-right-token";

function request(path: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method: "GET",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function keyRequest(path: string, method: string, token?: string, body?: unknown): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** The route context Next.js hands to a dynamic route handler. */
function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("admin authentication", () => {
  const previousToken = process.env.ADMIN_TOKEN;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
  });

  afterEach(() => {
    if (previousToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previousToken;
  });

  it("rejects a quality request with no token", async () => {
    const response = await getQuality(request("/api/admin/quality"));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
    expect((await response.json()).error).toBe("Unauthorized");
  });

  it("rejects a quality request with the wrong token", async () => {
    const response = await getQuality(request("/api/admin/quality", "the-wrong-token"));
    expect(response.status).toBe(401);
  });

  it("rejects a quality request whose token is a prefix of the right one", async () => {
    const response = await getQuality(request("/api/admin/quality", ADMIN_TOKEN.slice(0, 8)));
    expect(response.status).toBe(401);
  });

  it("refuses to answer when no admin token is configured", async () => {
    delete process.env.ADMIN_TOKEN;
    const response = await getQuality(request("/api/admin/quality", "anything"));
    expect(response.status).toBe(503);
    expect((await response.json()).error).toMatch(/ADMIN_TOKEN/);
  });

  it("rejects a key list request with no token", async () => {
    const response = await getKeys(request("/api/admin/keys"));
    expect(response.status).toBe(401);
  });

  it("rejects a key update request with no token", async () => {
    const response = await patchKey(
      keyRequest("/api/admin/keys/key-1", "PATCH", undefined, { enabled: false }),
      context("key-1")
    );
    expect(response.status).toBe(401);
  });

  it("rejects a key revoke request with no token", async () => {
    const response = await deleteKey(
      keyRequest("/api/admin/keys/key-1", "DELETE"),
      context("key-1")
    );
    expect(response.status).toBe(401);
  });

  it("accepts the admin session cookie as well as a bearer token", async () => {
    const withCookie = new NextRequest("http://localhost/api/admin/quality", {
      method: "GET",
      headers: { cookie: `admin_session=${ADMIN_TOKEN}` },
    });
    const response = await getQuality(withCookie);
    expect(response.status).toBe(200);
  });

  it("accepts the admin session cookie for the key list too", async () => {
    const withCookie = new NextRequest("http://localhost/api/admin/keys", {
      method: "GET",
      headers: { cookie: `admin_session=${ADMIN_TOKEN}` },
    });
    const response = await getKeys(withCookie);
    expect(response.status).toBe(200);
  });
});

describe("GET /api/admin/quality", () => {
  const previousToken = process.env.ADMIN_TOKEN;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
  });

  afterEach(() => {
    if (previousToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previousToken;
  });

  it("answers an authenticated request", async () => {
    const response = await getQuality(request("/api/admin/quality", ADMIN_TOKEN));
    expect(response.status).toBe(200);
  });

  it("reports the id, severity and count of every check", async () => {
    const response = await getQuality(request("/api/admin/quality", ADMIN_TOKEN));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(Array.isArray(body.checks)).toBe(true);
    expect(body.checks.length).toBeGreaterThan(0);

    for (const check of body.checks) {
      expect(typeof check.id).toBe("string");
      expect(check.id.length).toBeGreaterThan(0);
      expect(["error", "warning", "info"]).toContain(check.severity);
      expect(typeof check.count).toBe("number");
      expect(Number.isInteger(check.count)).toBe(true);
      expect(check.count).toBeGreaterThanOrEqual(0);
      expect(typeof check.message).toBe("string");
      expect(Array.isArray(check.samples)).toBe(true);
    }
  });

  it("reports the checks the audit runs, under their audit ids", async () => {
    const response = await getQuality(request("/api/admin/quality", ADMIN_TOKEN));
    const body = await response.json();
    const ids = body.checks.map((check: { id: string }) => check.id);

    for (const id of [
      "provenance/unsupported-claim",
      "provenance/missing",
      "coverage/source-url",
      "coverage/source-url-allowlisted",
      "values/ram",
      "ingestion/rejected-without-reason",
      "components/no-alias",
    ]) {
      expect(ids).toContain(id);
    }
  });

  it("reports the catalog totals and the provenance split", async () => {
    const response = await getQuality(request("/api/admin/quality", ADMIN_TOKEN));
    const body = await response.json();

    expect(body.totals.skus).toBe(1165);
    expect(body.totals.manufacturers).toBe(36);
    expect(body.provenance).toEqual({ certified: 1122 });
    expect(body.generatedAt).toEqual(expect.any(String));
    expect(body.summary.totalChecks).toBe(body.checks.length);
  });

  it("counts a non-zero check as a gap rather than a pass", async () => {
    // The double reports 1165 rows for every count, so the check for rows
    // with no provenance record is failing. The summary must say so.
    const response = await getQuality(request("/api/admin/quality", ADMIN_TOKEN));
    const body = await response.json();

    const failing = body.checks.filter((check: { count: number }) => check.count > 0);
    expect(failing.length).toBeGreaterThan(0);
    expect(body.summary.failingChecks).toBe(failing.length);
    expect(body.summary.holdingChecks).toBe(body.checks.length - failing.length);
  });
});

describe("GET /api/admin/keys", () => {
  const previousToken = process.env.ADMIN_TOKEN;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
    db.reset();
  });

  afterEach(() => {
    if (previousToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previousToken;
  });

  it("lists the keys without ever returning a hash", async () => {
    const response = await getKeys(request("/api/admin/keys", ADMIN_TOKEN));
    expect(response.status).toBe(200);

    const text = await response.text();
    expect(text).not.toContain(KEY_HASH);
    expect(text).not.toContain("keyHash");
    expect(text).not.toContain("key_hash");
  });

  it("lists the name, scopes, rate limit, last use and expiry of a key", async () => {
    const response = await getKeys(request("/api/admin/keys", ADMIN_TOKEN));
    const body = await response.json();

    expect(body.keys).toHaveLength(1);
    const key = body.keys[0];
    expect(key.id).toBe("key-1");
    expect(key.name).toBe("Acme integration");
    expect(key.scopes).toEqual(["read"]);
    expect(key.rateLimit).toBe(1000);
    expect(key.lastUsedAt).toBe("2026-01-01T09:30:00.000Z");
    expect(key.expiresAt).toBeNull();
    expect(key.usageThisHour).toBe(0);
    expect(key.status).toBe("active");
    expect(Object.keys(key)).not.toContain("keyHash");
  });
});

describe("POST /api/admin/keys", () => {
  const previousToken = process.env.ADMIN_TOKEN;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
    db.reset();
  });

  afterEach(() => {
    if (previousToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previousToken;
  });

  it("returns the plaintext key once and never a hash", async () => {
    const response = await postKey(
      keyRequest("/api/admin/keys", "POST", ADMIN_TOKEN, {
        name: "New integration",
        scopes: ["read"],
        rateLimit: 500,
      })
    );
    expect(response.status).toBe(201);

    const text = await response.text();
    const body = JSON.parse(text);

    expect(typeof body.key).toBe("string");
    expect(body.key.startsWith("vk_")).toBe(true);
    expect(body.warning).toMatch(/once/i);
    expect(text).not.toContain(KEY_HASH);
    expect(text).not.toContain("keyHash");
  });

  it("stores only a hash of the issued key", async () => {
    await postKey(
      keyRequest("/api/admin/keys", "POST", ADMIN_TOKEN, {
        name: "New integration",
        scopes: ["read"],
        rateLimit: 500,
      })
    );

    const create = db.prisma.apiKey.create as unknown as {
      mock: { calls: Array<[{ data: { keyHash: string; name: string } }]> };
    };
    const stored = create.mock.calls[0][0].data.keyHash;
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses an unauthenticated request", async () => {
    const response = await postKey(
      keyRequest("/api/admin/keys", "POST", undefined, {
        name: "New integration",
        scopes: ["read"],
        rateLimit: 500,
      })
    );
    expect(response.status).toBe(401);
  });

  it("rejects a request with no scopes", async () => {
    const response = await postKey(
      keyRequest("/api/admin/keys", "POST", ADMIN_TOKEN, {
        name: "New integration",
        scopes: [],
        rateLimit: 500,
      })
    );
    expect(response.status).toBe(400);
  });
});

describe("PATCH and DELETE /api/admin/keys/:id", () => {
  const previousToken = process.env.ADMIN_TOKEN;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = ADMIN_TOKEN;
    db.reset();
  });

  afterEach(() => {
    if (previousToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previousToken;
  });

  it("disables a key so the list reports it as disabled, then enables it again", async () => {
    const disable = await patchKey(
      keyRequest("/api/admin/keys/key-1", "PATCH", ADMIN_TOKEN, { enabled: false }),
      context("key-1")
    );
    expect(disable.status).toBe(200);
    expect((await disable.json()).record.status).toBe("disabled");

    // The list route must agree with the update route about what "disabled"
    // means, and must keep the scopes the key had.
    const listed = await getKeys(request("/api/admin/keys", ADMIN_TOKEN));
    const body = await listed.json();
    expect(body.keys[0].status).toBe("disabled");
    expect(body.keys[0].scopes).toEqual(["read"]);

    const enable = await patchKey(
      keyRequest("/api/admin/keys/key-1", "PATCH", ADMIN_TOKEN, { enabled: true }),
      context("key-1")
    );
    expect((await enable.json()).record.status).toBe("active");

    const relisted = await getKeys(request("/api/admin/keys", ADMIN_TOKEN));
    const after = await relisted.json();
    expect(after.keys[0].status).toBe("active");
    expect(after.keys[0].scopes).toEqual(["read"]);
  });

  it("never returns a hash when a key is disabled", async () => {
    const response = await patchKey(
      keyRequest("/api/admin/keys/key-1", "PATCH", ADMIN_TOKEN, { enabled: false }),
      context("key-1")
    );
    const text = await response.text();
    expect(text).not.toContain(KEY_HASH);
    expect(text).not.toContain("keyHash");
  });

  it("rejects a body that does not say whether the key is enabled", async () => {
    const response = await patchKey(
      keyRequest("/api/admin/keys/key-1", "PATCH", ADMIN_TOKEN, { enabled: "yes" }),
      context("key-1")
    );
    expect(response.status).toBe(400);
  });

  it("reports a missing key as not found", async () => {
    const response = await patchKey(
      keyRequest("/api/admin/keys/no-such-key", "PATCH", ADMIN_TOKEN, { enabled: false }),
      context("no-such-key")
    );
    expect(response.status).toBe(404);
  });

  it("revokes a key for good", async () => {
    const response = await deleteKey(
      keyRequest("/api/admin/keys/key-1", "DELETE", ADMIN_TOKEN),
      context("key-1")
    );
    expect(response.status).toBe(200);
    expect((await response.json()).revoked).toBe(true);

    const listed = await getKeys(request("/api/admin/keys", ADMIN_TOKEN));
    expect((await listed.json()).keys).toHaveLength(0);
  });

  it("reports a missing key as not found when revoking", async () => {
    const response = await deleteKey(
      keyRequest("/api/admin/keys/no-such-key", "DELETE", ADMIN_TOKEN),
      context("no-such-key")
    );
    expect(response.status).toBe(404);
  });
});
