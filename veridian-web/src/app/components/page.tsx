import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";

export const metadata: Metadata = {
  title: "Shared components | Veridian",
  description:
    "The processors, display classes and storage technologies the Veridian catalog is built from, and how many configurations use each one.",
  alternates: { canonical: "/components" },
};

const KIND_LABELS: Record<string, string> = {
  cpu: "Processors",
  display: "Display classes",
  storage: "Storage technologies",
};

export default async function ComponentsPage() {
  const components = await prisma.component.findMany({
    orderBy: [{ kind: "asc" }, { canonicalName: "asc" }],
    include: { _count: { select: { skus: true } } },
  });

  const byKind = new Map<string, typeof components>();
  for (const component of components) {
    const list = byKind.get(component.kind) ?? [];
    list.push(component);
    byKind.set(component.kind, list);
  }

  const totalLinks = await prisma.skuComponent.count();

  return (
    <div className="container py-10 sm:py-14">
      <header className="mb-10 max-w-3xl">
        <p className="eyebrow mb-3">The knowledge graph</p>
        <h1 className="font-display text-[clamp(32px,5vw,56px)] leading-[1.02] tracking-[-.04em] text-balance">
          Parts, not just rows.
        </h1>
        <p className="mt-5 max-w-xl text-[15px] leading-7 text-[var(--muted)]">
          Every configuration in Veridian is broken down into the components it is built around, so
          you can follow a processor or a display across the whole catalog instead of reading every
          specification sheet. {components.length.toLocaleString()} components,{" "}
          {totalLinks.toLocaleString()} links.
        </p>
      </header>

      <div className="space-y-12">
        {[...byKind.entries()].map(([kind, list]) => (
          <section key={kind}>
            <h2 className="label mb-4">
              {KIND_LABELS[kind] ?? kind}
              <span className="ml-2 font-mono text-[11px] text-[var(--quiet)]">{list.length}</span>
            </h2>
            <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {list.slice(0, 60).map((component) => (
                <li key={component.id}>
                  <Link
                    href={`/components/${component.slug}`}
                    className="surface flex items-baseline justify-between gap-3 px-4 py-3 transition-colors hover:border-[var(--line-strong)]"
                  >
                    <span className="min-w-0 truncate text-[13px] font-medium text-[var(--ink)]">
                      {component.canonicalName}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--quiet)]">
                      {component._count.skus}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {list.length > 60 && (
              <p className="mt-3 text-[12px] text-[var(--muted)]">
                Showing the first 60 of {list.length}. Use the API for the full list.
              </p>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
