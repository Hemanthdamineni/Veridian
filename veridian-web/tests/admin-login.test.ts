import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as login } from "@/app/api/admin/login/route";

function request(token?: string): NextRequest {
  return new NextRequest("http://localhost/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: token === undefined ? "{}" : JSON.stringify({ token }),
  });
}

describe("POST /api/admin/login", () => {
  const previousToken = process.env.ADMIN_TOKEN;

  afterEach(() => {
    if (previousToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previousToken;
  });

  it("refuses when no admin token is configured", async () => {
    delete process.env.ADMIN_TOKEN;
    const response = await login(request("anything"));
    expect(response.status).toBe(503);
  });

  it("rejects a request with no token", async () => {
    process.env.ADMIN_TOKEN = "the-right-token";
    const response = await login(request());
    expect(response.status).toBe(401);
  });

  it("rejects a wrong token", async () => {
    process.env.ADMIN_TOKEN = "the-right-token";
    const response = await login(request("the-wrong-token"));
    expect(response.status).toBe(401);
  });

  it("sets an HttpOnly, SameSite, Secure-ready admin_session cookie on success", async () => {
    process.env.ADMIN_TOKEN = "the-right-token";
    const response = await login(request("the-right-token"));
    expect(response.status).toBe(200);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("admin_session=the-right-token");
    expect(setCookie).toContain("HttpOnly");
    // Next serialises the SameSite option lowercase; match it case-insensitively.
    expect(setCookie.toLowerCase()).toContain("samesite=strict");
    // The test request is http://, so the route does not add Secure; it is
    // added only over HTTPS, which the Secure branch covers.
  });
});