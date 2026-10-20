import { Suspense } from "react";
import { CompareClient } from "./CompareClient";

export const metadata = {
  title: "Compare laptops | Veridian",
  description: "Compare laptop configurations side by side with the differences made clear.",
};

export default function ComparePage() {
  return (
    <div className="container py-12 sm:py-16">
      <header className="mb-10 max-w-2xl">
        <p className="eyebrow mb-3">Decision workspace</p>
        <h1 className="font-display text-[clamp(38px,5vw,58px)] leading-[1] tracking-[-.045em] text-balance">Compare what matters.</h1>
        <p className="mt-5 max-w-xl text-[15px] leading-7 text-[var(--muted)]">See the trade-offs between configurations without opening a dozen tabs. Differences are highlighted; missing data stays visible.</p>
      </header>
      <Suspense fallback={<CompareLoading />}>
        <CompareClient />
      </Suspense>
    </div>
  );
}

function CompareLoading() {
  return <div className="surface p-8" aria-busy="true" aria-label="Loading comparison"><div className="h-4 w-40 animate-pulse rounded bg-[#ebe9e4]" /><div className="mt-5 h-32 animate-pulse rounded bg-[#f0efeb]" /></div>;
}
