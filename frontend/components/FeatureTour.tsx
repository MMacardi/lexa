"use client";

import Link from "next/link";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { OPEN_ADD, open } from "@/lib/mobileNav";
import type { LucideIcon } from "lucide-react";
import { BookOpen, Compass, Folders, GraduationCap, Layers, Library, Plus, Send, Sparkles, Target } from "lucide-react";

const BOT_USERNAME = process.env.NEXT_PUBLIC_BOT_USERNAME ?? "";

type Tile = { key: string; Icon: LucideIcon; href?: string; onClick?: () => void; external?: boolean };

// Everything the app does, one tile each, at the foot of Today (the author,
// 2026-10-09): a newcomer sees what's here without opening every tab, and a
// regular gets to the less-used parts (the Reader, HSK lists, the bot) in one tap.
// Labels only — no counts, no model call.
export function FeatureTour() {
  const { profile } = useAccount();
  const { t } = useI18n();
  const version = profile?.hskVersion ?? "3.0";
  const level = profile?.hskTarget ?? 1;

  const tiles: Tile[] = [
    { key: "add", Icon: Plus, onClick: () => open(OPEN_ADD) },
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
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sage-tint text-sage-deep">
        <tile.Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold text-ink">{t(`tour.${tile.key}`)}</span>
        <span className="mt-0.5 block text-[12px] leading-snug text-ink-soft">{t(`tour.${tile.key}.d`)}</span>
      </span>
    </>
  );
  const cls =
    "flex items-start gap-2.5 rounded-[16px] border border-black/[0.06] bg-surface p-3 text-left transition-colors hover:border-sage/50";

  return (
    <section className="anim-fade-up">
      <h3 className="mb-3 font-serif text-[18px] font-medium italic text-ink-soft">{t("tour.title")}</h3>
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-5">
        {tiles.map((tile) =>
          tile.onClick ? (
            <button key={tile.key} type="button" onClick={tile.onClick} className={cls}>
              {body(tile)}
            </button>
          ) : tile.external ? (
            <a key={tile.key} href={tile.href} target="_blank" rel="noopener noreferrer" className={cls}>
              {body(tile)}
            </a>
          ) : (
            <Link key={tile.key} href={tile.href!} className={cls}>
              {body(tile)}
            </Link>
          ),
        )}
      </div>
    </section>
  );
}
