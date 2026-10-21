import Link from "next/link";
import { KeyManager } from "@/components/admin/KeyManager";
import { listApiKeys } from "@/lib/admin-keys";
import type { ApiKeyView } from "@/lib/admin-keys";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "API keys | Veridian admin",
  robots: { index: false, follow: false },
};

/**
 * The API key management dashboard.
 *
 * The list is read from the database on the server, through the same query
 * the API route uses, so there is one definition of what a key looks like.
 * Creating, disabling and revoking go through the admin API.
 *
 * A key is shown to its owner once, when it is issued. Only a hash of it is
 * stored, so no page in this dashboard can show a key that already exists.
 */
export default async function AdminKeysPage() {
  let keys: ApiKeyView[] = [];
  let error: string | null = null;

  try {
    const result = await listApiKeys();
    keys = result.keys;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Unknown error";
  }

  return (
    <div className="container py-10 sm:py-14">
      <nav aria-label="Admin sections" className="mb-8">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link
              href="/admin"
              className="inline-flex min-h-[34px] items-center rounded-[5px] border border-[var(--line-strong)] px-3 text-[12px] text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
            >
              Catalog
            </Link>
          </li>
          <li>
            <Link
              href="/admin/quality"
              className="inline-flex min-h-[34px] items-center rounded-[5px] border border-[var(--line-strong)] px-3 text-[12px] text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)]"
            >
              Data quality
            </Link>
          </li>
          <li>
            <Link
              href="/admin/keys"
              aria-current="page"
              className="inline-flex min-h-[34px] items-center rounded-[5px] border border-[var(--ink)] bg-[var(--ink)] px-3 text-[12px] text-white"
            >
              API keys
            </Link>
          </li>
        </ul>
      </nav>

      <header className="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="eyebrow mb-2">Internal workspace</p>
          <h1 className="font-display text-[40px] tracking-[-.04em]">API keys</h1>
          <p className="mt-2 max-w-[62ch] text-[13px] leading-6 text-[var(--muted)]">
            Issue, disable and revoke the keys that authenticate the public API. A key is shown
            once, when it is issued; only a hash of it is kept.
          </p>
        </div>
        <span className="font-mono text-[11px] text-[var(--quiet)]">{keys.length} issued</span>
      </header>

      {error ? (
        <div className="surface border-[var(--danger)] p-6" role="alert">
          <p className="font-semibold">The keys could not be loaded</p>
          <p className="mt-2 text-[13px] text-[var(--muted)]">{error}</p>
          <p className="mt-3 text-[13px] text-[var(--muted)]">
            Please ensure DATABASE_URL is configured and the database is accessible.
          </p>
        </div>
      ) : (
        <KeyManager initialKeys={keys} />
      )}
    </div>
  );
}
