import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  checkAdminRequest,
  currentValueOf,
  findCorrectableField,
  voteTallies,
} from "@/lib/contributions";

export const dynamic = "force-dynamic";

/**
 * The review queue.
 *
 * GET /api/admin/contributions?status=pending
 *
 * Every queued correction, with the field it claims, the value it claims,
 * the value the catalog holds right now, the evidence it carries and the
 * person who sent it. The endpoint is admin-only: the middleware refuses
 * `/api/admin/*` without a token, and the handler repeats the same
 * constant-time check so the queue stays closed on its own terms.
 */
export async function GET(request: NextRequest) {
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
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const skuCode = searchParams.get("sku_code");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));

    const where: Prisma.ContributionWhereInput = {};
    if (status) {
      where.status = status;
    } else {
      // The queue is what still needs a decision: reports waiting for a
      // first look, and reports the reviewer asked for more evidence on.
      where.status = { in: ["pending", "needs_evidence"] };
    }
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

    const [contributions, total] = await Promise.all([
      prisma.contribution.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "asc" },
        include: {
          user: {
            select: { id: true, name: true, email: true, emailVerified: true, reputation: true },
          },
          sku: {
            select: {
              id: true,
              skuCode: true,
              model: {
                select: {
                  name: true,
                  series: { select: { name: true, manufacturer: { select: { name: true } } } },
                },
              },
            },
          },
        },
      }),
      prisma.contribution.count({ where }),
    ]);

    const tallies = await voteTallies(
      prisma,
      contributions.map((contribution) => contribution.id)
    );

    // The value the catalog holds now, for the field each report contests.
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
          currentValues.set(contribution.id, currentValueOf(row, contribution.field));
        }
      }
    }

    return NextResponse.json({
      results: contributions.map((contribution) => {
        const field = contribution.field
          ? findCorrectableField(contribution.field)
          : undefined;
        return {
          id: contribution.id,
          type: contribution.type,
          status: contribution.status,
          field: contribution.field,
          fieldLabel: field?.label ?? contribution.field,
          /** The value the reader says is correct. */
          claimedValue: contribution.newValue,
          /** The value the catalog holds right now. */
          currentValue: currentValues.get(contribution.id) ?? null,
          /** The value the field held when the report was filed. */
          reportedValue: contribution.oldValue,
          /** False when the report carries no source. */
          evidenced: Boolean(contribution.evidenceUrl),
          evidenceUrl: contribution.evidenceUrl,
          evidenceText: contribution.evidenceText,
          submitter: {
            id: contribution.user.id,
            name: contribution.user.name,
            email: contribution.user.email,
            /** The address was never confirmed, so the report is unverified. */
            emailVerified: contribution.user.emailVerified,
            reputation: contribution.user.reputation,
          },
          votes: tallies[contribution.id],
          sku: {
            id: contribution.sku.id,
            skuCode: contribution.sku.skuCode,
            modelName: contribution.sku.model.name,
            seriesName: contribution.sku.model.series.name,
            manufacturerName: contribution.sku.model.series.manufacturer.name,
          },
          createdAt: contribution.createdAt.toISOString(),
          updatedAt: contribution.updatedAt.toISOString(),
        };
      }),
      pagination: {
        page,
        limit,
        totalResults: total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching the contribution queue:", error);
    return NextResponse.json(
      { error: "Failed to fetch the contribution queue" },
      { status: 500 }
    );
  }
}
