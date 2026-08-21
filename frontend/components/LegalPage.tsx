"use client";

import Link from "next/link";
import type { ReactNode } from "react";

// Shared shell for the static legal pages (privacy / terms). Plain, readable,
// theme-aware, no auth required.
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-paper px-5 py-10">
      <article className="mx-auto max-w-[720px]">
        <Link href="/" className="text-sm font-semibold text-sage hover:text-sage-deep">
          ← Lexa
        </Link>
        <h1 className="mt-4 font-serif text-[32px] font-medium tracking-[-0.01em] text-ink">{title}</h1>
        <p className="mt-1 text-[13px] text-ink-faint">Обновлено: {updated}</p>
        <div className="legal mt-6 space-y-5 text-[15px] leading-relaxed text-ink-soft">{children}</div>
      </article>
      <style jsx global>{`
        .legal h2 {
          font-family: var(--font-serif);
          font-size: 19px;
          font-weight: 600;
          color: var(--color-ink);
          margin-top: 1.6rem;
          margin-bottom: 0.4rem;
        }
        .legal ul {
          list-style: disc;
          padding-left: 1.3rem;
          display: flex;
          flex-direction: column;
          gap: 0.3rem;
        }
        .legal a {
          color: var(--color-sage-deep);
          font-weight: 600;
          text-decoration: underline;
        }
        .legal strong {
          color: var(--color-ink);
        }
      `}</style>
    </main>
  );
}
