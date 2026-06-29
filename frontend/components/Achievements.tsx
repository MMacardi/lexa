"use client";

import type { Stats } from "@/lib/api";
import { computeBadges } from "@/lib/achievements";
import { cn } from "@/lib/utils";

// Milestone badges derived from the user's stats. Unlocked ones are tinted;
// locked ones are greyed with a subtle lock.
export function Achievements({ stats, goal }: { stats: Stats; goal: number }) {
  const badges = computeBadges(stats, goal);

  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
        Achievements · {badges.filter((b) => b.done).length}/{badges.length}
      </p>
      <div className="grid grid-cols-4 gap-2.5 sm:grid-cols-8">
        {badges.map((b) => (
          <div
            key={b.label}
            title={b.label}
            className={cn(
              "flex flex-col items-center gap-1 rounded-[14px] border p-2.5 text-center transition-all",
              b.done
                ? "border-sage/40 bg-sage-tint"
                : "border-black/[0.05] bg-paper opacity-50 grayscale",
            )}
          >
            <span className="text-[22px] leading-none">{b.done ? b.icon : "🔒"}</span>
            <span className="text-[10px] font-semibold leading-tight text-ink-soft">{b.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
