import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

/**
 * Admin SKU Management API
 *
 * POST /api/admin/skus - Create a new SKU
 * GET /api/admin/skus - List all SKUs (paginated)
 */

// Valid enum values (must match Prisma schema)
const VALID_CPU_BRANDS = ["Intel", "AMD", "Qualcomm", "Apple"];
const VALID_RAM_TYPES = ["DDR5", "LPDDR5", "LPDDR5X"];
const VALID_STORAGE_TYPES = ["NVMe SSD", "SATA SSD", "eMMC"];
const VALID_DISPLAY_TYPES = ["IPS", "OLED", "Mini-LED"];
const VALID_BUILD_MATERIALS = ["Aluminum", "Magnesium", "Plastic", "Carbon Fiber"];
const VALID_LINUX_COMPAT = ["Good", "Partial", "Poor", "Untested"];

function validateSkuInput(body: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Required fields
  const required = ["modelId", "skuCode", "cpuBrand", "cpuModel", "ramGb", "ramType", "storageGb", "storageType", "displaySizeIn", "displayResolution", "displayType", "displayRefreshHz", "weightKg", "batteryWh", "os", "buildMaterial"];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null || body[field] === "") {
      errors.push(`Missing required field: ${field}`);
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  // Validate enum values
  if (!VALID_CPU_BRANDS.includes(body.cpuBrand as string)) {
    errors.push(`cpuBrand must be one of: ${VALID_CPU_BRANDS.join(", ")}`);
  }
  if (!VALID_RAM_TYPES.includes(body.ramType as string)) {
    errors.push(`ramType must be one of: ${VALID_RAM_TYPES.join(", ")}`);
  }
  if (!VALID_STORAGE_TYPES.includes(body.storageType as string)) {
    errors.push(`storageType must be one of: ${VALID_STORAGE_TYPES.join(", ")}`);
  }
  if (!VALID_DISPLAY_TYPES.includes(body.displayType as string)) {
    errors.push(`displayType must be one of: ${VALID_DISPLAY_TYPES.join(", ")}`);
  }
  if (!VALID_BUILD_MATERIALS.includes(body.buildMaterial as string)) {
    errors.push(`buildMaterial must be one of: ${VALID_BUILD_MATERIALS.join(", ")}`);
  }
  if (body.linuxCompat && !VALID_LINUX_COMPAT.includes(body.linuxCompat as string)) {
    errors.push(`linuxCompat must be one of: ${VALID_LINUX_COMPAT.join(", ")}`);
  }

  // Validate numeric ranges
  const ramGb = Number(body.ramGb);
  if (isNaN(ramGb) || ramGb < 1 || ramGb > 256) {
    errors.push("ramGb must be between 1 and 256");
  }

  const storageGb = Number(body.storageGb);
  if (isNaN(storageGb) || storageGb < 8 || storageGb > 8192) {
    errors.push("storageGb must be between 8 and 8192");
  }

  const displaySizeIn = Number(body.displaySizeIn);
  if (isNaN(displaySizeIn) || displaySizeIn < 7 || displaySizeIn > 25) {
    errors.push("displaySizeIn must be between 7 and 25");
  }

  const displayRefreshHz = Number(body.displayRefreshHz);
  if (isNaN(displayRefreshHz) || displayRefreshHz < 1 || displayRefreshHz > 1000) {
    errors.push("displayRefreshHz must be between 1 and 1000");
  }

  const weightKg = Number(body.weightKg);
  if (isNaN(weightKg) || weightKg < 0.1 || weightKg > 10) {
    errors.push("weightKg must be between 0.1 and 10");
  }

  const batteryWh = Number(body.batteryWh);
  if (isNaN(batteryWh) || batteryWh < 5 || batteryWh > 500) {
    errors.push("batteryWh must be between 5 and 500");
  }

  // Validate UUID format for modelId
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(body.modelId as string)) {
    errors.push("modelId must be a valid UUID");
  }

  return { valid: errors.length === 0, errors };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input
    const validation = validateSkuInput(body);
    if (!validation.valid) {
      return NextResponse.json(
        { error: "Validation failed", details: validation.errors },
        { status: 400 }
      );
    }

    // Check if SKU code already exists
    const existing = await prisma.sku.findUnique({
      where: { skuCode: body.skuCode as string },
    });
    if (existing) {
      return NextResponse.json(
        { error: "SKU code already exists" },
        { status: 409 }
      );
    }

    // Verify model exists
    const model = await prisma.model.findUnique({
      where: { id: body.modelId as string },
    });
    if (!model) {
      return NextResponse.json(
        { error: "Model not found" },
        { status: 404 }
      );
    }

    // Create SKU with validated data
    const sku = await prisma.sku.create({
      data: {
        modelId: body.modelId as string,
        skuCode: body.skuCode as string,
        cpuBrand: body.cpuBrand as string,
        cpuModel: body.cpuModel as string,
        cpuCores: body.cpuCores ? Number(body.cpuCores) : null,
        gpuModel: (body.gpuModel as string) || null,
        ramGb: Number(body.ramGb),
        ramType: body.ramType as string,
        ramSoldered: Boolean(body.ramSoldered),
        storageGb: Number(body.storageGb),
        storageType: body.storageType as string,
        storageSlots: body.storageSlots ? Number(body.storageSlots) : null,
        displaySizeIn: Number(body.displaySizeIn),
        displayResolution: body.displayResolution as string,
        displayType: body.displayType as string,
        displayRefreshHz: Number(body.displayRefreshHz),
        displayTouch: Boolean(body.displayTouch),
        displayNits: body.displayNits ? Number(body.displayNits) : null,
        weightKg: Number(body.weightKg),
        batteryWh: Number(body.batteryWh),
        batteryLifeHours: body.batteryLifeHours ? Number(body.batteryLifeHours) : null,
        npuTops: body.npuTops ? Number(body.npuTops) : null,
        os: body.os as string,
        buildMaterial: body.buildMaterial as string,
        linuxCompat: (body.linuxCompat as string) || null,
      },
    });

    return NextResponse.json(sku, { status: 201 });
  } catch (error) {
    console.error("Error creating SKU:", error);
    return NextResponse.json(
      { error: "Failed to create SKU" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = Math.min(50, parseInt(searchParams.get("limit") || "20", 10));

    const [skus, total] = await Promise.all([
      prisma.sku.findMany({
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          model: {
            include: {
              series: {
                include: { manufacturer: true },
              },
            },
          },
          pricing: true,
        },
      }),
      prisma.sku.count(),
    ]);

    return NextResponse.json({
      results: skus,
      pagination: {
        page,
        limit,
        totalResults: total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error fetching SKUs:", error);
    return NextResponse.json(
      { error: "Failed to fetch SKUs" },
      { status: 500 }
    );
  }
}
