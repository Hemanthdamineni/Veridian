import type { Metadata } from "next";
import "./globals.css";
import Link from "next/link";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Veridian — Laptop Decision Platform",
  description:
    "Find the right laptop with verified specs, smart filters, and real-world data.",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col bg-zinc-50 text-zinc-900">
        <header className="border-b border-zinc-200 bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-2">
              <span className="text-xl font-bold">Veridian</span>
            </Link>
            <nav className="flex items-center gap-4 text-sm text-zinc-600">
              <Link href="/" className="hover:text-zinc-900">
                Browse
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-zinc-200 py-8 text-center text-sm text-zinc-500">
          Veridian — Trusted laptop specs for better decisions.
        </footer>
      </body>
    </html>
  );
}
