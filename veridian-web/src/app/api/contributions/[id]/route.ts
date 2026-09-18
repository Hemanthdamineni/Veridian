import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Single Contribution API
 *
 * GET /api/contributions/:id - Get contribution details
 * PATCH /api/contributions/:id - Update contribution (review)
 * POST /api/contributions/:id/votes - Vote on contribution
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
    });

    if (!contribution) {
      return NextResponse.json(
        { error: "Contribution not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(contribution);
  } catch (error) {
    console.error("Error fetching contribution:", error);
    return NextResponse.json(
      { error: "Failed to fetch contribution" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Only allow status updates for review
    const allowedUpdates = ["status", "reviewed_by"];
    const updates: Record<string, unknown> = {};

    for (const key of allowedUpdates) {
      if (body[key] !== undefined) {
        updates[key] = body[key];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const contribution = await prisma.contribution.update({
      where: { id },
      data: updates,
    });

    return NextResponse.json(contribution);
  } catch (error) {
    console.error("Error updating contribution:", error);
    return NextResponse.json(
      { error: "Failed to update contribution" },
      { status: 500 }
    );
  }
}

// POST /api/contributions/:id/votes
// Note: Voting requires the Vote model which is available in PostgreSQL only
// This endpoint is a placeholder for the SQLite development version
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return NextResponse.json(
    {
      message: "Voting is available in the PostgreSQL production version",
      vote: {
        user_id: "placeholder",
        contribution_id: (await params).id,
        value: 1,
      },
    },
    { status: 200 }
  );
}
