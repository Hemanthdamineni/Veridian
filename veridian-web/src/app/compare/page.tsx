import { Suspense } from "react";
import { CompareClient } from "./CompareClient";

export const metadata = {
  title: "Compare Laptops Side-by-Side | Veridian",
  description: "Compare two or more laptop configurations side-by-side with highlighted differences in specs and pricing.",
};

export default function ComparePage() {
  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <p className="text-sm font-medium uppercase tracking-wide text-blue-600">Decision workspace</p>
        <h1 className="text-3xl font-bold text-zinc-900 mt-1">Compare laptops</h1>
        <p className="text-zinc-500 mt-2">Meaningful differences are highlighted across the selected configurations.</p>
      </div>
      <Suspense fallback={<p className="text-zinc-500">Loading comparison...</p>}>
        <CompareClient />
      </Suspense>
    </main>
  );
}
