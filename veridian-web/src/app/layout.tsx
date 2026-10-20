import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";
import { SiteNav } from "@/components/SiteNav";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: {
    default: "Veridian — Laptop intelligence, without the noise",
    template: "%s | Veridian",
  },
  description: "A structured, source-aware catalog for choosing laptops with confidence.",
  applicationName: "Veridian",
  keywords: ["laptop specs", "laptop comparison", "ultrabook catalog", "laptop research"],
  openGraph: {
    type: "website",
    siteName: "Veridian",
    title: "Veridian — Laptop intelligence, without the noise",
    description: "A structured, source-aware catalog for choosing laptops with confidence.",
  },
  twitter: {
    card: "summary",
    title: "Veridian — Laptop intelligence, without the noise",
    description: "A structured, source-aware catalog for choosing laptops with confidence.",
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main-content" className="skip-link">Skip to content</a>
        <header className="border-b border-[var(--line)] bg-[var(--canvas)]">
          <div className="container flex h-[68px] items-center justify-between">
            <Link href="/" className="flex items-center gap-3" aria-label="Veridian home">
              <span className="flex h-8 w-8 items-center justify-center rounded-[5px] bg-[var(--ink)] text-[13px] font-semibold text-white">V</span>
              <span className="font-display text-[22px] tracking-[-.03em]">Veridian</span>
            </Link>
          <SiteNav />
        </div>
      </header>
        <main id="main-content" className="min-h-[calc(100vh-140px)]">{children}</main>
        <footer className="border-t border-[var(--line)] py-8">
          <div className="container flex flex-col gap-3 text-[12px] text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between">
            <p>Veridian is an independent laptop research project.</p>
            <div className="flex gap-4"><Link href="/methodology" className="hover:text-[var(--ink)]">How data works</Link><Link href="/admin" className="hover:text-[var(--ink)]">Curation</Link></div>
          </div>
        </footer>
      </body>
    </html>
  );
}
