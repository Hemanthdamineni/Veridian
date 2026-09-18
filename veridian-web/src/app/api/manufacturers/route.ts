import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { ManufacturerItem } from "@/types";

// Force dynamic rendering
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const manufacturers = await prisma.manufacturer.findMany({
      orderBy: { name: "asc" },
    });

    const results: ManufacturerItem[] = manufacturers.map((m) => ({
      id: m.id,
      name: m.name,
      slug: m.slug,
      country: m.country,
      websiteUrl: m.websiteUrl,
      logoUrl: m.logoUrl,
    }));

    return NextResponse.json(results);
  } catch (error) {
    console.error("Error fetching manufacturers:", error);
    return NextResponse.json(
      { error: "Failed to fetch manufacturers" },
      { status: 500 }
    );
  }
}
