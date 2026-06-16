"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, isDue } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Today" },
  { href: "/review", label: "Flashcards" },
  { href: "/quiz", label: "Recall check" },
  { href: "/words", label: "My words" },
];

export function Sidebar() {
  const pathname = usePathname();
  const { accountId } = useAccount();
  const { data } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
  });
  const words = data ?? [];
  const total = words.length;
  const mastered = words.filter((w) => w.reviewCount >= 5).length;
  const due = words.filter(isDue).length;
  const pct = total ? Math.round((mastered / total) * 100) : 0;

  return (
    <aside className="flex shrink-0 flex-col gap-6 border-b border-black/[0.07] bg-surface px-4 py-5 md:sticky md:top-0 md:h-screen md:w-[252px] md:border-b-0 md:border-r md:px-[18px] md:py-[26px]">
      <div className="flex items-center justify-between md:block">
        <div className="flex items-baseline gap-2 px-2 md:px-2.5">
          <span className="font-serif text-[26px] font-semibold tracking-[-0.02em] text-ink">
            Lexa
          </span>
          <span className="h-[7px] w-[7px] rounded-full bg-sage" />
        </div>
      </div>

      <nav className="flex flex-wrap gap-1 md:mt-2 md:flex-col">
        {NAV.map((n) => {
          const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "flex items-center gap-[11px] rounded-xl px-3.5 py-2.5 text-[15px] font-semibold transition-colors",
                active
                  ? "bg-sage-tint text-sage-deep"
                  : "text-ink-muted hover:bg-black/[0.03]",
              )}
            >
              <span
                className={cn(
                  "h-[7px] w-[7px] shrink-0 rounded-full transition-colors",
                  active ? "bg-sage" : "bg-[#cfc6b7]",
                )}
              />
              {n.label}
            </Link>
          );
        })}
      </nav>

      {/* progress card (real data) — hidden on mobile */}
      <div className="mt-auto hidden rounded-[18px] bg-ink p-[18px] md:block">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-[30px] font-bold leading-none text-white">
            {mastered}
          </span>
          <span className="text-[13px] font-medium text-taupe-dim">words mastered</span>
        </div>
        <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-white/[0.16]">
          <div
            className="h-full rounded-full bg-sage transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-2.5 text-xs font-medium text-taupe-dim">
          {total} collected · {due} due
        </div>
      </div>
    </aside>
  );
}
