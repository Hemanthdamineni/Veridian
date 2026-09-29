import { NextRequest, NextResponse } from "next/server";

/**
 * Public API v1
 *
 * Provides documented endpoints for external developers.
 * Authentication via API key in header: X-API-Key
 *
 * Endpoints:
 * - GET /api/v1/skus - List SKUs (public read access)
 * - GET /api/v1/skus/:id - Get SKU detail
 * - GET /api/v1/manufacturers - List manufacturers
 * - GET /api/v1/compare - Compare multiple SKUs
 * - GET /api/v1/recommendations - Get recommendations
 */

export async function GET(request: NextRequest) {
  const { pathname } = new URL(request.url);

  // Health check
  if (pathname === "/api/v1") {
    return NextResponse.json({
      name: "Veridian Public API",
      version: "1.0",
      documentation: "/api/v1/docs",
      endpoints: ["/skus", "/skus/:id", "/manufacturers", "/compare", "/recommendations"],
    });
  }

  // API info endpoint
  if (pathname === "/api/v1/docs") {
    return NextResponse.json({
      endpoints: {
        "/api/v1/skus": {
          method: "GET",
          description: "List laptops with filters",
          params: {
            cpu_brand: "Intel,AMD,Apple,Qualcomm",
            ram_min: "Minimum RAM in GB",
            storage_min: "Minimum storage in GB",
            display_type: "IPS,OLED,Mini-LED",
            weight_max: "Maximum weight in kg",
            price_min: "Minimum price",
            price_max: "Maximum price",
            region: "US,IN,UK,EU,CA",
            q: "Search query",
            page: "Page number",
            limit: "Items per page (max 100)",
          },
        },
        "/api/v1/skus/:id": {
          method: "GET",
          description: "Get full SKU details",
        },
        "/api/v1/manufacturers": {
          method: "GET",
          description: "List all manufacturers",
        },
        "/api/v1/compare": {
          method: "GET",
          description: "Compare multiple SKUs",
          params: {
            ids: "Comma-separated SKU IDs",
          },
        },
        "/api/v1/recommendations": {
          method: "GET",
          description: "Get AI recommendations",
          params: {
            budget: "Maximum budget",
            min_ram: "Minimum RAM",
            use_case: "programming,gaming,business,creative,student,travel",
          },
        },
      },
      authentication: {
        type: "API Key",
        header: "X-API-Key",
      },
    });
  }

  return NextResponse.json(
    { error: "Not found" },
    { status: 404 }
  );
}
