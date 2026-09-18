import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Admin Authentication Middleware
 *
 * Supports two authentication methods:
 * 1. Bearer token (for API access): Authorization: Bearer <token>
 * 2. Session cookie (for browser access): admin_session=<token>
 *
 * The token is validated against ADMIN_TOKEN environment variable.
 */

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

function isAuthenticated(request: NextRequest): boolean {
  if (!ADMIN_TOKEN) {
    console.error("ADMIN_TOKEN environment variable is not set");
    return false;
  }

  // Check Bearer token in Authorization header
  const authHeader = request.headers.get("authorization");
  if (authHeader) {
    const token = authHeader.replace("Bearer ", "").trim();
    return token === ADMIN_TOKEN;
  }

  // Check session cookie (for browser-based access)
  const sessionCookie = request.cookies.get("admin_session")?.value;
  if (sessionCookie) {
    return sessionCookie === ADMIN_TOKEN;
  }

  return false;
}

export function middleware(request: NextRequest) {
  // Protect /admin and /api/admin routes
  if (
    request.nextUrl.pathname.startsWith("/admin") ||
    request.nextUrl.pathname.startsWith("/api/admin")
  ) {
    // Allow the login page itself
    if (request.nextUrl.pathname === "/admin/login") {
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
