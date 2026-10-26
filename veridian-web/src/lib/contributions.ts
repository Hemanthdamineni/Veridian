import { createHash } from "node:crypto";
import type { PrismaClient, Prisma } from "@prisma/client";

/**
 * Community corrections — the rules of the correction workflow.
 *
 * A reader who believes a configuration is wrong submits a correction: the
 * field they think is wrong, the value that should be there instead, and the
 * evidence they looked at. Everything the catalog depends on is enforced
 * here:
 *
 *   * A submission never changes the catalog. It is stored as a Contribution
 *     and nothing else happens until a reviewer accepts it.
 *   * An accepted correction is written as a *new source* — a SkuSource row
 *     plus an immutable RawObservation — never as an edit that erases the
 *     previous value. The old value stays on the record.
 *   * A community correction is a fourth kind of evidence. It never upgrades
 *     a row's provenance tier to `certified` or `manufacturer`.
 *   * Nothing here invents a contributor or a citation. A correction without
 *     evidence is allowed; it is recorded as unevidenced and the reviewer can
 *     see that it is.
 *
 * The schema has no dedicated reviewer-note column, so a reviewer's request
 * for more evidence is appended to the contribution's note text behind an
 * explicit marker. It is never allowed to overwrite the contributor's own
 * words.
 */

/** The `type` written on a Contribution row. */
export const CONTRIBUTION_TYPES = ["correction", "unevidenced_correction"] as const;
export type ContributionType = (typeof CONTRIBUTION_TYPES)[number];

/** The `status` written on a Contribution row. */
export const CONTRIBUTION_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "needs_evidence",
] as const;
export type ContributionStatus = (typeof CONTRIBUTION_STATUSES)[number];

/** What a reviewer can do with a queued contribution. */
export const REVIEW_ACTIONS = ["accept", "reject", "request_evidence"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** The value a vote may carry. Matches the Vote model's documented values. */
export const VOTE_VALUES = [1, 0, -1] as const;
export type VoteValue = (typeof VOTE_VALUES)[number];

/**
 * The evidence class of a community correction. It is a fourth kind of
 * evidence, alongside the certified, manufacturer and retailer sources that
 * the catalog already records, and it is deliberately not one of them.
 */
export const COMMUNITY_SOURCE_KIND = "community";

/** The `source` name written on the RawObservation of an accepted correction. */
export const CORRECTION_OBSERVATION_SOURCE = "Veridian community corrections";

/** Confidence written on a community source: reviewed, but not an official one. */
const EVIDENCED_CONFIDENCE = 0.6;
const UNEVIDENCED_CONFIDENCE = 0.3;

export type CorrectableFieldKind = "text" | "number" | "boolean";

export interface CorrectableField {
  /** The column on the Sku model. */
  column: string;
  /** The label a reader sees. */
  label: string;
  kind: CorrectableFieldKind;
  /** A short note about the expected format, shown under the input. */
  hint?: string;
  min?: number;
  max?: number;
  /** True when the value must be a whole number. */
  integer?: boolean;
}

/**
 * The fields a reader may correct. Everything on this list is a fact about a
 * configuration; identity, pricing, provenance and visibility are not
 * reader-correctable and are deliberately absent.
 */
export const CORRECTABLE_FIELDS: readonly CorrectableField[] = [
  { column: "cpuBrand", label: "Processor brand", kind: "text", hint: "For example: Intel, AMD, Qualcomm, Apple." },
  { column: "cpuModel", label: "Processor model", kind: "text", hint: "The commercial name of the processor." },
  { column: "cpuCores", label: "Processor cores", kind: "number", min: 1, max: 256, integer: true, hint: "A whole number of cores." },
  { column: "gpuModel", label: "Graphics", kind: "text", hint: "The commercial name of the graphics chip." },
  { column: "ramGb", label: "Memory (GB)", kind: "number", min: 1, max: 1024, integer: true, hint: "Installed memory in gigabytes." },
  { column: "ramType", label: "Memory type", kind: "text", hint: "For example: DDR5, LPDDR5X." },
  { column: "ramSoldered", label: "Memory soldered", kind: "boolean", hint: "Yes if the memory cannot be replaced." },
  { column: "storageGb", label: "Storage (GB)", kind: "number", min: 1, max: 8192, integer: true, hint: "Total installed storage in gigabytes." },
  { column: "storageType", label: "Storage type", kind: "text", hint: "For example: NVMe SSD, SATA SSD, eMMC." },
  { column: "storageSlots", label: "Storage slots", kind: "number", min: 1, max: 16, integer: true, hint: "How many slots the machine has." },
  { column: "displaySizeIn", label: "Display size (inches)", kind: "number", min: 5, max: 40, hint: "Diagonal in inches, for example 15.6." },
  { column: "displayResolution", label: "Display resolution", kind: "text", hint: "For example: 1920x1200." },
  { column: "displayType", label: "Display panel", kind: "text", hint: "For example: IPS, OLED, Mini-LED." },
  { column: "displayRefreshHz", label: "Refresh rate (Hz)", kind: "number", min: 20, max: 1000, integer: true },
  { column: "displayTouch", label: "Touch screen", kind: "boolean", hint: "Yes if the screen takes touch input." },
  { column: "displayNits", label: "Peak brightness (nits)", kind: "number", min: 100, max: 5000, integer: true },
  { column: "weightKg", label: "Weight (kg)", kind: "number", min: 0.05, max: 20, hint: "For example 1.24." },
  { column: "batteryWh", label: "Battery capacity (Wh)", kind: "number", min: 5, max: 300 },
  { column: "batteryLifeHours", label: "Claimed battery life (hours)", kind: "number", min: 0, max: 100, hint: "The manufacturer's own claim." },
  { column: "npuTops", label: "NPU (TOPS)", kind: "number", min: 0, max: 500 },
  { column: "os", label: "Operating system", kind: "text" },
  { column: "buildMaterial", label: "Build material", kind: "text" },
  { column: "linuxCompat", label: "Linux compatibility", kind: "text", hint: "For example: Good, Partial, Poor, Untested." },
  { column: "mpn", label: "Manufacturer part number", kind: "text" },
  { column: "upc", label: "UPC", kind: "text" },
  { column: "productType", label: "Product type", kind: "text", hint: "For example: Notebook, Two-In-One Notebook." },
];

const FIELD_BY_COLUMN = new Map(CORRECTABLE_FIELDS.map((field) => [field.column, field]));

export function findCorrectableField(column: string): CorrectableField | undefined {
  return FIELD_BY_COLUMN.get(column);
}

/** Read a column off a catalog row. */
export function readSkuField(sku: Record<string, unknown>, column: string): unknown {
  return sku[column];
}

/** The value of a field as a reader sees it. */
export function describeValue(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  return String(value);
}

/** The current catalog value of a field, as a reader sees it. */
export function currentValueOf(sku: Record<string, unknown>, column: string): string | null {
  return describeValue(readSkuField(sku, column));
}

export type CoercedValue = string | number | boolean;

export type CoercionResult =
  | { ok: true; value: CoercedValue }
  | { ok: false; error: string };

/**
 * Turn what a reader typed into the value the column can hold. A correction
 * that cannot be stored exactly is refused rather than rounded or guessed.
 */
export function parseCorrectedValue(field: CorrectableField, raw: string): CoercionResult {
  const text = raw.trim();

  if (field.kind === "boolean") {
    const lowered = text.toLowerCase();
    if (["yes", "true", "y", "1"].includes(lowered)) return { ok: true, value: true };
    if (["no", "false", "n", "0"].includes(lowered)) return { ok: true, value: false };
    return { ok: false, error: `${field.label} must be "yes" or "no".` };
  }

  if (field.kind === "number") {
    const value = Number(text);
    if (!text || !Number.isFinite(value)) {
      return { ok: false, error: `${field.label} must be a number.` };
    }
    if (field.integer && !Number.isInteger(value)) {
      return { ok: false, error: `${field.label} must be a whole number.` };
    }
    if (field.min !== undefined && value < field.min) {
      return { ok: false, error: `${field.label} must be at least ${field.min}.` };
    }
    if (field.max !== undefined && value > field.max) {
      return { ok: false, error: `${field.label} must be at most ${field.max}.` };
    }
    return { ok: true, value };
  }

  if (!text) return { ok: false, error: `${field.label} cannot be empty.` };
  if (text.length > 200) return { ok: false, error: `${field.label} must be 200 characters or fewer.` };
  return { ok: true, value: text };
}

export interface SubmissionInput {
  skuCode: string;
  field: string;
  newValue: string;
  /** The value in the form the catalog column can hold. */
  canonicalValue: string;
  evidenceUrl: string | null;
  evidenceText: string | null;
  contributorName: string | null;
  contributorEmail: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(body: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = body[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * A cited URL has to be an http(s) address. Anything else — a `javascript:`
 * string, a local path — is refused rather than stored and later rendered as
 * a link.
 */
export function isCitableUrl(value: string): boolean {
  if (value.length > 2000) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return value.length <= 200 && EMAIL_PATTERN.test(value);
}

/**
 * Validate a submitted correction. The evidence URL is optional — a
 * correction without evidence is allowed — but everything else is checked,
 * because a correction that names no field or no value cannot be reviewed.
 */
export function parseSubmission(body: unknown): ParseResult<SubmissionInput> {
  if (!isRecord(body)) {
    return { ok: false, error: "The request body must be a JSON object." };
  }

  const skuCode = readString(body, "sku_code", "skuCode");
  if (!skuCode) return { ok: false, error: "A configuration (sku_code) is required." };
  if (skuCode.length > 120) return { ok: false, error: "The configuration code is too long." };

  const fieldName = readString(body, "field");
  if (!fieldName) return { ok: false, error: "The field that is wrong is required." };
  const field = findCorrectableField(fieldName);
  if (!field) {
    return {
      ok: false,
      error: `"${fieldName}" is not a field a reader can correct.`,
    };
  }

  const newValue = readString(body, "new_value", "newValue");
  if (!newValue) return { ok: false, error: "The correct value is required." };
  const coerced = parseCorrectedValue(field, newValue);
  if (!coerced.ok) return { ok: false, error: coerced.error };

  const evidenceUrl = readString(body, "evidence_url", "evidenceUrl");
  if (evidenceUrl && !isCitableUrl(evidenceUrl)) {
    return { ok: false, error: "The evidence link must be a full http(s) address." };
  }

  const evidenceText = readString(body, "evidence_text", "evidenceText");
  if (evidenceText && evidenceText.length > 2000) {
    return { ok: false, error: "The note must be 2000 characters or fewer." };
  }

  const contributorName = readString(body, "name", "contributor_name");
  if (contributorName && contributorName.length > 80) {
    return { ok: false, error: "The name must be 80 characters or fewer." };
  }

  const contributorEmail = readString(body, "email", "contributor_email");
  if (!contributorEmail) {
    return { ok: false, error: "An email address is required so the report can be recorded." };
  }
  if (!isValidEmail(contributorEmail)) {
    return { ok: false, error: "That email address does not look valid." };
  }

  return {
    ok: true,
    value: {
      skuCode,
      field: field.column,
      newValue: newValue.trim(),
      canonicalValue: describeValue(coerced.value) ?? newValue.trim(),
      evidenceUrl,
      evidenceText,
      contributorName,
      contributorEmail: contributorEmail.toLowerCase(),
    },
  };
}

/** The public name of a contributor. Never invented: no name means no name. */
export function contributorLabel(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  return trimmed.length > 0 ? trimmed : "Unnamed reader";
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Append a reviewer's words to the contribution's note without ever
 * overwriting the contributor's own note.
 */
export function appendReviewerNote(
  existing: string | null | undefined,
  note: string | null | undefined,
  reviewer: string
): string | null {
  const trimmed = (note ?? "").trim();
  if (!trimmed) return existing ?? null;
  const stamp = new Date().toISOString().slice(0, 10);
  const marker = `[Reviewer ${reviewer} · ${stamp} · not evidence]`;
  return existing && existing.trim().length > 0
    ? `${existing.trim()}\n\n${marker} ${trimmed}`
    : `${marker} ${trimmed}`;
}

export type ReviewResult =
  | {
      ok: true;
      status: ContributionStatus;
      contributionId: string;
      /** The value the field held before the correction was applied. */
      previousValue: string | null;
      /** The value the field holds now. */
      newValue: string | null;
      /** The row's provenance tier, before and after. */
      provenanceBefore: string;
      provenanceAfter: string;
      /** The id of the source row written for the accepted correction. */
      sourceId: string | null;
      /** The id of the immutable observation of the previous value. */
      observationId: string | null;
    }
  | { ok: false; status: number; error: string };

/**
 * Review a queued contribution.
 *
 * `accept` is the only action that touches the catalog, and it does so by
 * appending: the corrected value is written to the field, a SkuSource row
 * records the contributor's source, and an immutable RawObservation records
 * the value the field held before. The previous value is therefore still
 * discoverable in three places — the contribution, the source note and the
 * observation payload — and nothing is deleted.
 */
export async function reviewContribution(
  prisma: PrismaClient,
  params: {
    contributionId: string;
    action: ReviewAction;
    reviewer: string;
    note?: string | null;
  }
): Promise<ReviewResult> {
  const contribution = await prisma.contribution.findUnique({
    where: { id: params.contributionId },
    include: { user: true, sku: true },
  });

  if (!contribution) {
    return { ok: false, status: 404, error: "Contribution not found." };
  }
  if (contribution.status !== "pending" && contribution.status !== "needs_evidence") {
    return {
      ok: false,
      status: 409,
      error: `This contribution has already been ${contribution.status}.`,
    };
  }

  const reviewer = params.reviewer.trim() || "admin";
  const note = appendReviewerNote(contribution.evidenceText, params.note, reviewer);

  if (params.action === "reject") {
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: { status: "rejected", reviewedBy: reviewer, evidenceText: note },
    });
    return {
      ok: true,
      status: "rejected",
      contributionId: contribution.id,
      previousValue: contribution.oldValue,
      newValue: contribution.newValue,
      provenanceBefore: contribution.sku.provenance,
      provenanceAfter: contribution.sku.provenance,
      sourceId: null,
      observationId: null,
    };
  }

  if (params.action === "request_evidence") {
    await prisma.contribution.update({
      where: { id: contribution.id },
      data: { status: "needs_evidence", reviewedBy: reviewer, evidenceText: note },
    });
    return {
      ok: true,
      status: "needs_evidence",
      contributionId: contribution.id,
      previousValue: contribution.oldValue,
      newValue: contribution.newValue,
      provenanceBefore: contribution.sku.provenance,
      provenanceAfter: contribution.sku.provenance,
      sourceId: null,
      observationId: null,
    };
  }

  // Accept.
  if (!contribution.field) {
    return { ok: false, status: 400, error: "This contribution does not name a field." };
  }
  const field = findCorrectableField(contribution.field);
  if (!field) {
    return {
      ok: false,
      status: 400,
      error: `"${contribution.field}" is not a field that can be corrected.`,
    };
  }
  const coerced = parseCorrectedValue(field, contribution.newValue);
  if (!coerced.ok) {
    return { ok: false, status: 400, error: coerced.error };
  }

  const sku = contribution.sku as unknown as Record<string, unknown>;
  const previousValue = currentValueOf(sku, field.column);
  const newValue = describeValue(coerced.value);
  const evidenced = Boolean(contribution.evidenceUrl);
  const label = contributorLabel(contribution.user.name);

  // The provenance tier of the row is deliberately not touched. A community
  // correction is a fourth kind of evidence: it does not make a row
  // certified, and it does not erase the certification the rest of the row
  // still rests on. What changes is the *source* of one field, and that is
  // recorded as a source.
  const provenanceBefore = contribution.sku.provenance;
  const provenanceAfter = provenanceBefore;

  const sourceName = `Community correction #${contribution.id}`;
  const sourceNote = [
    `Corrected ${field.label} from "${previousValue ?? "not reported"}" to "${newValue}"`,
    evidenced
      ? `using the source cited by ${label}`
      : `with no source supplied, accepted on the reviewer's own reading`,
    `Reported by ${label}. The previous value is kept in the raw observation log.`,
  ].join(". ");

  const payload = JSON.stringify({
    kind: "community-correction",
    contributionId: contribution.id,
    skuCode: contribution.sku.skuCode,
    field: field.column,
    fieldLabel: field.label,
    previousValue,
    // The value the reader contested when the report was filed. It is kept
    // here because the field may have changed again between the report and
    // the decision, and both numbers are part of the record.
    reportedValue: contribution.oldValue,
    newValue,
    contributorId: contribution.userId,
    contributor: label,
    evidenceUrl: contribution.evidenceUrl,
    note: contribution.evidenceText,
    acceptedAt: new Date().toISOString(),
  });

  const skuUpdate = { [field.column]: coerced.value } as unknown as Prisma.SkuUpdateInput;

  const [, source, observation] = await prisma.$transaction([
    prisma.sku.update({
      where: { id: contribution.skuId },
      data: skuUpdate,
    }),
    prisma.skuSource.create({
      data: {
        skuId: contribution.skuId,
        source: sourceName,
        kind: COMMUNITY_SOURCE_KIND,
        sourceUrl: contribution.evidenceUrl,
        observedAt: contribution.createdAt,
        confidence: evidenced ? EVIDENCED_CONFIDENCE : UNEVIDENCED_CONFIDENCE,
        note: sourceNote,
      },
    }),
    prisma.rawObservation.create({
      data: {
        source: CORRECTION_OBSERVATION_SOURCE,
        sourceUrl: contribution.evidenceUrl,
        observedAt: contribution.createdAt,
        payloadHash: sha256(payload),
        payload,
        status: "accepted",
        rawRecordId: contribution.id,
        skuId: contribution.skuId,
      },
    }),
    prisma.contribution.update({
      where: { id: contribution.id },
      data: {
        status: "approved",
        // The value the field held before the correction. It is never
        // cleared, so the old value stays discoverable from the correction
        // itself.
        oldValue: previousValue,
        reviewedBy: reviewer,
        evidenceText: note,
      },
    }),
  ]);

  return {
    ok: true,
    status: "approved",
    contributionId: contribution.id,
    previousValue,
    newValue,
    provenanceBefore,
    provenanceAfter,
    sourceId: source.id,
    observationId: observation.id,
  };
}

export type VoteResult =
  | { ok: true; value: VoteValue; tally: VoteTally }
  | { ok: false; status: number; error: string };

export interface VoteTally {
  confirmed: number;
  disputed: number;
  needsVerification: number;
  total: number;
}

export const EMPTY_TALLY: VoteTally = {
  confirmed: 0,
  disputed: 0,
  needsVerification: 0,
  total: 0,
};

/** Count the votes on a set of contributions in one query. */
export async function voteTallies(
  prisma: PrismaClient,
  contributionIds: string[]
): Promise<Record<string, VoteTally>> {
  const tallies: Record<string, VoteTally> = {};
  for (const id of contributionIds) tallies[id] = { ...EMPTY_TALLY };
  if (contributionIds.length === 0) return tallies;

  const votes = await prisma.vote.findMany({
    where: { contributionId: { in: contributionIds } },
    select: { contributionId: true, value: true },
  });
  for (const vote of votes) {
    const tally = tallies[vote.contributionId];
    if (!tally) continue;
    if (vote.value > 0) tally.confirmed += 1;
    else if (vote.value < 0) tally.disputed += 1;
    else tally.needsVerification += 1;
    tally.total += 1;
  }
  return tallies;
}

/**
 * Record a vote. A voter is identified by their email address, exactly as a
 * reporter is, so the Vote row points at a real account and one person
 * cannot vote twice on the same contribution.
 */
export async function castVote(
  prisma: PrismaClient,
  params: { contributionId: string; email: string; name?: string | null; value: number }
): Promise<VoteResult> {
  if (!VOTE_VALUES.includes(params.value as VoteValue)) {
    return { ok: false, status: 400, error: "A vote must be 1, 0 or -1." };
  }
  const email = params.email.trim().toLowerCase();
  if (!isValidEmail(email)) {
    return { ok: false, status: 400, error: "A valid email address is required to vote." };
  }

  const contribution = await prisma.contribution.findUnique({
    where: { id: params.contributionId },
    select: { id: true },
  });
  if (!contribution) {
    return { ok: false, status: 404, error: "Contribution not found." };
  }

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: (params.name ?? "").trim() || null,
      role: "user",
    },
  });

  await prisma.vote.upsert({
    where: { userId_contributionId: { userId: user.id, contributionId: params.contributionId } },
    update: { value: params.value },
    create: {
      userId: user.id,
      contributionId: params.contributionId,
      value: params.value,
    },
  });

  const tally = (await voteTallies(prisma, [params.contributionId]))[params.contributionId];
  return { ok: true, value: params.value as VoteValue, tally };
}

/**
 * Find or create the account behind a report. A new account is never given a
 * name it did not supply, and an existing account is never renamed by a
 * stranger who knows its email address.
 */
export async function findOrCreateReporter(
  prisma: PrismaClient,
  email: string,
  name: string | null
): Promise<{ id: string }> {
  const normalized = email.trim().toLowerCase();
  // An upsert rather than a find-then-create: two reports filed at the same
  // moment must not race each other into a duplicate account.
  const user = await prisma.user.upsert({
    where: { email: normalized },
    // An existing account is never renamed here. The name is public, and
    // anyone who knows an address must not be able to change it.
    update: {},
    create: {
      email: normalized,
      name: name && name.trim() ? name.trim() : null,
      role: "user",
    },
    select: { id: true },
  });
  return user;
}

export type AdminAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Constant-time comparison, so a wrong token cannot be found by timing.
 * Same shape as the check the middleware and the refresh endpoint use.
 */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Check an admin request.
 *
 * The middleware already refuses `/api/admin/*` without a token, and the
 * review queue repeats the check inside the handler so the endpoint stays
 * closed even if the matcher is ever changed.
 */
export function checkAdminToken(input: {
  bearer?: string | null;
  cookie?: string | null;
  expected?: string | null;
}): AdminAuthResult {
  const expected = input.expected ?? process.env.ADMIN_TOKEN ?? null;
  if (!expected) {
    return {
      ok: false,
      status: 503,
      error: "ADMIN_TOKEN is not configured; the review queue is disabled.",
    };
  }
  const provided = (input.bearer ?? "").trim() || (input.cookie ?? "").trim();
  if (!provided || !safeEqual(expected, provided)) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }
  return { ok: true };
}

/** The part of a request the admin check needs. */
export interface AdminRequestLike {
  headers: { get(name: string): string | null };
  cookies: { get(name: string): { value: string } | undefined };
}

/**
 * Authorise an admin request from its bearer token or its session cookie,
 * exactly as the middleware does.
 */
export function checkAdminRequest(request: AdminRequestLike): AdminAuthResult {
  const authHeader = request.headers.get("authorization");
  const bearer = authHeader ? authHeader.replace(/^Bearer\s+/i, "").trim() : null;
  const cookie = request.cookies.get("admin_session")?.value ?? null;
  return checkAdminToken({ bearer, cookie });
}
