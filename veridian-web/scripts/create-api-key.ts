/**
 * Issue a public API key.
 *
 * The key is printed once and never stored: only its SHA-256 hash is kept,
 * so a database leak does not hand over working credentials. A key that is
 * lost cannot be recovered — it has to be replaced.
 *
 * Usage:
 *   npm run db:apikey -- --name "Acme integration" --limit 500
 *   npm run db:apikey -- --name "Acme integration" --scopes read,write
 */

import { prisma } from "../src/lib/db";
import { generateApiKey } from "../src/lib/api-key";

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main() {
  const name = flag("name") ?? "unnamed key";
  const scopes = (flag("scopes") ?? "read").split(",").map((s) => s.trim()).filter(Boolean);
  const rateLimit = Number(flag("limit") ?? 1000);
  const days = Number(flag("days") ?? 0);

  if (!Number.isInteger(rateLimit) || rateLimit < 1 || rateLimit > 100000) {
    throw new Error("--limit must be an integer from 1 to 100000");
  }
  if (!Number.isInteger(days) || days < 0) {
    throw new Error("--days must be a whole number of days (0 means no expiry)");
  }
  for (const scope of scopes) {
    if (!["read", "write", "admin"].includes(scope)) {
      throw new Error(`Unknown scope '${scope}'. Allowed: read, write, admin.`);
    }
  }

  const { key, hash } = generateApiKey();

  const record = await prisma.apiKey.create({
    data: {
      name,
      keyHash: hash,
      scopes: scopes.join(","),
      rateLimit,
      expiresAt:
        days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null,
    },
    select: { id: true, name: true, scopes: true, rateLimit: true, expiresAt: true },
  });

  console.log(
    JSON.stringify(
      {
        key,
        ...record,
        warning:
          "This key is shown once and cannot be recovered. Store it now.",
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("Could not issue an API key:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
