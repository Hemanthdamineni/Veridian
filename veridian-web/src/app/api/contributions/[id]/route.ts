import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  castVote,
  contributorLabel,
  currentValueOf,
  findCorrectableField,
  isValidEmail,
  voteTallies,
} from "@/lib/contributions";

export const dynamic = "force-dynamic";

/**
 * A single correction.
 *
 * GET  /api/contributions/:id   the correction, its status and its votes.
 * POST /api/contributions/:id   record a vote on the correction.
 *
 * Voting uses the Vote model: 1 confirms the correction, -1 disputes it and 0
 * says it needs more verification. One person holds one vote per correction.
 * A vote never changes the catalog — it only tells a reviewer what other
 * readers think.
 */

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const contribution = await prisma.contribution.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true } },
        sku: { select: { id: true, skuCode: true } },
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
    const tallies = await voteTallies(prisma, [id]);

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
      contributor: contributorLabel(contribution.user.name),
      reviewedBy: contribution.reviewedBy,
      votes: tallies[id],
      sku: { id: contribution.sku.id, skuCode: contribution.sku.skuCode },
      createdAt: contribution.createdAt.toISOString(),
      updatedAt: contribution.updatedAt.toISOString(),
    });
  } catch (error) {
    console.error("Error fetching contribution:", error);
    return NextResponse.json(
      { error: "Failed to fetch contribution" },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "The request body must be valid JSON." },
      { status: 400 }
    );
  }

  const { id } = await params;
  const payload = (typeof body === "object" && body !== null ? body : {}) as Record<
    string,
    unknown
  >;

  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (!isValidEmail(email)) {
    return NextResponse.json(
      { error: "A valid email address is required to vote." },
      { status: 400 }
    );
  }

  const rawValue = Number(payload.value);
  if (!Number.isInteger(rawValue) || rawValue < -1 || rawValue > 1) {
    return NextResponse.json(
      { error: "A vote must be 1 (confirmed), 0 (needs verification) or -1 (disputed)." },
      { status: 400 }
    );
  }

  const name = typeof payload.name === "string" ? payload.name : null;

  try {
    const result = await castVote(prisma, {
      contributionId: id,
      email,
      name,
      value: rawValue,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({
      contributionId: id,
      value: result.value,
      votes: result.tally,
    });
  } catch (error) {
    console.error("Error recording vote:", error);
    return NextResponse.json(
      { error: "Failed to record the vote" },
      { status: 500 }
    );
  }
}
