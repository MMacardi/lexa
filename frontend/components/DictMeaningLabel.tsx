"use client";

import type { Word } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Instant capture writes a Chinese card from CC-CEDICT the moment it is added
// and the model's meaning replaces the English gloss a few seconds later. Within
// this window the card is "filling in" and the pages showing it poll; past it the
// upgrade failed or was stopped, and the word page offers "fill this in" instead.
// Generous, because a Reader batch upgrades its cards one after another.
const UPGRADE_WINDOW_MS = 120_000;

// A card that starts on the shared Russian default is already readable, but its
// example and details come from the same upgrade: until they land (no part of
// speech yet) it is still filling in.
export function upgradePending(w: Pick<Word, "dictMeaning" | "dictDefault" | "partOfSpeech" | "createdAt">): boolean {
  const filling = Boolean(w.dictMeaning) || (Boolean(w.dictDefault) && !w.partOfSpeech);
  return filling && Date.now() - new Date(w.createdAt).getTime() < UPGRADE_WINDOW_MS;
}

// A learner who doesn't speak English shouldn't have to read it. While the
// meaning in their language is on its way (the batch step writes it in seconds),
// the dictionary's English is held back and a placeholder shows; only a card
// whose upgrade never came shows the English, labelled, as a last resort.
export function holdsEnglish(w: Pick<Word, "dictMeaning" | "dictDefault" | "partOfSpeech" | "createdAt" | "targetLang">): boolean {
  return Boolean(w.dictMeaning) && w.targetLang !== "en" && upgradePending(w);
}

/** The meaning to show: the card's, or null while its English is held back. */
export function shownMeaning(
  w: Pick<Word, "dictMeaning" | "dictDefault" | "partOfSpeech" | "createdAt" | "targetLang" | "meaningZh">,
): string | null {
  return holdsEnglish(w) ? null : (w.meaningZh ?? null);
}

/** A TanStack `refetchInterval` for a query holding cards that may still be upgrading. */
export function pollWhileUpgrading(
  words: Pick<Word, "dictMeaning" | "dictDefault" | "partOfSpeech" | "createdAt">[] | undefined | null,
): number | false {
  return words?.some(upgradePending) ? 3000 : false;
}

// The tag beside a meaning that is still the dictionary's English. It names the
// source because BY-SA asks for that wherever the data is shown.
export function DictMeaningLabel({
  word,
  className,
}: {
  word: Pick<Word, "dictMeaning" | "dictDefault" | "partOfSpeech" | "createdAt" | "targetLang">;
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
