import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Admin Authentication Middleware
 *
 * Supports two authentication methods:
 * 1. Bearer token (for API access): Authorization: Bearer <token>
 * 2. Session cookie (for browser access): admin_session=<token>
 *
 * The token is validated against ADMIN_TOKEN environment variable using a
 * constant-time comparison.
 */

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

/**
 * Constant-time string comparison without Node built-ins.
 *
 * Middleware compiles for the Edge runtime, which does not provide
 * `node:crypto` (timingSafeEqual). This implementation walks both strings
 * in full and accumulates a mismatch flag, so its runtime does not depend
 * on where the first difference occurs. It still performs an early length
 * check, which leaks only the length (acceptable for a fixed-format token).
 */
function safeEqual(a: string, b: string): boolean {
  if (!ADMIN_TOKEN || !a || !b) return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function isAuthenticated(request: NextRequest): boolean {
  if (!ADMIN_TOKEN) {
    console.error("ADMIN_TOKEN environment variable is not set");
    return false;
  }

  // Check Bearer token in Authorization header
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const token = authHeader.replace("Bearer ", "").trim();
    return safeEqual(ADMIN_TOKEN, token);
  }

  // Check session cookie (for browser-based access)
  const sessionCookie = request.cookies.get("admin_session")?.value;
  if (sessionCookie) {
    return safeEqual(ADMIN_TOKEN, sessionCookie);
  }

  return false;
}

export function middleware(request: NextRequest) {
  // Protect /admin and /api/admin routes
  if (
    request.nextUrl.pathname.startsWith("/admin") ||
    request.nextUrl.pathname.startsWith("/api/admin")
  ) {
    // Allow the login page and the login endpoint themselves. The login
    // endpoint sets the HttpOnly session cookie; it must be reachable
    // before a session exists.
    if (
      request.nextUrl.pathname === "/admin/login" ||
      request.nextUrl.pathname === "/api/admin/login"
    ) {
      return NextResponse.next();
    }

    if (!isAuthenticated(request)) {
      // For API routes, return 401
      if (request.nextUrl.pathname.startsWith("/api/")) {
        return new NextResponse(
          JSON.stringify({ error: "Unauthorized" }),
          {
            status: 401,
            headers: {
              "Content-Type": "application/json",
              "WWW-Authenticate": 'Bearer realm="admin"',
            },
          }
        );
      }

      // For browser routes, redirect to login
      const loginUrl = new URL("/admin/login", request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
