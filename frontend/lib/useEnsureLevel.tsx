"use client";

import { useDialog } from "./dialog";
import { useI18n } from "./i18n";
import { langLabel } from "./langs";
import { getLearnerLevel, levelOptions, setLearnerLevel } from "./learnPrefs";

/**
 * Shared "ask for the learner's level once" gate (HSK for Chinese, CEFR otherwise). Any action that generates
 * an AI example at a level should call this first so difficulty isn't random —
 * if the level for that language isn't known yet, prompt for it and remember it.
 *
 * Returns the level, or null if the user dismissed the first-time prompt (the
 * caller should abort so we never generate a random-difficulty example).
 */
export function useEnsureLevel() {
  const { choose } = useDialog();
  const { t } = useI18n();

  return async (lang: string): Promise<{ level?: string; ok: boolean }> => {
    if (!lang || lang === "auto") return { level: undefined, ok: true };
    const stored = getLearnerLevel(lang);
    if (stored) return { level: stored, ok: true };
    const picked = await choose({
      title: t("level.title"),
      message: t("level.question", { lang: langLabel(lang) }),
      options: levelOptions(lang),
    });
    if (!picked) return { level: undefined, ok: false }; // dismissed → abort the action
    setLearnerLevel(lang, picked);
    return { level: picked, ok: true };
  };
}
