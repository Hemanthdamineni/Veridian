import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST() {
  return NextResponse.json(
    { error: "Catalog refresh is unavailable until a compliant ingestion pipeline is configured." },
    { status: 503 }
  );
}
