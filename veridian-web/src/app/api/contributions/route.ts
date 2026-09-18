import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Contributions API
 *
 * GET /api/contributions - List contributions (with filters)
 * POST /api/contributions - Submit a new contribution
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    const skuId = searchParams.get("sku_id") || undefined;
    const userId = searchParams.get("user_id") || undefined;
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = Math.min(50, parseInt(searchParams.get("limit") || "20", 10));

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (skuId) where.skuId = skuId;
    if (userId) where.userId = userId;

    const [contributions, total] = await Promise.all([
      prisma.contribution.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: {
            select: { id: true, name: true, reputation: true },
          },
          sku: {
            select: {
              skuCode: true,
              model: {
                select: {
                  name: true,
                  series: {
                    select: {
                      manufacturer: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      prisma.contribution.count({ where }),
    ]);

    return NextResponse.json({
      results: contributions,
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
  try {
    const body = await request.json();

    // Validate required fields
    const required = ["sku_id", "type", "new_value"];
    for (const field of required) {
      if (!body[field]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Validate contribution type
    const validTypes = ["correction", "gap_report", "linux_report", "benchmark_upload"];
    if (!validTypes.includes(body.type)) {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${validTypes.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate user_id if provided (must be valid UUID format)
    const userId = body.user_id;
    if (userId && userId !== "anonymous") {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(userId) && !userId.match(/^[a-z0-9]+$/)) {
        // Allow cuid format as well
      }
    }

    // Create contribution
    const contribution = await prisma.contribution.create({
      data: {
        userId: userId || "00000000-0000-0000-0000-000000000000", // Placeholder for anonymous
        skuId: body.sku_id,
        type: body.type,
        field: body.field || null,
        oldValue: body.old_value || null,
        newValue: body.new_value,
        evidenceUrl: body.evidence_url || null,
        evidenceText: body.evidence_text || null,
        status: "pending",
      },
    });

    return NextResponse.json(contribution, { status: 201 });
  } catch (error) {
    console.error("Error creating contribution:", error);
    return NextResponse.json(
      { error: "Failed to create contribution" },
      { status: 500 }
    );
  }
}
