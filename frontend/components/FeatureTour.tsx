"use client";

import Link from "next/link";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { OPEN_ADD, open } from "@/lib/mobileNav";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  ArrowUpRight,
  BookOpen,
  ChevronRight,
  Compass,
  Folders,
  GraduationCap,
  LayoutGrid,
  Layers,
  Library,
  Plus,
  Send,
  Sparkles,
  Target,
} from "lucide-react";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "";

type Tile = { key: string; Icon: LucideIcon; href: string; onPhone?: () => void; external?: boolean };

// Everything the app does, one row each, at the foot of Today (the author,
// 2026-10-09): a newcomer sees what's here without opening every tab, and a
// regular gets to the less-used parts (the Reader, HSK lists, the bot) in one tap.
// Labels only — no counts, no model call. A list in a card like the rest of
// Today, not a grid of tiles: the tiles read as a landing page (2026-10-10).
export function FeatureTour() {
  const { profile } = useAccount();
  const { t } = useI18n();
  const version = profile?.hskVersion ?? "3.0";
  const level = profile?.hskTarget ?? 1;

  const tiles: Tile[] = [
    // The quick-add sheet is phone-only; a desktop gets the full form at the top of My words.
    { key: "add", Icon: Plus, href: "/words", onPhone: () => open(OPEN_ADD) },
    { key: "review", Icon: Layers, href: "/review" },
    { key: "coach", Icon: Compass, href: "/coach" },
    { key: "mika", Icon: Sparkles, href: "/mika" },
    { key: "reader", Icon: BookOpen, href: "/reader" },
    { key: "hsk", Icon: GraduationCap, href: `/hsk/${version}/${level}` },
    { key: "quiz", Icon: Target, href: "/quiz" },
    { key: "words", Icon: Library, href: "/words" },
    { key: "collections", Icon: Folders, href: "/collections" },
    ...(BOT_USERNAME ? [{ key: "bot", Icon: Send, href: `https://t.me/${BOT_USERNAME}`, external: true }] : []),
  ];

  const body = (tile: Tile) => (
    <>
      <tile.Icon className="h-[18px] w-[18px] shrink-0 text-ink-faint transition-colors group-hover:text-sage-deep" strokeWidth={2} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink">{t(`tour.${tile.key}`)}</span>
        <span className="block text-[13px] leading-snug text-ink-soft">{t(`tour.${tile.key}.d`)}</span>
      </span>
      {tile.external ? (
        <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-faint" />
      ) : (
        <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint transition-transform group-hover:translate-x-0.5" />
      )}
    </>
  );
  const cls = "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-black/[0.03]";

  return (
    <section className="anim-fade-up rounded-[24px] border border-black/[0.06] bg-surface p-6">
      <div className="flex items-center gap-2 text-sage-deep">
        <LayoutGrid className="h-5 w-5" />
        <h3 className="font-serif text-[20px] font-medium text-ink">{t("tour.title")}</h3>
      </div>
      <div className="-mx-3 mt-3 grid gap-x-4 gap-y-0.5 sm:grid-cols-2">
        {tiles.map((tile) =>
          tile.onPhone ? (
            <div key={tile.key}>
              <button type="button" onClick={tile.onPhone} className={cn(cls, "md:hidden")}>
                {body(tile)}
              </button>
              <Link href={tile.href} className={cn(cls, "hidden md:flex")}>
                {body(tile)}
              </Link>
            </div>
          ) : tile.external ? (
            <a key={tile.key} href={tile.href} target="_blank" rel="noopener noreferrer" className={cls}>
              {body(tile)}
            </a>
          ) : (
            <Link key={tile.key} href={tile.href} className={cls}>
              {body(tile)}
            </Link>
          ),
        )}
      </div>
    </section>
  );
}
