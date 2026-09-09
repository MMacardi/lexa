"use client";

import { useDialog } from "@/lib/dialog";
import { useI18n } from "@/lib/i18n";
import { langLabel } from "@/lib/langs";
import { CEFR_LEVELS, LEVEL_HINT, setLevel, useLevel, getTapAnyGloss, setTapAnyGloss, useTapAnyGloss, type CefrLevel } from "@/lib/learnPrefs";
import { cn } from "@/lib/utils";
import { ChevronDown, Fingerprint, Gauge } from "lucide-react";

// The two controls that decide HOW a practice session talks to you: the difficulty
// the AI is held to, and whether every word in the conversation is tappable. Both
// are persisted, so they survive a reload and apply to the next session too.
export function PracticeBar({ lang }: { lang: string }) {
  const { t } = useI18n();
  const { choose } = useDialog();
  const level = useLevel(lang);
  const tapAny = useTapAnyGloss();

  async function pickLevel() {
    if (!lang || lang === "auto") return;
    const picked = await choose({
      title: t("level.title"),
      message: t("level.question", { lang: langLabel(lang) }),
      options: CEFR_LEVELS.map((l) => ({ value: l, label: l, hint: LEVEL_HINT[l] })),
    });
    if (picked) setLevel(lang, picked as CefrLevel);
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <button
        type="button"
        onClick={pickLevel}
        title={t("practice.levelHint")}
        className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-paper px-3 py-1.5 text-[12px] font-semibold text-ink-muted transition-colors hover:border-sage/50 hover:text-ink"
      >
        <Gauge className="h-3.5 w-3.5 text-sage-deep" />
        {level ? t("practice.levelChip", { level }) : t("practice.levelUnset")}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      <button
        type="button"
        role="switch"
        aria-checked={tapAny}
        onClick={() => setTapAnyGloss(!getTapAnyGloss())}
        title={t("practice.tapAnyHint")}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors",
          tapAny ? "border-sage/40 bg-sage-tint/60 text-sage-deep" : "border-black/[0.08] bg-paper text-ink-faint",
        )}
      >
        <Fingerprint className="h-3.5 w-3.5" />
        {t("practice.tapAny")}
        <span className={cn("relative h-4 w-7 shrink-0 rounded-full transition-colors", tapAny ? "bg-sage" : "bg-black/15")}>
          <span
            className={cn(
              "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-all duration-200",
              tapAny ? "left-3.5" : "left-0.5",
            )}
          />
        </span>
      </button>
    </div>
  );
}
