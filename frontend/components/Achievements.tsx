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
        {badges.map((b) => {
          const pct = b.target > 0 ? Math.min(100, Math.round((b.cur / b.target) * 100)) : 0;
          const showBar = !b.done && b.target > 1; // a bar only helps for multi-step goals
          return (
            <HoverTip
              key={b.id}
              title={t(b.labelKey)}
              subtitle={b.done ? t(b.descKey) : `${t(b.descKey)} · ${Math.min(b.cur, b.target)}/${b.target}`}
              className={cn(
                "flex flex-col items-center gap-1 rounded-[14px] border p-2.5 text-center transition-all",
                b.done ? "border-sage/40 bg-sage-tint" : "border-black/[0.05] bg-paper",
              )}
            >
              {b.done ? (
                <b.Icon className="h-[22px] w-[22px] text-sage-deep" />
              ) : (
                <Lock className="h-[22px] w-[22px] text-ink-faint opacity-60" />
              )}
              <span className={cn("text-[10px] font-semibold leading-tight", b.done ? "text-ink-soft" : "text-ink-faint")}>
                {t(b.labelKey)}
              </span>
              {showBar && (
                <div className="mt-0.5 w-full">
                  <div className="h-1 w-full overflow-hidden rounded-full bg-black/[0.07]">
                    <div className="h-full rounded-full bg-sage/60" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="mt-0.5 block text-[9px] font-semibold tabular-nums text-ink-faint">
                    {Math.min(b.cur, b.target)}/{b.target}
                  </span>
                </div>
              )}
            </HoverTip>
          );
        })}
      </div>
    </div>
  );
}
