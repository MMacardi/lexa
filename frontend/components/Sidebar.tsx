"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, isDue } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { UsagePill } from "@/components/UsagePill";
import { Home, Layers, Target, BookOpen, Library, Folders, Users, Settings, MoreHorizontal, type LucideIcon } from "lucide-react";

const NAV: { href: string; key: string; Icon: LucideIcon }[] = [
  { href: "/", key: "nav.today", Icon: Home },
  { href: "/review", key: "nav.flashcards", Icon: Layers },
  { href: "/quiz", key: "nav.recall", Icon: Target },
  { href: "/reader", key: "nav.reader", Icon: BookOpen },
  { href: "/words", key: "nav.words", Icon: Library },
  { href: "/collections", key: "nav.collections", Icon: Folders },
  { href: "/friends", key: "nav.friends", Icon: Users },
];

// Mobile bottom bar shows only the daily study loop (home → flashcards → quiz →
// reader); the rest (words, collections, friends, account) live behind "More".
const MOBILE_PRIMARY = ["/", "/review", "/quiz", "/reader"];

const isActive = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

export function Sidebar() {
  const pathname = usePathname();
  const { accountId } = useAccount();
  const { t } = useI18n();
  const [moreOpen, setMoreOpen] = useState(false);
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

  // Split the nav for the mobile bar: daily-use tabs vs the "More" sheet.
  const primaryItems = NAV.filter((n) => MOBILE_PRIMARY.includes(n.href));
  const moreItems = NAV.filter((n) => !MOBILE_PRIMARY.includes(n.href));
  const moreActive = accountActive || moreItems.some((n) => isActive(n.href, pathname));

  return (
    <>
      {/* ---------- Desktop sidebar ---------- */}
      <aside className="hidden shrink-0 flex-col gap-6 border-r border-black/[0.07] bg-surface px-[18px] py-[26px] md:sticky md:top-0 md:flex md:h-screen md:w-[252px]">
        <Link href="/" aria-label={t("nav.today")} className="flex items-baseline gap-2 px-2.5 transition-opacity hover:opacity-80">
          <span className="font-serif text-[26px] font-semibold tracking-[-0.02em] text-ink">Lexa</span>
          <span className="h-[7px] w-[7px] rounded-full bg-sage" />
        </Link>

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
                <n.Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-sage-deep" : "text-ink-faint")} strokeWidth={2} />
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

        {/* daily AI-usage meter (free tier only) */}
        <UsagePill />

        {/* account entry */}
        <Link
          href="/account"
          className={cn(
            "flex items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
            accountActive ? "bg-sage-tint text-sage-deep" : "text-ink-muted hover:bg-black/[0.03]",
          )}
        >
          <span className="flex items-center gap-2 truncate">
            <Settings className="h-[18px] w-[18px] shrink-0" strokeWidth={2} />
            <span className="truncate">{t("side.account")}</span>
          </span>
        </Link>
      </aside>

      {/* ---------- Mobile top bar ---------- */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-black/[0.07] bg-surface/95 px-4 py-3 backdrop-blur md:hidden">
        <Link href="/" aria-label={t("nav.today")} className="flex items-baseline gap-2">
          <span className="font-serif text-[22px] font-semibold tracking-[-0.02em] text-ink">Lexa</span>
          <span className="h-[6px] w-[6px] rounded-full bg-sage" />
        </Link>
        <Link
          href="/account"
          aria-label={t("account.title")}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-full transition-colors",
            accountActive ? "bg-sage-tint text-sage-deep" : "text-ink-muted hover:bg-black/[0.04]",
          )}
        >
          <Settings className="h-[19px] w-[19px]" strokeWidth={2} />
        </Link>
      </header>

      {/* ---------- Mobile "More" sheet ---------- */}
      {moreOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={() => setMoreOpen(false)} />
          <div className="anim-fade-up fixed inset-x-3 bottom-[calc(58px_+_env(safe-area-inset-bottom))] z-40 rounded-[18px] border border-black/[0.08] bg-surface p-2 shadow-[0_18px_44px_rgba(46,42,38,0.26)] md:hidden">
            {[...moreItems, { href: "/account", key: "side.account", Icon: Settings }].map((n) => {
              const active = isActive(n.href, pathname);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  onClick={() => setMoreOpen(false)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[15px] font-semibold transition-colors",
                    active ? "bg-sage-tint text-sage-deep" : "text-ink-muted hover:bg-black/[0.03]",
                  )}
                >
                  <n.Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-sage-deep" : "text-ink-faint")} strokeWidth={2} />
                  {t(n.key)}
                </Link>
              );
            })}
          </div>
        </>
      )}

      {/* ---------- Mobile bottom tab bar ---------- */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-black/[0.08] bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {primaryItems.map((n) => {
          const active = isActive(n.href, pathname);
          return (
            <Link
              key={n.href}
              href={n.href}
              onClick={() => setMoreOpen(false)}
              className={cn(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-colors",
                active ? "text-sage-deep" : "text-ink-faint",
              )}
            >
              <n.Icon className={cn("h-[21px] w-[21px] transition-transform", active && "scale-110")} strokeWidth={2} />
              <span className="max-w-full truncate px-0.5">{t(n.key)}</span>
            </Link>
          );
        })}
        {/* More: opens the sheet with the remaining destinations */}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className={cn(
            "flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition-colors",
            moreActive || moreOpen ? "text-sage-deep" : "text-ink-faint",
          )}
        >
          <MoreHorizontal className={cn("h-[21px] w-[21px] transition-transform", (moreActive || moreOpen) && "scale-110")} strokeWidth={2} />
          <span className="max-w-full truncate px-0.5">{t("nav.more")}</span>
        </button>
      </nav>
    </>
  );
}
