"use client";

import type { Stats } from "@/lib/api";
import { computeBadges, type Badge } from "@/lib/achievements";
import { useI18n } from "@/lib/i18n";
import { HoverTip } from "@/components/ui/HoverTip";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

// How far along a badge is, 0–1.
const pctOf = (b: Badge) => (b.target > 0 ? Math.min(1, b.cur / b.target) : 0);

// Milestone badges derived from the user's stats. A locked badge keeps its own
// icon — dimmed, inside a ring that fills as it gets closer — instead of the
// padlock every locked one used to show: a grid of twelve identical locks said
// nothing about what was left to do, and the labels below them, each wrapping to
// a different number of lines, left the rows ragged. Earned badges come first,
// then whatever is nearest to unlocking, so the row after the medals answers
// "what's next". Hover (or long-press) still explains how each is earned.
export function Achievements({ stats, goal }: { stats: Stats; goal: number }) {
  const { t } = useI18n();
  const badges = computeBadges(stats, goal);
  const done = badges.filter((b) => b.done).length;
  const ordered = [...badges].sort((a, b) => Number(b.done) - Number(a.done) || pctOf(b) - pctOf(a));

  return (
    <div>
      <div className="mb-3.5 flex items-center gap-3">
        <p className="shrink-0 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
          {t("stats.achievements", { done, total: badges.length })}
        </p>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-track">
          <div
            className="h-full rounded-full bg-sage transition-[width] duration-500"
            style={{ width: `${(done / badges.length) * 100}%` }}
          />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-x-2 gap-y-4 sm:grid-cols-6 md:grid-cols-8">
        {ordered.map((b) => {
          const pct = Math.round(pctOf(b) * 100);
          const cur = Math.min(b.cur, b.target);
          return (
            <HoverTip
              key={b.id}
              title={t(b.labelKey)}
              subtitle={b.done ? t(b.descKey) : `${t(b.descKey)} · ${cur}/${b.target}`}
              className="flex cursor-default flex-col items-center gap-1.5 text-center"
            >
              {/* the ring *is* the progress bar — a conic sweep around the icon */}
              <span
                className="relative flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full p-[3px]"
                style={{
                  background: b.done
                    ? "var(--color-sage)"
                    : `conic-gradient(var(--color-sage) ${pct}%, var(--color-track) 0)`,
                }}
              >
                <span
                  className={cn(
                    "flex h-full w-full items-center justify-center rounded-full",
                    b.done ? "bg-sage-tint" : "bg-paper",
                  )}
                >
                  <b.Icon className={cn("h-[21px] w-[21px]", b.done ? "text-sage-deep" : "text-ink-faint opacity-55")} />
                </span>
                {b.done && (
                  <span className="absolute -bottom-0.5 -right-0.5 flex h-[17px] w-[17px] items-center justify-center rounded-full bg-sage-deep ring-2 ring-surface">
                    <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />
                  </span>
                )}
              </span>
              {/* fixed heights on both lines, so a two-line name can't stagger the row */}
              <span
                className={cn(
                  "line-clamp-2 min-h-[26px] text-[11px] font-semibold leading-[1.2]",
                  b.done ? "text-ink-soft" : "text-ink-faint",
                )}
              >
                {t(b.labelKey)}
              </span>
              <span className="-mt-1 h-[13px] text-[10px] font-semibold tabular-nums text-ink-faint">
                {!b.done && b.target > 1 ? `${cur}/${b.target}` : ""}
              </span>
            </HoverTip>
          );
        })}
      </div>
    </div>
  );
}
