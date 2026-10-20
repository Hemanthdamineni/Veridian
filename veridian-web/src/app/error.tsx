"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="container flex min-h-[60vh] flex-col items-center justify-center py-16 text-center">
      <div className="surface max-w-lg p-10" role="alert">
        <p className="eyebrow mb-4">Something went wrong</p>
        <h1 className="font-display text-[32px] tracking-[-.03em]">We couldn&rsquo;t load this page.</h1>
        <p className="mx-auto mt-4 max-w-sm text-[14px] leading-6 text-[var(--muted)]">
          A temporary problem interrupted your request. Try again, or head back to the catalog.
        </p>
        <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
          <button type="button" onClick={reset} className="btn-primary">Try again</button>
          <Link href="/" className="btn-secondary">Back to the catalog</Link>
        </div>
      </div>
    </div>
  );
}
