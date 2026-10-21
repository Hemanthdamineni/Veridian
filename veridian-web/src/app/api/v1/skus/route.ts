import { NextRequest, NextResponse } from "next/server";
import { authenticateApiKey } from "@/lib/api-key";
import { listConfigurations, readListParams } from "@/lib/public-api";

export const dynamic = "force-dynamic";

/**
 * Public API — configurations.
 *
 * GET /api/v1/skus
 *
 * Requires an API key. The key is presented in the `X-API-Key` header or as
 * a bearer token, and each key has an hourly request budget.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateApiKey(request);
  if ("response" in auth) return auth.response;

  const { params } = readListParams(request.nextUrl.searchParams);
  const { total, rows } = await listConfigurations(params);

  return NextResponse.json({
    pagination: {
      page: params.page,
      limit: params.limit,
      totalResults: total,
      totalPages: Math.ceil(total / params.limit),
    },
    results: rows.map((sku) => ({
      id: sku.id,
      skuCode: sku.skuCode,
      partNumber: sku.mpn,
      modelName: sku.model.name,
      seriesName: sku.model.series.name,
      manufacturer: sku.model.series.manufacturer.name,
      provenance: sku.provenance,
      cpu: { brand: sku.cpuBrand, model: sku.cpuModel, cores: sku.cpuCores },
      memory: { gb: sku.ramGb, type: sku.ramType, soldered: sku.ramSoldered },
      storage: { gb: sku.storageGb, type: sku.storageType, slots: sku.storageSlots },
      display: {
        sizeIn: sku.displaySizeIn,
        resolution: sku.displayResolution,
        type: sku.displayType,
        refreshHz: sku.displayRefreshHz,
        touch: sku.displayTouch,
        nits: sku.displayNits,
      },
      weightKg: sku.weightKg,
      batteryWh: sku.batteryWh,
      os: sku.os,
      price: sku.pricing[0]
        ? {
            region: sku.pricing[0].region,
            currency: sku.pricing[0].currency,
            msrp: sku.pricing[0].msrp,
            note: "Manufacturer suggested price recorded at the last update. Not a live retail price.",
          }
        : null,
    })),
  });
}
