"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const LINKS = [
  { href: "/", label: "Catalog" },
  { href: "/components", label: "Components" },
  { href: "/compare", label: "Compare" },
  { href: "/methodology", label: "Methodology" },
];

export function SiteNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  return (
    <>
      <nav aria-label="Primary" className="hidden items-center gap-1 sm:flex">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            aria-current={isActive(l.href) ? "page" : undefined}
            className={`rounded px-3 py-2 transition-colors ${
              isActive(l.href)
                ? "bg-[#eceae5] text-[var(--ink)]"
                : "text-[var(--muted)] hover:bg-[#eceae5] hover:text-[var(--ink)]"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="sm:hidden">
        <button
          type="button"
          className="rounded px-2 py-1.5 text-[var(--muted)] hover:bg-[#eceae5]"
          aria-expanded={open}
          aria-controls="mobile-nav"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
        {open && (
          <div id="mobile-nav" className="absolute inset-x-0 top-[68px] z-40 border-b border-[var(--line)] bg-[var(--canvas)] px-4 pb-4 shadow-[0_12px_24px_rgba(23,24,23,.06)]">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                aria-current={isActive(l.href) ? "page" : undefined}
                className={`block rounded px-3 py-3 text-[15px] font-medium ${isActive(l.href) ? "bg-[#eceae5] text-[var(--ink)]" : "text-[var(--muted)]"}`}
              >
                {l.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
