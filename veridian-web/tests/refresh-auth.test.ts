import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST as refresh } from "@/app/api/refresh/route";

function request(token?: string): NextRequest {
  return new NextRequest("http://localhost/api/refresh", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe("POST /api/refresh", () => {
  const previousToken = process.env.ADMIN_TOKEN;

  afterEach(() => {
    if (previousToken === undefined) delete process.env.ADMIN_TOKEN;
    else process.env.ADMIN_TOKEN = previousToken;
  });

  it("refuses to run when no admin token is configured", async () => {
    delete process.env.ADMIN_TOKEN;
    const response = await refresh(request("anything"));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.error).toMatch(/ADMIN_TOKEN/);
  });

  it("rejects a request with no token", async () => {
    process.env.ADMIN_TOKEN = "the-right-token";
    const response = await refresh(request());
    expect(response.status).toBe(401);
  });

  it("rejects a request with the wrong token", async () => {
    process.env.ADMIN_TOKEN = "the-right-token";
    const response = await refresh(request("the-wrong-token"));
    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  it("rejects a token that is a prefix of the right one", async () => {
    process.env.ADMIN_TOKEN = "the-right-token";
    const response = await refresh(request("the-right"));
    expect(response.status).toBe(401);
  });

  it("rejects an unsupported product type before doing any work", async () => {
    process.env.ADMIN_TOKEN = "the-right-token";
    const bad = new NextRequest("http://localhost/api/refresh?types=Desktop", {
      method: "POST",
      headers: { authorization: "Bearer the-right-token" },
    });
    const response = await refresh(bad);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.supported).toContain("Notebook");
  });

  it("rejects an out-of-range limit", async () => {
    process.env.ADMIN_TOKEN = "the-right-token";
    const bad = new NextRequest("http://localhost/api/refresh?limit=99999", {
      method: "POST",
      headers: { authorization: "Bearer the-right-token" },
    });
    const response = await refresh(bad);
    expect(response.status).toBe(400);
  });
});
