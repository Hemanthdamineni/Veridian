import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * The correction workflow, end to end, against a throwaway database.
 *
 * The rules these tests pin down are the ones the catalog depends on:
 * a report never changes a catalog row on its own, the review queue is
 * closed without an admin token, an accepted correction is recorded as a new
 * source with the previous value still on the record, the provenance tier of
 * a corrected row is not quietly promoted, and a vote is stored as a vote.
 */

const ADMIN_TOKEN = "test-admin-token";

let prisma: PrismaClient;
let tempDir: string;
let modelId: string;

type ContributionsRoute = typeof import("@/app/api/contributions/route");
type ContributionRoute = typeof import("@/app/api/contributions/[id]/route");
type AdminQueueRoute = typeof import("@/app/api/admin/contributions/route");
type AdminReviewRoute = typeof import("@/app/api/admin/contributions/[id]/route");

let contributionsRoute: ContributionsRoute;
let contributionRoute: ContributionRoute;
let adminQueueRoute: AdminQueueRoute;
let adminReviewRoute: AdminReviewRoute;

function postRequest(url: string, body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function getRequest(url: string, token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest(url, { headers });
}

/** The context Next.js hands a dynamic route handler. */
function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** Review one queued correction. */
function review(
  id: string,
  body: Record<string, unknown>,
  token?: string
): Promise<Response> {
  return adminReviewRoute.POST(
    postRequest(`http://localhost/api/admin/contributions/${id}`, body, token),
    context(id)
  );
}

/** Vote on one correction. */
function vote(id: string, body: Record<string, unknown>): Promise<Response> {
  return contributionRoute.POST(
    postRequest(`http://localhost/api/contributions/${id}`, body),
    context(id)
  );
}

let skuCounter = 0;

async function createSku(provenance = "certified") {
  skuCounter += 1;
  return prisma.sku.create({
    data: {
      modelId,
      skuCode: `TEST-X1-${String(skuCounter).padStart(4, "0")}`,
      cpuBrand: "Intel",
      cpuModel: "Core i5-1335U",
      cpuCores: 12,
      ramGb: 8,
      ramType: "DDR5",
      storageGb: 512,
      storageType: "NVMe SSD",
      displaySizeIn: 14,
      displayResolution: "1920x1200",
      displayType: "IPS",
      os: "Windows 11",
      provenance,
    },
  });
}

async function submitReport(
  skuCode: string,
  overrides: Record<string, unknown> = {}
): Promise<string> {
  const response = await contributionsRoute.POST(
    postRequest("http://localhost/api/contributions", {
      sku_code: skuCode,
      field: "ramGb",
      new_value: "32",
      evidence_url: "https://example.com/specifications",
      evidence_text: "The memory section states 32 GB.",
      name: "Reader One",
      email: "reader@example.com",
      ...overrides,
    })
  );
  expect(response.status).toBe(201);
  const body = await response.json();
  return body.id as string;
}

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "veridian-contributions-test-"));
  const dbPath = path.join(tempDir, "test.db");
  process.env.DATABASE_URL = `file:${dbPath}`;
  process.env.ADMIN_TOKEN = ADMIN_TOKEN;

  execSync("npx prisma db push --skip-generate --accept-data-loss --force-reset", {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env },
    stdio: "ignore",
  });

  prisma = new PrismaClient();

  const manufacturer = await prisma.manufacturer.create({
    data: { name: "Testco", slug: "testco" },
  });
  const series = await prisma.series.create({
    data: { manufacturerId: manufacturer.id, name: "Test Series", slug: "test-series" },
  });
  const model = await prisma.model.create({
    data: { seriesId: series.id, name: "Test Model X1", slug: "test-model-x1" },
  });
  modelId = model.id;

  // The routes read the shared Prisma client, so they are imported only once
  // the database URL is in place.
  contributionsRoute = await import("@/app/api/contributions/route");
  contributionRoute = await import("@/app/api/contributions/[id]/route");
  adminQueueRoute = await import("@/app/api/admin/contributions/route");
  adminReviewRoute = await import("@/app/api/admin/contributions/[id]/route");
});

afterAll(async () => {
  await prisma.$disconnect();
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.DATABASE_URL;
});

describe("submitting a correction", () => {
  it("does not change the catalog row", async () => {
    const sku = await createSku();
    const before = await prisma.sku.findUnique({ where: { id: sku.id } });

    const id = await submitReport(sku.skuCode);

    const after = await prisma.sku.findUnique({ where: { id: sku.id } });
    expect(after?.ramGb).toBe(before?.ramGb);
    expect(after?.ramGb).toBe(8);
    expect(after?.provenance).toBe(before?.provenance);

    // The report is stored, and it is stored as a report.
    const contribution = await prisma.contribution.findUnique({ where: { id } });
    expect(contribution?.status).toBe("pending");
    expect(contribution?.newValue).toBe("32");
    expect(contribution?.oldValue).toBe("8");
    expect(contribution?.type).toBe("correction");
  });

  it("records a report without evidence as unevidenced", async () => {
    const sku = await createSku();
    const id = await submitReport(sku.skuCode, {
      evidence_url: null,
      evidence_text: null,
      email: "no-source@example.com",
    });

    const contribution = await prisma.contribution.findUnique({ where: { id } });
    expect(contribution?.type).toBe("unevidenced_correction");
    expect(contribution?.evidenceUrl).toBeNull();

    // A reviewer sees that the report carries no source.
    const queue = await adminQueueRoute.GET(
      getRequest("http://localhost/api/admin/contributions", ADMIN_TOKEN)
    );
    expect(queue.status).toBe(200);
    const body = await queue.json();
    const item = body.results.find((entry: { id: string }) => entry.id === id);
    expect(item.evidenced).toBe(false);
  });

  it("refuses a report that names a field a reader cannot correct", async () => {
    const sku = await createSku();
    const response = await contributionsRoute.POST(
      postRequest("http://localhost/api/contributions", {
        sku_code: sku.skuCode,
        field: "provenance",
        new_value: "certified",
        email: "reader@example.com",
      })
    );
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/not a field/i);
  });

  it("refuses an evidence link that is not an http(s) address", async () => {
    const sku = await createSku();
    const response = await contributionsRoute.POST(
      postRequest("http://localhost/api/contributions", {
        sku_code: sku.skuCode,
        field: "ramGb",
        new_value: "32",
        evidence_url: "javascript:alert(1)",
        email: "reader@example.com",
      })
    );
    expect(response.status).toBe(400);
  });
});

describe("the review queue is closed without an admin token", () => {
  it("refuses a request with no token", async () => {
    const response = await adminQueueRoute.GET(
      getRequest("http://localhost/api/admin/contributions")
    );
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("refuses a request with the wrong token", async () => {
    const response = await adminQueueRoute.GET(
      getRequest("http://localhost/api/admin/contributions", "not-the-token")
    );
    expect(response.status).toBe(401);
  });

  it("refuses a token that is a prefix of the right one", async () => {
    const response = await adminQueueRoute.GET(
      getRequest("http://localhost/api/admin/contributions", ADMIN_TOKEN.slice(0, 5))
    );
    expect(response.status).toBe(401);
  });

  it("refuses an unauthenticated decision", async () => {
    const sku = await createSku();
    const id = await submitReport(sku.skuCode);

    const response = await review(id, { action: "accept" });

    expect(response.status).toBe(401);

    // The catalog is untouched by a refused request.
    const after = await prisma.sku.findUnique({ where: { id: sku.id } });
    expect(after?.ramGb).toBe(8);
  });

  it("lets an authenticated reviewer in", async () => {
    const response = await adminQueueRoute.GET(
      getRequest("http://localhost/api/admin/contributions", ADMIN_TOKEN)
    );
    expect(response.status).toBe(200);
  });
});

describe("the review queue", () => {
  it("shows the claimed field, the claimed value, the current value, the evidence and the submitter", async () => {
    const sku = await createSku();
    const id = await submitReport(sku.skuCode);

    const response = await adminQueueRoute.GET(
      getRequest("http://localhost/api/admin/contributions", ADMIN_TOKEN)
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    const item = body.results.find((entry: { id: string }) => entry.id === id);

    expect(item.field).toBe("ramGb");
    expect(item.fieldLabel).toBe("Memory (GB)");
    expect(item.claimedValue).toBe("32");
    expect(item.currentValue).toBe("8");
    expect(item.reportedValue).toBe("8");
    expect(item.evidenced).toBe(true);
    expect(item.evidenceUrl).toBe("https://example.com/specifications");
    expect(item.evidenceText).toBe("The memory section states 32 GB.");
    expect(item.submitter.email).toBe("reader@example.com");
    expect(item.submitter.name).toBe("Reader One");
    // The address was never confirmed, so the report says so.
    expect(item.submitter.emailVerified).toBe(false);
  });
});

describe("accepting a correction", () => {
  it("writes the corrected value and records the source", async () => {
    const sku = await createSku();
    const id = await submitReport(sku.skuCode);

    const response = await review(id, { action: "accept" }, ADMIN_TOKEN);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("approved");

    // The field now holds the corrected value.
    const after = await prisma.sku.findUnique({ where: { id: sku.id } });
    expect(after?.ramGb).toBe(32);

    // The correction is a new source, not an edit that erases the old one.
    const sources = await prisma.skuSource.findMany({ where: { skuId: sku.id } });
    expect(sources).toHaveLength(1);
    expect(sources[0].kind).toBe("community");
    expect(sources[0].sourceUrl).toBe("https://example.com/specifications");
    expect(sources[0].note).toContain("Reader One");
    expect(sources[0].note).toContain("8");
    expect(sources[0].note).toContain("32");

    // The response names the rows that were written.
    const observation = await prisma.rawObservation.findFirst({
      where: { rawRecordId: id },
    });
    expect(body.sourceId).toBe(sources[0].id);
    expect(body.observationId).toBe(observation?.id);

    const contribution = await prisma.contribution.findUnique({ where: { id } });
    expect(contribution?.status).toBe("approved");
    expect(contribution?.reviewedBy).toBe("admin");
  });

  it("keeps the previous value on the record", async () => {
    const sku = await createSku();
    const id = await submitReport(sku.skuCode);

    await review(id, { action: "accept" }, ADMIN_TOKEN);

    // The contribution still carries the value the field held before.
    const contribution = await prisma.contribution.findUnique({ where: { id } });
    expect(contribution?.oldValue).toBe("8");
    expect(contribution?.newValue).toBe("32");

    // And an immutable observation records it too.
    const observation = await prisma.rawObservation.findFirst({
      where: { rawRecordId: id },
    });
    expect(observation).not.toBeNull();
    expect(observation?.status).toBe("accepted");
    expect(observation?.skuId).toBe(sku.id);
    expect(observation?.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    const payload = JSON.parse(observation?.payload ?? "{}");
    expect(payload.previousValue).toBe("8");
    expect(payload.reportedValue).toBe("8");
    expect(payload.newValue).toBe("32");
    expect(payload.contributionId).toBe(id);
  });

  it("does not upgrade the provenance tier of a certified row", async () => {
    const sku = await createSku("certified");
    const id = await submitReport(sku.skuCode);

    const response = await review(id, { action: "accept" }, ADMIN_TOKEN);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.provenanceBefore).toBe("certified");
    expect(body.provenanceAfter).toBe("certified");

    const after = await prisma.sku.findUnique({ where: { id: sku.id } });
    expect(after?.provenance).toBe("certified");
    // The community correction is recorded as its own kind of evidence.
    const sources = await prisma.skuSource.findMany({ where: { skuId: sku.id } });
    expect(sources[0].kind).toBe("community");
    expect(sources[0].kind).not.toBe("certified");
    expect(sources[0].kind).not.toBe("manufacturer");
  });

  it("does not upgrade the provenance tier of an unverified row", async () => {
    const sku = await createSku("unverified");
    const id = await submitReport(sku.skuCode);

    await review(id, { action: "accept" }, ADMIN_TOKEN);

    const after = await prisma.sku.findUnique({ where: { id: sku.id } });
    expect(after?.provenance).toBe("unverified");
    expect(after?.provenance).not.toBe("certified");
    expect(after?.provenance).not.toBe("manufacturer");
  });

  it("refuses to accept the same report twice", async () => {
    const sku = await createSku();
    const id = await submitReport(sku.skuCode);

    const first = await review(id, { action: "accept" }, ADMIN_TOKEN);
    expect(first.status).toBe(200);

    const second = await review(id, { action: "accept" }, ADMIN_TOKEN);
    expect(second.status).toBe(409);

    // One acceptance, one source.
    expect(await prisma.skuSource.count({ where: { skuId: sku.id } })).toBe(1);
  });
});

describe("rejecting a correction", () => {
  it("leaves the catalog alone", async () => {
    const sku = await createSku();
    const id = await submitReport(sku.skuCode);

    const response = await review(
      id,
      { action: "reject", note: "The source states 16 GB, not 32 GB." },
      ADMIN_TOKEN
    );
    expect(response.status).toBe(200);

    const after = await prisma.sku.findUnique({ where: { id: sku.id } });
    expect(after?.ramGb).toBe(8);
    expect(await prisma.skuSource.count({ where: { skuId: sku.id } })).toBe(0);

    const contribution = await prisma.contribution.findUnique({ where: { id } });
    expect(contribution?.status).toBe("rejected");
    // The contributor's own note is kept, and the reviewer's is added to it.
    expect(contribution?.evidenceText).toContain("The memory section states 32 GB.");
    expect(contribution?.evidenceText).toContain("The source states 16 GB");
  });
});

describe("asking for more evidence", () => {
  it("keeps the report in the queue and records the request", async () => {
    const sku = await createSku();
    const id = await submitReport(sku.skuCode, { evidence_url: null });

    const response = await review(
      id,
      { action: "request_evidence", note: "Which page states 32 GB?" },
      ADMIN_TOKEN
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("needs_evidence");

    const after = await prisma.sku.findUnique({ where: { id: sku.id } });
    expect(after?.ramGb).toBe(8);

    const contribution = await prisma.contribution.findUnique({ where: { id } });
    expect(contribution?.status).toBe("needs_evidence");
    expect(contribution?.evidenceText).toContain("Which page states 32 GB?");
  });
});

describe("voting on a correction", () => {
  it("records a vote", async () => {
    const sku = await createSku();
    const id = await submitReport(sku.skuCode);

    const response = await vote(id, {
      email: "voter@example.com",
      name: "Voter One",
      value: 1,
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.value).toBe(1);
    expect(body.votes.confirmed).toBe(1);

    const voteRow = await prisma.vote.findFirst({ where: { contributionId: id } });
    expect(voteRow?.value).toBe(1);
    const voter = await prisma.user.findUnique({ where: { id: voteRow?.userId ?? "" } });
    expect(voter?.email).toBe("voter@example.com");
  });

  it("keeps one vote per person", async () => {
    const sku = await createSku();
    const id = await submitReport(sku.skuCode);

    await vote(id, { email: "voter@example.com", value: 1 });
    const second = await vote(id, { email: "voter@example.com", value: -1 });
    expect(second.status).toBe(200);

    expect(await prisma.vote.count({ where: { contributionId: id } })).toBe(1);
    const voteRow = await prisma.vote.findFirst({ where: { contributionId: id } });
    expect(voteRow?.value).toBe(-1);
  });

  it("refuses a vote that is not a vote", async () => {
    const sku = await createSku();
    const id = await submitReport(sku.skuCode);

    const response = await vote(id, { email: "voter@example.com", value: 7 });
    expect(response.status).toBe(400);
    expect(await prisma.vote.count({ where: { contributionId: id } })).toBe(0);
  });
});
