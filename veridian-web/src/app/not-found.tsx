import Link from "next/link";

export default function NotFound() {
  return (
    <div className="container flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <div className="surface max-w-lg p-10">
        <p className="eyebrow mb-4">404</p>
        <h1 className="font-display text-[36px] tracking-[-.04em]">This page doesn&rsquo;t exist.</h1>
        <p className="mx-auto mt-4 max-w-sm text-[14px] leading-6 text-[var(--muted)]">
          The link may be broken, or the configuration you&rsquo;re looking for may have been removed
          from the catalog.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/" className="btn-primary">Back to the catalog</Link>
          <Link href="/compare" className="btn-secondary">Compare laptops</Link>
        </div>
      </div>
    </div>
  );
}
