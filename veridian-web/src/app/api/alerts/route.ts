import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Price Alerts API
 *
 * GET /api/alerts - List user's alerts
 * POST /api/alerts - Create a new alert
 */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");
    const activeOnly = searchParams.get("active") === "true";

    if (!userId) {
      return NextResponse.json(
        { error: "user_id is required" },
        { status: 400 }
      );
    }

    const where: Record<string, unknown> = { userId };
    if (activeOnly) {
      where.active = true;
    }

    const alerts = await prisma.alert.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
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

    return NextResponse.json(alerts);
  } catch (error) {
    console.error("Error fetching alerts:", error);
    return NextResponse.json(
      { error: "Failed to fetch alerts" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required fields
    const required = ["user_id", "sku_id", "region", "condition_type", "threshold_value", "channel"];
    for (const field of required) {
      if (body[field] === undefined) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Validate condition type
    const validConditions = ["below_price", "lowest_ever", "pct_off_msrp"];
    if (!validConditions.includes(body.condition_type)) {
      return NextResponse.json(
        { error: `Invalid condition_type. Must be one of: ${validConditions.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate channel
    const validChannels = ["email", "telegram", "discord", "push"];
    if (!validChannels.includes(body.channel)) {
      return NextResponse.json(
        { error: `Invalid channel. Must be one of: ${validChannels.join(", ")}` },
        { status: 400 }
      );
    }

    const alert = await prisma.alert.create({
      data: {
        userId: body.user_id,
        skuId: body.sku_id,
        region: body.region,
        conditionType: body.condition_type,
        thresholdValue: body.threshold_value,
        channel: body.channel,
        active: true,
      },
    });

    return NextResponse.json(alert, { status: 201 });
  } catch (error) {
    console.error("Error creating alert:", error);
    return NextResponse.json(
      { error: "Failed to create alert" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, ...updates } = body;

    if (!id) {
      return NextResponse.json(
        { error: "Alert id is required" },
        { status: 400 }
      );
    }

    const alert = await prisma.alert.update({
      where: { id },
      data: updates,
    });

    return NextResponse.json(alert);
  } catch (error) {
    console.error("Error updating alert:", error);
    return NextResponse.json(
      { error: "Failed to update alert" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "Alert id is required" },
        { status: 400 }
      );
    }

    await prisma.alert.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting alert:", error);
    return NextResponse.json(
      { error: "Failed to delete alert" },
      { status: 500 }
    );
  }
}
