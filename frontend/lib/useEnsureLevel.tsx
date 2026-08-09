"use client";

import { useDialog } from "./dialog";
import { useI18n } from "./i18n";
import { langLabel } from "./langs";
import { CEFR_LEVELS, LEVEL_HINT, getLevel, setLevel, type CefrLevel } from "./learnPrefs";

/**
 * Shared "ask for the learner's CEFR level once" gate. Any action that generates
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
    const stored = getLevel(lang);
    if (stored) return { level: stored, ok: true };
    const picked = await choose({
      title: t("level.title"),
      message: t("level.question", { lang: langLabel(lang) }),
      options: CEFR_LEVELS.map((l) => ({ value: l, label: l, hint: LEVEL_HINT[l] })),
    });
    if (!picked) return { level: undefined, ok: false }; // dismissed → abort the action
    setLevel(lang, picked as CefrLevel);
    return { level: picked, ok: true };
  };
}
