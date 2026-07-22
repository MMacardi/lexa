"use client";

import type { Stats } from "@/lib/api";
import { computeBadges } from "@/lib/achievements";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Maps badge ids to translation keys.
const LABEL_KEY: Record<string, string> = {
  "first-word": "ach.firstWord",
  "10-words": "ach.10words",
  "50-words": "ach.50words",
  "first-mastered": "ach.firstMastered",
  "10-mastered": "ach.10mastered",
  "streak-3": "ach.streak3",
  "streak-7": "ach.streak7",
  "daily-goal": "ach.dailyGoal",
};

// Milestone badges derived from the user's stats. Unlocked ones are tinted;
// locked ones are greyed with a subtle lock.
export function Achievements({ stats, goal }: { stats: Stats; goal: number }) {
  const { t } = useI18n();
  const badges = computeBadges(stats, goal);

  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
        {t("stats.achievements", { done: badges.filter((b) => b.done).length, total: badges.length })}
      </p>
      <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-8">
        {badges.map((b) => (
          <div
            key={b.id}
            title={t(LABEL_KEY[b.id] ?? b.label)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-[14px] border p-2.5 text-center transition-all",
              b.done
                ? "border-sage/40 bg-sage-tint"
                : "border-black/[0.05] bg-paper opacity-50 grayscale",
            )}
          >
            <span className="text-[22px] leading-none">{b.done ? b.icon : "🔒"}</span>
            <span className="text-[10px] font-semibold leading-tight text-ink-soft">
              {t(LABEL_KEY[b.id] ?? b.label)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
