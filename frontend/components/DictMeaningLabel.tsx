"use client";

import type { Word } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type ProgressWord = Pick<Word, "enrichmentStatus" | "exampleStatus">;

export function examplePending(w: ProgressWord): boolean {
  return w.exampleStatus === "queued" || w.exampleStatus === "generating";
}

export function upgradePending(w: ProgressWord): boolean {
  return w.enrichmentStatus === "queued" || w.enrichmentStatus === "generating" || examplePending(w);
}

// A learner who doesn't speak English shouldn't have to read it. While the
// meaning in their language is on its way (the batch step writes it in seconds),
// the dictionary's English is held back and a placeholder shows; only a card
// whose upgrade never came shows the English, labelled, as a last resort.
export function holdsEnglish(w: Pick<Word, "dictMeaning" | "targetLang"> & ProgressWord): boolean {
  return Boolean(w.dictMeaning) && w.targetLang !== "en" && upgradePending(w);
}

/** The meaning to show: the card's, or null while its English is held back. */
export function shownMeaning(
  w: Pick<Word, "dictMeaning" | "targetLang" | "meaningZh"> & ProgressWord,
): string | null {
  return holdsEnglish(w) ? null : (w.meaningZh ?? null);
}

/** A TanStack `refetchInterval` for a query holding cards that may still be upgrading. */
export function pollWhileUpgrading(
  words: ProgressWord[] | undefined | null,
): number | false {
  return words?.some(upgradePending) ? 3000 : false;
}

// The tag beside a meaning that is still the dictionary's English. It names the
// source because BY-SA asks for that wherever the data is shown.
export function DictMeaningLabel({
  word,
  className,
}: {
  word: Pick<Word, "dictMeaning" | "targetLang"> & ProgressWord;
  className?: string;
}) {
  const { t } = useI18n();
  if (!word.dictMeaning) return null;
  if (holdsEnglish(word)) return <span className={cn("text-[11px] text-ink-faint", className)}>{t("capture.filling")}</span>;
  return (
    <span className={cn("text-[11px] font-semibold tracking-[0.04em] text-ink-faint", className)}>
      {t("capture.dictLabel")}
      {upgradePending(word) && <span className="font-normal"> · {t("capture.filling")}</span>}
    </span>
  );
}
