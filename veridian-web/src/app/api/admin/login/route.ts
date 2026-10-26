import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Admin login — POST /api/admin/login
 *
 * Validates the submitted admin token and, on success, sets the `admin_session`
 * cookie server-side. The cookie is HttpOnly (a script on the page cannot read
 * the token back out), SameSite=Strict and Secure on HTTPS, with a 24-hour
 * lifetime. The middleware then reads this cookie and protects /admin and
 * /api/admin against every request.
 *
 * The token is compared in constant time. A wrong or missing token is
 * rejected with 401; the login route itself is the only /api/admin route the
 * middleware lets through.
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const submitted =
    body && typeof body === "object" && "token" in body && typeof body.token === "string"
      ? body.token
      : "";

  const expected = process.env.ADMIN_TOKEN ?? "";
  if (!expected) {
    // No token configured: report it, never accept a comparison against "".
    return NextResponse.json(
      { error: "ADMIN_TOKEN is not configured; the admin login is disabled." },
      { status: 503 }
    );
  }

  if (!submitted || !safeEqual(expected, submitted)) {
    return NextResponse.json(
      { error: "unauthorized", message: "Invalid admin token." },
      { status: 401 }
    );
  }

  const response = NextResponse.json({ ok: true });
  const secure = request.nextUrl.protocol === "https:";
  response.cookies.set("admin_session", expected, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure,
    maxAge: 60 * 60 * 24,
  });
  return response;
}

/** Constant-time comparison, so a wrong token cannot be found by timing. */
function safeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}