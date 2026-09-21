"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, isDue } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { usePresence } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { UsagePill } from "@/components/UsagePill";
import dynamic from "next/dynamic";
import { OPEN_ADD, OPEN_BUG, OPEN_MIKA, SLOT_COUNT, DEFAULT_SLOTS, open, useLockScroll, useNavSlots } from "@/lib/mobileNav";
import { Home, Compass, Layers, Target, BookOpen, Library, Folders, Users, Settings, MoreHorizontal, Gauge, Sparkles, Globe, Bug, Plus, SlidersHorizontal, X, Check, type LucideIcon } from "lucide-react";

// The quick-add sheet's form is only needed once "+" is tapped — keep it out of
// the shell's first-load JS.
const AddWordForm = dynamic(() => import("@/components/AddWordForm").then((m) => m.AddWordForm), { ssr: false });

type NavItem = { href: string; key: string; Icon: LucideIcon };

const NAV: NavItem[] = [
  { href: "/", key: "nav.today", Icon: Home },
  { href: "/coach", key: "nav.coach", Icon: Compass },
  { href: "/mika", key: "nav.mika", Icon: Sparkles },
  { href: "/review", key: "nav.flashcards", Icon: Layers },
  { href: "/quiz", key: "nav.recall", Icon: Target },
  { href: "/reader", key: "nav.reader", Icon: BookOpen },
  { href: "/words", key: "nav.words", Icon: Library },
  { href: "/collections", key: "nav.collections", Icon: Folders },
  { href: "/community", key: "nav.community", Icon: Globe },
  { href: "/friends", key: "nav.friends", Icon: Users },
];

// Mobile bottom bar: three user-picked tabs around a fixed centre Mika button,
// then "More" (a sheet with everything else + the bar customizer). Mika itself
// isn't a slot option — it's always the centre button.
const SLOT_OPTIONS = NAV.map((n) => n.href).filter((h) => h !== "/mika");

const isActive = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

export function Sidebar() {
  const pathname = usePathname();
  const { accountId, profile } = useAccount();
  const { t } = useI18n();
  // Which phone sheet is open: the "More" grid or the quick-add form.
  const [sheet, setSheet] = useState<null | "more" | "add">(null);
  const [editing, setEditing] = useState(false);
  const [slots, setSlots] = useNavSlots(SLOT_OPTIONS);
  useLockScroll(sheet !== null);
  // Pages can open the quick-add sheet too (e.g. My words' compact "Add a word" row).
  useEffect(() => {
    const on = () => setSheet("add");
    window.addEventListener(OPEN_ADD, on);
    return () => window.removeEventListener(OPEN_ADD, on);
  }, []);
  // Every way of closing a sheet — scrim, ×, a link inside it, the tab bar —
  // goes through here; presence keeps it mounted long enough to slide away.
  const closeSheet = () => setSheet(null);
  const moreSheet = usePresence(sheet === "more", 200);
  const addSheet = usePresence(sheet === "add", 200);
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

  // Split the nav for the mobile bar: the user's 3 tabs vs everything else in "More".
  const slotItems = slots.map((h) => NAV.find((n) => n.href === h)).filter((n): n is NavItem => !!n);
  const moreItems: NavItem[] = [
    ...NAV.filter((n) => n.href !== "/mika" && !slots.includes(n.href)),
    ...(profile?.isAdmin ? [{ href: "/admin", key: "nav.admin", Icon: Gauge }] : []),
    { href: "/account", key: "side.account", Icon: Settings },
  ];
  const moreActive = moreItems.some((n) => isActive(n.href, pathname));

  return (
    <>
      {/* ---------- Desktop sidebar ---------- */}
      <aside className="hidden shrink-0 flex-col gap-6 border-r border-black/[0.07] bg-surface px-[18px] py-[26px] md:sticky md:top-0 md:flex md:h-screen md:w-[252px]">
        <Link href="/" aria-label={t("nav.today")} className="flex items-baseline gap-2 px-2.5 transition-opacity hover:opacity-80">
          <span className="font-serif text-[26px] font-semibold tracking-[-0.02em] text-ink">Onomika</span>
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
          {profile?.isAdmin && (
            <Link
              href="/admin"
              className={cn(
                "flex items-center gap-[11px] rounded-xl px-3.5 py-2.5 text-[15px] font-semibold transition-colors",
                isActive("/admin", pathname) ? "bg-sage-tint text-sage-deep" : "text-ink-muted hover:bg-black/[0.03]",
              )}
            >
              <Gauge className={cn("h-[18px] w-[18px] shrink-0", isActive("/admin", pathname) ? "text-sage-deep" : "text-ink-faint")} strokeWidth={2} />
              {t("nav.admin")}
            </Link>
          )}
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
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-black/[0.07] bg-surface/95 px-4 backdrop-blur md:hidden">
        <Link href="/" aria-label={t("nav.today")} className="flex items-baseline gap-2">
          <span className="font-serif text-[22px] font-semibold tracking-[-0.02em] text-ink">Onomika</span>
          <span className="h-[6px] w-[6px] rounded-full bg-sage" />
        </Link>
        <div className="flex items-center gap-1">
          {/* beta bug reporter (replaces the floating button on phones) */}
          <button
            type="button"
            onClick={() => open(OPEN_BUG)}
            aria-label={t("bug.button")}
            className="flex h-10 w-10 items-center justify-center rounded-full text-warn-text transition-colors hover:bg-black/[0.04]"
          >
            <Bug className="h-[19px] w-[19px]" strokeWidth={2} />
          </button>
          <Link
            href="/account"
            aria-label={t("account.title")}
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-full transition-colors",
              accountActive ? "bg-sage-tint text-sage-deep" : "text-ink-muted hover:bg-black/[0.04]",
            )}
          >
            <Settings className="h-[19px] w-[19px]" strokeWidth={2} />
          </Link>
          {/* quick add — reachable from every screen */}
          <button
            type="button"
            onClick={() => setSheet("add")}
            aria-label={t("nav.addWord")}
            className="ml-1 flex h-10 w-10 items-center justify-center rounded-full bg-sage text-white shadow-[0_6px_16px_rgba(63,90,74,0.35)] transition-transform active:scale-95"
          >
            <Plus className="h-[21px] w-[21px]" strokeWidth={2.4} />
          </button>
        </div>
      </header>

      {/* ---------- Mobile "More" sheet (+ bar customizer) ---------- */}
      {moreSheet.mounted && (
        <MobileSheet closing={moreSheet.closing} onClose={closeSheet} title={editing ? t("nav.customize") : t("nav.more")}>
          {editing ? (
            <BarCustomizer
              current={slots}
              onSave={(next) => {
                setSlots(next);
                setEditing(false);
              }}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                {moreItems.map((n) => {
                  const active = isActive(n.href, pathname);
                  return (
                    <Link
                      key={n.href}
                      href={n.href}
                      onClick={closeSheet}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-2xl px-1 py-3.5 text-center text-[12.5px] font-semibold leading-tight transition-colors",
                        active ? "bg-sage-tint text-sage-deep" : "bg-black/[0.03] text-ink-muted",
                      )}
                    >
                      <n.Icon className={cn("h-[22px] w-[22px]", active ? "text-sage-deep" : "text-ink-soft")} strokeWidth={1.9} />
                      {t(n.key)}
                    </Link>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-black/[0.14] py-3 text-[14px] font-semibold text-ink-muted transition-colors hover:bg-black/[0.03]"
              >
                <SlidersHorizontal className="h-4 w-4" />
                {t("nav.customize")}
              </button>
            </>
          )}
        </MobileSheet>
      )}

      {/* ---------- Mobile quick-add sheet ---------- */}
      {addSheet.mounted && (
        <MobileSheet closing={addSheet.closing} onClose={closeSheet} title={t("nav.addWord")} tall>
          <AddWordForm bare />
        </MobileSheet>
      )}

      {/* ---------- Mobile bottom tab bar: 2 tabs · Mika · 1 tab · More ---------- */}
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-black/[0.08] bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-[520px] items-stretch">
          {slotItems.slice(0, 2).map((n) => (
            <TabLink key={n.href} item={n} active={isActive(n.href, pathname)} label={t(n.key)} onClick={closeSheet} />
          ))}
          {/* centre: Mika opens the tutor sheet (the /mika page is the full-size tutor) */}
          <button
            type="button"
            onClick={() => {
              closeSheet();
              if (!pathname.startsWith("/mika")) open(OPEN_MIKA);
            }}
            aria-label={t("tutor.open")}
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 py-1 text-[10.5px] font-semibold text-sage-deep"
          >
            <span className="flex h-8 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-sage to-sage-deep text-white shadow-[0_6px_16px_rgba(63,90,74,0.35)] transition-transform active:scale-95">
              <Sparkles className="h-[19px] w-[19px]" strokeWidth={2.1} />
            </span>
            {t("nav.mika")}
          </button>
          {slotItems.slice(2).map((n) => (
            <TabLink key={n.href} item={n} active={isActive(n.href, pathname)} label={t(n.key)} onClick={closeSheet} />
          ))}
          <button
            type="button"
            onClick={() => {
              if (sheet === "more") return closeSheet();
              setEditing(false);
              setSheet("more");
            }}
            className={cn(
              "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-[10.5px] font-semibold transition-colors",
              moreActive || sheet === "more" ? "text-sage-deep" : "text-ink-faint",
            )}
          >
            {moreActive && <span className="anim-tab absolute inset-x-[30%] top-0 h-[2.5px] rounded-b-full bg-sage" />}
            <MoreHorizontal className="h-[22px] w-[22px]" strokeWidth={2} />
            <span className="max-w-full truncate px-0.5">{t("nav.more")}</span>
          </button>
        </div>
      </nav>
    </>
  );
}

function TabLink({ item, active, label, onClick }: { item: NavItem; active: boolean; label: string; onClick: () => void }) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      className={cn(
        "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-[10.5px] font-semibold transition-colors",
        active ? "text-sage-deep" : "text-ink-faint",
      )}
    >
      {/* active indicator: a short bar along the top edge */}
      {active && <span className="anim-tab absolute inset-x-[30%] top-0 h-[2.5px] rounded-b-full bg-sage" />}
      <item.Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.2 : 1.9} />
      <span className="max-w-full truncate px-0.5">{label}</span>
    </Link>
  );
}

// Phone bottom sheet: scrim + panel docked to the bottom of the visible viewport
// (so the keyboard never covers it), with a grab bar and a close button.
function MobileSheet({
  title,
  closing,
  onClose,
  tall,
  children,
}: {
  title: string;
  closing: boolean;
  onClose: () => void;
  tall?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <div
      data-closing={closing || undefined}
      className="anim-scrim vv-overlay z-40 flex flex-col justify-end bg-black/35 md:hidden"
      onClick={onClose}
    >
      <div
        data-closing={closing || undefined}
        className={cn(
          "anim-sheet flex max-h-[calc(100%-12px)] flex-col rounded-t-[24px] border-t border-black/[0.08] bg-surface shadow-[0_-12px_40px_rgba(46,42,38,0.25)]",
          tall && "min-h-[min(480px,calc(100%-12px))]",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-black/15" />
        <div className="flex items-center justify-between px-5 pt-2 pb-1">
          <h2 className="font-serif text-[20px] font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("nav.close")}
            className="-mr-2 flex h-9 w-9 items-center justify-center rounded-full text-ink-faint hover:bg-black/[0.04] hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))]">{children}</div>
      </div>
    </div>
  );
}

// Pick exactly 3 bar tabs. They're laid out in the main nav order, so the phone
// bar always reads the same way as the desktop sidebar.
function BarCustomizer({ current, onSave, onCancel }: { current: string[]; onSave: (s: string[]) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string[]>(current);
  const options = NAV.filter((n) => SLOT_OPTIONS.includes(n.href));
  const toggle = (href: string) =>
    setPicked((p) => (p.includes(href) ? p.filter((h) => h !== href) : p.length < SLOT_COUNT ? [...p, href] : p));
  return (
    <div>
      <p className="px-1 text-[13px] leading-snug text-ink-soft">
        {t("nav.customizeHint")}{" "}
        <span className="font-semibold text-sage-deep">{t("nav.customizePicked", { n: picked.length })}</span>
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {options.map((n) => {
          const on = picked.includes(n.href);
          const full = !on && picked.length >= SLOT_COUNT;
          return (
            <button
              key={n.href}
              type="button"
              onClick={() => toggle(n.href)}
              disabled={full}
              className={cn(
                "relative flex flex-col items-center gap-1.5 rounded-2xl border px-1 py-3.5 text-[12.5px] font-semibold leading-tight transition-colors",
                on ? "border-sage bg-sage-tint text-sage-deep" : "border-transparent bg-black/[0.03] text-ink-muted",
                full && "opacity-40",
              )}
            >
              {on && (
                <span className="absolute top-1.5 right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-sage text-white">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
              <n.Icon className="h-[22px] w-[22px]" strokeWidth={1.9} />
              {t(n.key)}
            </button>
          );
        })}
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setPicked(DEFAULT_SLOTS)}
          className="rounded-full px-3 py-2 text-[13px] font-semibold text-ink-soft hover:text-ink"
        >
          {t("nav.customizeReset")}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full px-3 py-2 text-[13px] font-semibold text-ink-soft hover:text-ink"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={() => onSave(options.map((n) => n.href).filter((h) => picked.includes(h)))}
          disabled={picked.length !== SLOT_COUNT}
          className="rounded-full bg-sage px-4 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-sage-deep disabled:opacity-40"
        >
          {t("common.save")}
        </button>
      </div>
    </div>
  );
}
