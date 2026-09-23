"use client";

import { Check } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// One proposed HSK word — in the onboarding deck and in Today's daily words. Every
// proposal can be turned down: a tap marks it "I know it", which is saved as a
// placement answer, so the word never comes back. An already-added word is only
// shown, with a tick. The level badge says why this word, at this level.
export function HskWordChip({
  word,
  pinyin,
  level,
  known = false,
  added = false,
  onToggle,
}: {
  word: string;
  pinyin: string;
  level: number;
  known?: boolean;
  added?: boolean;
  onToggle?: () => void;
}) {
  const { t } = useI18n();
  const badge = `HSK ${level === 7 ? "7–9" : level}`;
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
      <span className={cn("block font-zh text-[16px] leading-tight text-ink", known && "line-through")}>{word}</span>
      <span className="block text-[11px] leading-tight text-ink-faint">{pinyin}</span>
      <span className="mt-0.5 flex items-center justify-center gap-1 text-[10px] font-semibold tracking-[0.04em] text-ink-faint">
        {added && <Check className="h-3 w-3 text-sage-deep" />}
        {known ? t("hskDaily.known") : badge}
      </span>
    </button>
  );
}
