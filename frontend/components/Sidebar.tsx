"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, isDue } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", key: "nav.today", icon: "🏠" },
  { href: "/review", key: "nav.flashcards", icon: "🃏" },
  { href: "/quiz", key: "nav.recall", icon: "🎯" },
  { href: "/reader", key: "nav.reader", icon: "📖" },
  { href: "/words", key: "nav.words", icon: "📚" },
  { href: "/collections", key: "nav.collections", icon: "🗂" },
];

const isActive = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

export function Sidebar() {
  const pathname = usePathname();
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { data } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
  });
  const words = data ?? [];
  const total = words.length;
  const mastered = words.filter((w) => w.reviewCount >= 5).length;
  const due = words.filter(isDue).length;
  const pct = total ? Math.round((mastered / total) * 100) : 0;
  const accountActive = pathname.startsWith("/account");

  return (
    <>
      {/* ---------- Desktop sidebar ---------- */}
      <aside className="hidden shrink-0 flex-col gap-6 border-r border-black/[0.07] bg-surface px-[18px] py-[26px] md:sticky md:top-0 md:flex md:h-screen md:w-[252px]">
        <div className="flex items-baseline gap-2 px-2.5">
          <span className="font-serif text-[26px] font-semibold tracking-[-0.02em] text-ink">Lexa</span>
          <span className="h-[7px] w-[7px] rounded-full bg-sage" />
        </div>

        <nav className="mt-2 flex flex-col gap-1">
          {NAV.map((n) => {
            const active = isActive(n.href, pathname);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex items-center gap-[11px] rounded-xl px-3.5 py-2.5 text-[15px] font-semibold transition-colors",
                  active ? "bg-sage-tint text-sage-deep" : "text-ink-muted hover:bg-black/[0.03]",
                )}
              >
                <span className={cn("h-[7px] w-[7px] shrink-0 rounded-full", active ? "bg-sage" : "bg-[#cfc6b7]")} />
                {t(n.key)}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-[18px] bg-onyx p-[18px]">
          <div className="flex items-baseline gap-2">
            <span className="font-serif text-[30px] font-bold leading-none text-white">{mastered}</span>
            <span className="text-[13px] font-medium text-taupe-dim">{t("side.mastered")}</span>
          </div>
          <div className="mt-3.5 h-1.5 overflow-hidden rounded-full bg-white/[0.16]">
            <div className="h-full rounded-full bg-sage transition-[width] duration-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-2.5 text-xs font-medium text-taupe-dim">{t("side.collectedDue", { total, due })}</div>
        </div>

        {/* account entry */}
        <Link
          href="/account"
          className={cn(
            "flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
            accountActive ? "bg-sage-tint text-sage-deep" : "text-ink-muted hover:bg-black/[0.03]",
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <span>👤</span>
            <span className="truncate">{t("side.account")}</span>
          </span>
          <span className="text-ink-faint">⚙</span>
        </Link>
      </aside>

      {/* ---------- Mobile top bar ---------- */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-black/[0.07] bg-surface/95 px-4 py-3 backdrop-blur md:hidden">
        <div className="flex items-baseline gap-2">
          <span className="font-serif text-[22px] font-semibold tracking-[-0.02em] text-ink">Lexa</span>
          <span className="h-[6px] w-[6px] rounded-full bg-sage" />
        </div>
        <Link
          href="/account"
          aria-label={t("account.title")}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full text-[17px] transition-colors",
            accountActive ? "bg-sage-tint" : "hover:bg-black/[0.04]",
          )}
        >
          ⚙
        </Link>
      </header>

      {/* ---------- Mobile bottom tab bar ---------- */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-black/[0.08] bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map((n) => {
          const active = isActive(n.href, pathname);
          return (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-colors",
                active ? "text-sage-deep" : "text-ink-faint",
              )}
            >
              <span className={cn("text-[19px] leading-none transition-transform", active && "scale-110")}>
                {n.icon}
              </span>
              <span className="max-w-full truncate px-0.5">{t(n.key)}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
