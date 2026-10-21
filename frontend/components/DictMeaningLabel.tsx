"use client";

import { api, type Word } from "@/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type ProgressWord = Pick<Word, "enrichmentStatus" | "exampleStatus">;

export function examplePending(w: ProgressWord): boolean {
  return w.exampleStatus === "queued" || w.exampleStatus === "generating";
}

export function upgradePending(w: ProgressWord): boolean {
  return w.enrichmentStatus === "queued" || w.enrichmentStatus === "generating" || examplePending(w);
}

// Russian meanings keep their placeholder on failure as well as during loading.
export function holdsEnglish(w: Pick<Word, "dictMeaning" | "targetLang"> & ProgressWord): boolean {
  return Boolean(w.dictMeaning) && w.targetLang !== "en" && (w.targetLang === "ru" || upgradePending(w));
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
  if (holdsEnglish(word)) return <span className={cn("text-[11px] text-ink-faint", className)}>
    {t(upgradePending(word) ? "capture.filling" : "capture.meaningFailed")}
  </span>;
  return (
    <span className={cn("text-[11px] font-semibold tracking-[0.04em] text-ink-faint", className)}>
      {t("capture.dictLabel")}
      {upgradePending(word) && <span className="font-normal"> · {t("capture.filling")}</span>}
    </span>
  );
}

export function MeaningRetry({ wordId, onQueued }: { wordId: string; onQueued?: (word: Word) => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const retry = useMutation({ mutationFn: () => api.enrichWord(wordId), onSuccess: (word) => {
    onQueued?.(word);
    qc.invalidateQueries({ queryKey: ["words"] });
    qc.invalidateQueries({ queryKey: ["word", wordId] });
  } });
  return <div>
    <button type="button" disabled={retry.isPending} onClick={() => retry.mutate()}
      className="mt-1 rounded-md px-2 py-1 text-[13px] font-semibold text-sage-deep disabled:opacity-50">
      {t(retry.isPending ? "capture.filling" : "errState.retry")}
    </button>
    {retry.isError && <p role="alert" className="text-[12px] text-ink-faint">{t("capture.meaningFailed")}</p>}
  </div>;
}
