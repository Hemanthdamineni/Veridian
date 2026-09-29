import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { spawn } from "node:child_process";
import path from "node:path";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

let scraperRunning = false;

export async function POST() {
  if (scraperRunning) {
    return NextResponse.json({ status: "running" }, { status: 202 });
  }

  scraperRunning = true;
  const projectRoot = path.resolve(process.cwd(), "..");
  const runner = path.join(projectRoot, "run_scrapers.py");
  const scraper = spawn("python3", [runner, "--tier", "tier1", "--regions", "us", "--incremental"], {
    cwd: projectRoot,
    stdio: "ignore",
    detached: true,
  });

  scraper.once("error", () => {
    scraperRunning = false;
  });
  scraper.once("close", () => {
    scraperRunning = false;
    revalidatePath("/");
    revalidatePath("/api/skus");
  });
  scraper.unref();

  return NextResponse.json(
    { status: "started", startedAt: new Date().toISOString() },
    { status: 202 }
  );
}
