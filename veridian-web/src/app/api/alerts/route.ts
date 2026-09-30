import { NextResponse } from "next/server";

const unavailable = () =>
  NextResponse.json(
    { error: "Alerts are unavailable until user authentication and ownership checks are configured." },
    { status: 503 }
  );

export async function GET() {
  return unavailable();
}

export async function POST() {
  return unavailable();
}

export async function PATCH() {
  return unavailable();
}

export async function DELETE() {
  return unavailable();
}
