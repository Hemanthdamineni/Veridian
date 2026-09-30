import { NextResponse } from "next/server";

/**
 * Community contributions are not yet enabled: they depend on user accounts
 * and audited review workflows that are out of scope for the current
 * catalog. The endpoints return 503 so no unauthenticated or placeholder
 * user data can be written or read.
 */
export async function GET() {
  return NextResponse.json(
    { error: "Contributions are not available yet." },
    { status: 503 }
  );
}

export async function POST() {
  return NextResponse.json(
    { error: "Contributions are not available yet." },
    { status: 503 }
  );
}
