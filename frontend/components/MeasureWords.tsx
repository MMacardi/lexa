"use client";

import { Pinyin } from "@/components/Pinyin";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * A noun's measure words as they're used, 一台电脑 · 一件衣服, with the measure
 * word's pinyin: Russian has no classifiers, so each is learnt with its noun (HSK
 * gap-fills test them). CC-CEDICT's, from the card's own reading.
 */
export function MeasureWords({
  word,
  items,
  className,
}: {
  word: string;
  items: { word: string; pinyin: string }[] | undefined;
  className?: string;
}) {
  const { t } = useI18n();
  if (!items?.length) return null;
  return (
    <div className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-1", className)}>
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("word.measure")}</span>
      {items.slice(0, 3).map((m) => (
        <span key={m.word} className="whitespace-nowrap">
          <span className="font-zh text-[17px] text-ink">
            一<span className="font-semibold text-sage-deep">{m.word}</span>
            {word}
          </span>{" "}
          <Pinyin text={m.pinyin} className="text-[13px] text-ink-faint" />
        </span>
      ))}
    </div>
  );
}
