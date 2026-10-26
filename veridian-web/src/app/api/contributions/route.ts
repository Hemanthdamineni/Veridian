import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  CONTRIBUTION_STATUSES,
  contributorLabel,
  currentValueOf,
  findCorrectableField,
  findOrCreateReporter,
  parseSubmission,
  voteTallies,
} from "@/lib/contributions";

export const dynamic = "force-dynamic";

/**
 * Community corrections — the reader-facing end.
 *
 * GET  /api/contributions?sku_code=…   the corrections reported for a
 *                                       configuration, with their status.
 * POST /api/contributions              report a correction.
 *
 * A report is stored and nothing else. It never touches the catalog: the
 * value a reader believes is correct does not change anything until a
 * reviewer accepts the report (see /api/admin/contributions).
 */

/** The public shape of a correction. The contributor's email is never in it. */
function publicContribution(
  contribution: {
    id: string;
    type: string;
    field: string | null;
    oldValue: string | null;
    newValue: string;
    evidenceUrl: string | null;
    evidenceText: string | null;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    user: { name: string | null };
    sku: { id: string; skuCode: string };
  },
  currentValue: string | null,
  tally: { confirmed: number; disputed: number; needsVerification: number; total: number }
) {
  const field = contribution.field ? findCorrectableField(contribution.field) : undefined;
  return {
    id: contribution.id,
    type: contribution.type,
    status: contribution.status,
    field: contribution.field,
    fieldLabel: field?.label ?? contribution.field,
    claimedValue: contribution.newValue,
    currentValue,
    /** The value the field held when the report was filed. */
    reportedValue: contribution.oldValue,
    evidenced: Boolean(contribution.evidenceUrl),
    evidenceUrl: contribution.evidenceUrl,
    evidenceText: contribution.evidenceText,
    contributor: contributorLabel(contribution.user.name),
    votes: tally,
    sku: { id: contribution.sku.id, skuCode: contribution.sku.skuCode },
    createdAt: contribution.createdAt.toISOString(),
    updatedAt: contribution.updatedAt.toISOString(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const skuCode = searchParams.get("sku_code");
    const status = searchParams.get("status");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));

    const where: Prisma.ContributionWhereInput = {};
    if (skuCode) {
      const sku = await prisma.sku.findUnique({
        where: { skuCode },
        select: { id: true },
      });
      if (!sku) {
        return NextResponse.json(
          { error: `No configuration with the code ${skuCode}.` },
          { status: 404 }
        );
      }
      where.skuId = sku.id;
    }
    if (status) {
      if (!(CONTRIBUTION_STATUSES as readonly string[]).includes(status)) {
        return NextResponse.json(
          { error: `Unknown status. Use one of: ${CONTRIBUTION_STATUSES.join(", ")}.` },
          { status: 400 }
        );
      }
      where.status = status;
    }

    const [contributions, total] = await Promise.all([
      prisma.contribution.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { name: true } },
          sku: { select: { id: true, skuCode: true } },
        },
      }),
      prisma.contribution.count({ where }),
    ]);

    const tallies = await voteTallies(
      prisma,
      contributions.map((contribution) => contribution.id)
    );

    // The current value of the contested field, read from the catalog now.
    const currentValues = new Map<string, string | null>();
    const skuIds = [...new Set(contributions.map((c) => c.sku.id))];
    if (skuIds.length > 0) {
      const skus = await prisma.sku.findMany({
        where: { id: { in: skuIds } },
        select: {
          id: true,
          cpuBrand: true, cpuModel: true, cpuCores: true, gpuModel: true,
          ramGb: true, ramType: true, ramSoldered: true,
          storageGb: true, storageType: true, storageSlots: true,
          displaySizeIn: true, displayResolution: true, displayType: true,
          displayRefreshHz: true, displayTouch: true, displayNits: true,
          weightKg: true, batteryWh: true, batteryLifeHours: true, npuTops: true,
          os: true, buildMaterial: true, linuxCompat: true,
          mpn: true, upc: true, productType: true,
        },
      });
      for (const sku of skus) {
        const row = sku as unknown as Record<string, unknown>;
        for (const contribution of contributions.filter((c) => c.sku.id === sku.id)) {
          if (!contribution.field) continue;
          currentValues.set(
            contribution.id,
            currentValueOf(row, contribution.field)
          );
        }
      }
    }

    return NextResponse.json({
      results: contributions.map((contribution) =>
        publicContribution(
          contribution,
          currentValues.get(contribution.id) ?? null,
          tallies[contribution.id]
        )
      ),
      pagination: {
        page,
        limit,
        totalResults: total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching contributions:", error);
    return NextResponse.json(
      { error: "Failed to fetch contributions" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "The request body must be valid JSON." },
      { status: 400 }
    );
  }

  const parsed = parseSubmission(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const input = parsed.value;

  try {
    const sku = await prisma.sku.findUnique({
      where: { skuCode: input.skuCode },
      select: { id: true, skuCode: true },
    });
    if (!sku) {
      return NextResponse.json(
        { error: `No configuration with the code ${input.skuCode}.` },
        { status: 404 }
      );
    }

    const user = await findOrCreateReporter(
      prisma,
      input.contributorEmail,
      input.contributorName
    );

    // One open report per field per reader. A second report on the same
    // field is a duplicate, not a new claim.
    const open = await prisma.contribution.findFirst({
      where: {
        userId: user.id,
        skuId: sku.id,
        field: input.field,
        status: { in: ["pending", "needs_evidence"] },
      },
      select: { id: true },
    });
    if (open) {
      return NextResponse.json(
        {
          error: "There is already an open report on this field. It is still waiting for review.",
          contributionId: open.id,
        },
        { status: 409 }
      );
    }

    // The value the field holds right now is the value the report contests.
    const skuRow = await prisma.sku.findUnique({ where: { id: sku.id } });
    const currentValue = currentValueOf(
      skuRow as unknown as Record<string, unknown>,
      input.field
    );

    const contribution = await prisma.contribution.create({
      data: {
        userId: user.id,
        skuId: sku.id,
        // A report without a source is kept, and it is kept as visibly
        // different: the reviewer sees that it carries no evidence.
        type: input.evidenceUrl ? "correction" : "unevidenced_correction",
        field: input.field,
        oldValue: currentValue,
        newValue: input.canonicalValue,
        evidenceUrl: input.evidenceUrl,
        evidenceText: input.evidenceText,
        status: "pending",
      },
    });

    const field = findCorrectableField(input.field);

    return NextResponse.json(
      {
        id: contribution.id,
        status: contribution.status,
        type: contribution.type,
        evidenced: Boolean(contribution.evidenceUrl),
        field: contribution.field,
        fieldLabel: field?.label ?? contribution.field,
        claimedValue: contribution.newValue,
        currentValue,
        sku: { id: sku.id, skuCode: sku.skuCode },
        createdAt: contribution.createdAt.toISOString(),
        message: input.evidenceUrl
          ? "Thank you. A reviewer will check your report against the source you cited."
          : "Thank you. Your report was recorded without a source, so a reviewer will ask for one before it can be applied.",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating contribution:", error);
    return NextResponse.json(
      { error: "Failed to record the contribution" },
      { status: 500 }
    );
  }
}
