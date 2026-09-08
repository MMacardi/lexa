"use client";

import Link from "next/link";
import { Check, RotateCcw, ArrowLeft } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export type SceneCorrection = { original: string; corrected: string; note: string };

// Token-free end-of-scene report, computed entirely on the client: which mission words
// the learner deployed, which are still to practise (no penalty — they just stay due),
// the gentle fixes captured during the talk, and how many cards got reviewed.
export function SceneReportCard({
  missionWords,
  used,
  corrections,
  reviewedCount,
  onPlayAnother,
}: {
  missionWords: { word: string; meaning: string }[];
  used: Set<string>;
  corrections: SceneCorrection[];
  reviewedCount: number;
  onPlayAnother: () => void;
}) {
  const { t } = useI18n();
  const missed = missionWords.filter((w) => !used.has(w.word.trim().toLowerCase()));

  return (
    <div className="anim-fade-up rounded-[18px] border border-sage/30 bg-sage-tint/30 p-5">
      <div className="text-center font-serif text-[20px] font-semibold text-ink">{t("scene.reportTitle")}</div>

      <div className="mt-4 space-y-4">
        {/* mission words used */}
        <div>
          <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
            {t("scene.progress", { n: String(used.size), total: String(missionWords.length) })}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {missionWords.map((w) => {
              const hit = used.has(w.word.trim().toLowerCase());
              return (
                <span
                  key={w.word}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] font-semibold",
                    hit ? "border-sage bg-sage text-white" : "border-black/[0.08] bg-surface text-ink-muted",
                  )}
                >
                  {hit && <Check className="h-3 w-3" strokeWidth={3} />}
                  {w.word}
                </span>
              );
            })}
          </div>
        </div>

        {/* still to practise — surfaced, never penalised */}
        {missed.length > 0 && (
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
              {t("scene.reportMissedLabel")}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {missed.map((w) => (
                <span
                  key={w.word}
                  className="rounded-full border border-warn/30 bg-warn-bg/50 px-2.5 py-1 text-[13px] font-medium text-warn-text"
                >
                  {w.word}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* quick fixes captured during the scene */}
        {corrections.length > 0 && (
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
              {t("scene.reportCorrectionsLabel")}
            </div>
            <ul className="space-y-1.5">
              {corrections.map((c, i) => (
                <li key={i} className="rounded-[12px] border border-black/[0.06] bg-surface px-3 py-2 text-[13px] leading-relaxed">
                  {c.original && <span className="text-ink-faint line-through">{c.original}</span>}
                  {c.original && <span className="mx-1.5 text-ink-faint">→</span>}
                  <span className="font-semibold text-sage-deep">{c.corrected}</span>
                  {c.note && <span className="ml-2 text-ink-soft">{c.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {reviewedCount > 0 && (
          <div className="text-center text-[13px] font-semibold text-sage-deep">
            {t("scene.reportDelta", { n: String(reviewedCount) })}
          </div>
        )}
      </div>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={onPlayAnother}
          className="inline-flex items-center gap-1.5 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sage-deep"
        >
          <RotateCcw className="h-4 w-4" /> {t("scene.reportAgain")}
        </button>
        <Link
          href="/coach"
          className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] bg-surface px-4 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-sage/50"
        >
          <ArrowLeft className="h-4 w-4" /> {t("scene.reportBack")}
        </Link>
      </div>
    </div>
  );
}
