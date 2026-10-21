import Link from "next/link";
import { ContributionQueue } from "@/components/admin/ContributionQueue";

export const dynamic = "force-dynamic";

/**
 * The review queue.
 *
 * This page lives under /admin, so the middleware refuses it without an admin
 * session, and the queue reads from /api/admin/contributions, which repeats
 * the same check in the handler.
 */
export default function AdminContributionsPage() {
  return (
    <div className="container py-10 sm:py-14">
      <header className="mb-8 max-w-3xl">
        <p className="eyebrow mb-2">Internal workspace</p>
        <h1 className="font-display text-[40px] tracking-[-.04em]">Corrections</h1>
        <p className="mt-2 text-[13px] leading-6 text-[var(--muted)]">
          Reports from readers about the configurations in this catalog. Accepting one writes the
          corrected value and records the reader&rsquo;s source; the value the field held before
          stays on the record.
        </p>
        <p className="mt-2 text-[13px] text-[var(--muted)]">
          <Link href="/admin" className="text-[var(--accent-dark)] underline underline-offset-4">
            Back to catalog curation
          </Link>
        </p>
      </header>

      <ContributionQueue />
    </div>
  );
}
