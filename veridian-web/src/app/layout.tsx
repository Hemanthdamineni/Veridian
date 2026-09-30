import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Veridian — Laptop Decision Platform",
  description:
    "Filter laptop catalog by specs and pricing. Catalog is currently populated from local seed data and not independently verified.",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col text-zinc-950">
        <header className="border-b border-[#cbd9df] bg-white/95 backdrop-blur">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#075e68] text-sm font-black text-white">V</span>
              <span className="text-xl font-bold tracking-tight text-[#102033]">Veridian</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm font-semibold text-[#365064]">
              <Link href="/" className="hover:text-[#075e68]">Browse catalog</Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-[#cbd9df] bg-white/70 py-8 text-center text-sm font-medium text-[#526579]">
          Veridian — laptop specs and pricing catalog. Seed data is for exploration only; verify details before purchase.
        </footer>
      </body>
    </html>
  );
}
