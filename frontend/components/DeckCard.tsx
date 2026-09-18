"use client";

import Link from "next/link";
import { BadgeCheck, Sparkles, Users } from "lucide-react";
import type { DeckSummary } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { pairLabel } from "@/lib/langs";

// Author line for a shared deck: the Onomika Library gets an "Official" badge,
// real learners just their name. "Picked by Mika" marks the tutor's picks.
export function DeckAuthor({ deck }: { deck: Pick<DeckSummary, "author" | "mikaPick"> }) {
  const { t } = useI18n();
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-soft">
      <span>
        {t("community.by")} <span className="font-semibold text-ink-muted">{deck.author.name}</span>
      </span>
      {deck.author.official && (
        <span className="inline-flex items-center gap-1 rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-semibold text-sage-deep">
          <BadgeCheck className="h-3.5 w-3.5" /> {t("community.official")}
        </span>
      )}
      {deck.mikaPick && (
        <span className="inline-flex items-center gap-1 rounded-full border border-sage/30 px-2 py-0.5 text-[11px] font-semibold text-sage-deep">
          <Sparkles className="h-3.5 w-3.5" /> {t("community.mikaPick")}
        </span>
      )}
    </span>
  );
}

/** "Added by N learners · N this week" — real counts only, hidden when zero. */
export function DeckCounters({ deck }: { deck: Pick<DeckSummary, "learners" | "weekLearners"> }) {
  const { t } = useI18n();
  if (!deck.learners) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-ink-faint">
      <Users className="h-3.5 w-3.5" />
      {t("community.addedBy", { n: deck.learners })}
      {deck.weekLearners > 0 && <> · {t("community.thisWeek", { n: deck.weekLearners })}</>}
    </span>
  );
}

export function DeckCard({ deck }: { deck: DeckSummary }) {
  const { t } = useI18n();
  return (
    <Link
      href={`/community/${deck.id}`}
      className="anim-fade-up flex flex-col gap-2 rounded-[20px] border border-black/[0.06] bg-surface p-5 transition-colors hover:border-sage/40"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 font-serif text-[21px] font-semibold leading-tight text-ink">{deck.name}</span>
        <span className="shrink-0 rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-semibold text-sage-deep">
          {pairLabel(deck.sourceLang, deck.targetLang)}
        </span>
      </div>
      <DeckAuthor deck={deck} />
      {deck.description && <p className="line-clamp-2 text-sm text-ink-soft">{deck.description}</p>}
      <div className="flex flex-wrap gap-1.5 pt-1">
        {deck.preview.map((w) => (
          <span key={w} className="rounded-full border border-black/[0.06] bg-paper px-2.5 py-0.5 text-sm text-ink-muted">
            {w}
          </span>
        ))}
        {deck.count > deck.preview.length && (
          <span className="px-1 py-0.5 text-sm text-ink-faint">{t("col.more", { n: deck.count - deck.preview.length })}</span>
        )}
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
        <span className="text-[13px] font-medium text-ink-soft">
          {deck.count === 1 ? t("col.word", { n: deck.count }) : t("col.words", { n: deck.count })}
        </span>
        <DeckCounters deck={deck} />
      </div>
    </Link>
  );
}
