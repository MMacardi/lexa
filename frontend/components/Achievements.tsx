"use client";

import type { Stats } from "@/lib/api";
import { computeBadges } from "@/lib/achievements";
import { useI18n } from "@/lib/i18n";
import { HoverTip } from "@/components/ui/HoverTip";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

// Milestone badges derived from the user's stats. Unlocked ones are tinted; locked
// ones are greyed with a lock. Hover (or long-press) shows how each is earned.
export function Achievements({ stats, goal }: { stats: Stats; goal: number }) {
  const { t } = useI18n();
  const badges = computeBadges(stats, goal);
  const done = badges.filter((b) => b.done).length;

  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
        {t("stats.achievements", { done, total: badges.length })}
      </p>
      <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-8">
        {badges.map((b) => (
          <HoverTip
            key={b.id}
            title={t(b.labelKey)}
            subtitle={t(b.descKey)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-[14px] border p-2.5 text-center transition-all",
              b.done ? "border-sage/40 bg-sage-tint" : "border-black/[0.05] bg-paper opacity-60",
            )}
          >
            {b.done ? (
              <b.Icon className="h-[22px] w-[22px] text-sage-deep" />
            ) : (
              <Lock className="h-[22px] w-[22px] text-ink-faint" />
            )}
            <span className="text-[10px] font-semibold leading-tight text-ink-soft">{t(b.labelKey)}</span>
          </HoverTip>
        ))}
      </div>
    </div>
  );
}
