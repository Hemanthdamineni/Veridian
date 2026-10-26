import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  checkAdminRequest,
  currentValueOf,
  findCorrectableField,
  reviewContribution,
  REVIEW_ACTIONS,
  type ReviewAction,
} from "@/lib/contributions";

export const dynamic = "force-dynamic";

/**
 * Reviewing one correction.
 *
 * GET  /api/admin/contributions/:id   the correction, its votes and — once it
 *                                     has been accepted — the source row and
 *                                     the observation that were written.
 * POST /api/admin/contributions/:id   decide: accept, reject, or ask the
 *                                     reader for more evidence.
 *
 * Accepting is the only action that changes the catalog. It writes the new
 * value, records the contributor's source, and keeps the previous value in an
 * immutable observation, so the change is an addition to the record rather
 * than an edit that erases it.
 */

function isReviewAction(value: unknown): value is ReviewAction {
  return typeof value === "string" && (REVIEW_ACTIONS as readonly string[]).includes(value);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = checkAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      {
        status: auth.status,
        headers:
          auth.status === 401 ? { "WWW-Authenticate": 'Bearer realm="admin"' } : undefined,
      }
    );
  }

  try {
    const { id } = await params;

    const contribution = await prisma.contribution.findUnique({
      where: { id },
      include: {
        user: {
          select: { id: true, name: true, email: true, emailVerified: true, reputation: true },
        },
        sku: { select: { id: true, skuCode: true, provenance: true } },
        votes: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
    });

    if (!contribution) {
      return NextResponse.json(
        { error: "Contribution not found" },
        { status: 404 }
      );
    }

    const sku = await prisma.sku.findUnique({ where: { id: contribution.skuId } });
    const currentValue = contribution.field
      ? currentValueOf(sku as unknown as Record<string, unknown>, contribution.field)
      : null;
    const field = contribution.field ? findCorrectableField(contribution.field) : undefined;

    // What the acceptance wrote, if it was accepted.
    const [source, observation] = await Promise.all([
      prisma.skuSource.findFirst({
        where: { skuId: contribution.skuId, source: `Community correction #${contribution.id}` },
      }),
      prisma.rawObservation.findFirst({
        where: { rawRecordId: contribution.id, source: "Veridian community corrections" },
      }),
    ]);

    return NextResponse.json({
      id: contribution.id,
      type: contribution.type,
      status: contribution.status,
      field: contribution.field,
      fieldLabel: field?.label ?? contribution.field,
      claimedValue: contribution.newValue,
      currentValue,
      reportedValue: contribution.oldValue,
      evidenced: Boolean(contribution.evidenceUrl),
      evidenceUrl: contribution.evidenceUrl,
      evidenceText: contribution.evidenceText,
      reviewedBy: contribution.reviewedBy,
      submitter: {
        id: contribution.user.id,
        name: contribution.user.name,
        email: contribution.user.email,
        emailVerified: contribution.user.emailVerified,
        reputation: contribution.user.reputation,
      },
      votes: contribution.votes.map((vote) => ({
        value: vote.value,
        voter: vote.user.name,
        createdAt: vote.createdAt.toISOString(),
      })),
      sku: {
        id: contribution.sku.id,
        skuCode: contribution.sku.skuCode,
        /** The row's provenance tier. A community correction never changes it. */
        provenance: contribution.sku.provenance,
      },
      applied: source
        ? {
            source: {
              id: source.id,
              source: source.source,
              kind: source.kind,
              sourceUrl: source.sourceUrl,
              note: source.note,
              confidence: source.confidence,
              observedAt: source.observedAt.toISOString(),
            },
            observation: observation
              ? {
                  id: observation.id,
                  payloadHash: observation.payloadHash,
                  payload: observation.payload,
                  observedAt: observation.observedAt.toISOString(),
                }
              : null,
          }
        : null,
      createdAt: contribution.createdAt.toISOString(),
      updatedAt: contribution.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Error fetching contribution for review:", error);
    return NextResponse.json(
      { error: "Failed to fetch the contribution" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = checkAdminRequest(request);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error },
      {
        status: auth.status,
        headers:
          auth.status === 401 ? { "WWW-Authenticate": 'Bearer realm="admin"' } : undefined,
      }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "The request body must be valid JSON." },
      { status: 400 }
    );
  }

  const payload = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;

  if (!isReviewAction(payload.action)) {
    return NextResponse.json(
      { error: `The action must be one of: ${REVIEW_ACTIONS.join(", ")}.` },
      { status: 400 }
    );
  }

  const note = typeof payload.note === "string" ? payload.note : null;
  const reviewer = typeof payload.reviewer === "string" && payload.reviewer.trim()
    ? payload.reviewer.trim()
    : "admin";

  try {
    const { id } = await params;
    const result = await reviewContribution(prisma, {
      contributionId: id,
      action: payload.action,
      reviewer,
      note,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      id: result.contributionId,
      status: result.status,
      previousValue: result.previousValue,
      newValue: result.newValue,
      provenanceBefore: result.provenanceBefore,
      provenanceAfter: result.provenanceAfter,
      sourceId: result.sourceId,
      observationId: result.observationId,
      message:
        result.status === "approved"
          ? "Accepted. The value was updated and recorded as a new source; the previous value is still on the record."
          : result.status === "needs_evidence"
            ? "The reader has been asked for a source. The report stays in the queue."
            : "Rejected. The catalog was not changed.",
    });
  } catch (error) {
    console.error("Error reviewing contribution:", error);
    return NextResponse.json(
      { error: "Failed to review the contribution" },
      { status: 500 }
    );
  }
}
