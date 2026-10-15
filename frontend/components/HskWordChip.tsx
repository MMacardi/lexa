"use client";

import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// One proposed HSK word — in the onboarding deck and in Today's daily words. Every
// proposal can be turned down: a tap marks it "I know it", which is saved as a
// placement answer, so the word never comes back. An already-added word is only
// shown, with a tick. The level badge says why this word, at this level. A topic
// word (off the list, or above it) shows its meaning there instead: it's a term
// of the learner's field, and what it means is what decides "I know it".
export function HskWordChip({
  word,
  pinyin,
  level,
  meaning,
  known = false,
  added = false,
  onToggle,
}: {
  word: string;
  pinyin: string;
  level?: number | null;
  meaning?: string;
  known?: boolean;
  added?: boolean;
  onToggle?: () => void;
}) {
  const { t } = useI18n();
  const badge = meaning ?? (level ? `HSK ${level === 7 ? "7–9" : level}` : "");
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={added || !onToggle}
      aria-pressed={known}
      title={known ? t("hskDaily.known") : undefined}
      className={cn(
        "relative rounded-[14px] border px-3 py-1.5 text-center transition-colors",
        added
          ? "border-sage/30 bg-sage-tint"
          : known
            ? "border-dashed border-black/[0.12] bg-paper opacity-60"
            : "border-black/[0.08] bg-surface hover:bg-black/[0.03]",
      )}
    >
      {/* Pinyin and meaning were 11 px, a fifth of Today's text (BACKLOG 1l). */}
      <span className={cn("block font-zh text-[17px] leading-tight text-ink sm:text-[18px]", known && "line-through")}>{word}</span>
      <span className="block text-[12px] leading-tight text-ink-faint sm:text-[13px]">{pinyin}</span>
      {meaning && !known ? (
        <span className="mt-0.5 block max-w-[10rem] truncate text-[13px] leading-tight text-ink-soft sm:text-[14px]">
          {added && <Check className="mr-0.5 inline h-3 w-3 align-[-2px] text-sage-deep" />}
          {meaning}
        </span>
      ) : (
        <span className="mt-0.5 flex items-center justify-center gap-1 text-[12px] font-semibold tracking-[0.04em] text-ink-faint">
          {added && <Check className="h-3 w-3 text-sage-deep" />}
          {known ? t("hskDaily.known") : badge}
        </span>
      )}
    </button>
  );
}
