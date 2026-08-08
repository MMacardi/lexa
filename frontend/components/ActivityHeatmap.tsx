"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { Stats } from "@/lib/api";
import { cn } from "@/lib/utils";

// GitHub-style contribution grid: one square per day over the last ~17 weeks,
// shaded by how many reviews happened that day. Columns are weeks (Sun→Sat).
const LEVEL_CLS = ["bg-track", "bg-sage/30", "bg-sage/60", "bg-sage", "bg-sage-deep"];
function level(count: number) {
  return count <= 0 ? 0 : count <= 1 ? 1 : count <= 3 ? 2 : count <= 5 ? 3 : 4;
}

export function ActivityHeatmap({ heat }: { heat: Stats["heat"] }) {
  const { t, locale } = useI18n();
  const [hover, setHover] = useState<{ x: number; y: number; date: string; count: number } | null>(null);
  if (!heat || heat.length === 0) return null;

  const dateLocale = locale === "ru" ? "ru-RU" : locale === "zh" ? "zh-CN" : "en-US";

  // Pad the front so the first real day sits on its correct weekday row.
  const firstWeekday = new Date(heat[0].date + "T00:00:00").getDay(); // 0=Sun
  const cells: (Stats["heat"][number] | null)[] = [...Array(firstWeekday).fill(null), ...heat];
  const weeks: (Stats["heat"][number] | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const activeDays = heat.filter((d) => d.count > 0).length;

  // Month label above a week when its month differs from the previous week's.
  const monthOf = (week: (Stats["heat"][number] | null)[]) => {
    const first = week.find(Boolean);
    return first ? new Date(first.date + "T00:00:00").getMonth() : -1;
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("stats.activity")}</p>
        <p className="text-[12px] font-medium text-ink-soft">{t("stats.activeDays", { n: activeDays })}</p>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="inline-block min-w-full">
          {/* month labels */}
          <div className="mb-1 flex gap-[3px] pl-6">
            {weeks.map((wk, i) => {
              const m = monthOf(wk);
              const prev = i > 0 ? monthOf(weeks[i - 1]) : -1;
              return (
                <span key={i} className="w-[11px] text-[9px] font-medium text-ink-faint">
                  {m !== prev && m >= 0 ? new Date(2000, m, 1).toLocaleDateString("en-US", { month: "short" }) : ""}
                </span>
              );
            })}
          </div>

          <div className="flex gap-[3px]">
            {/* weekday labels */}
            <div className="mr-0.5 flex w-5 shrink-0 flex-col gap-[3px] text-[9px] font-medium text-ink-faint">
              {["", "Mon", "", "Wed", "", "Fri", ""].map((d, i) => (
                <span key={i} className="h-[11px] leading-[11px]">{d}</span>
              ))}
            </div>
            {weeks.map((wk, wi) => (
              <div key={wi} className="flex flex-col gap-[3px]">
                {Array.from({ length: 7 }).map((_, di) => {
                  const cell = wk[di];
                  if (!cell) return <span key={di} className="h-[11px] w-[11px]" />;
                  const c = cell;
                  return (
                    <span
                      key={di}
                      onMouseEnter={(e) => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setHover({ x: r.left + r.width / 2, y: r.top, date: c.date, count: c.count });
                      }}
                      onMouseLeave={() => setHover(null)}
                      className={cn("h-[11px] w-[11px] rounded-[3px] transition-transform hover:scale-[1.35]", LEVEL_CLS[level(c.count)])}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* legend */}
      <div className="mt-2.5 flex items-center justify-end gap-1.5 text-[10px] font-medium text-ink-faint">
        <span>{t("stats.less")}</span>
        {LEVEL_CLS.map((c, i) => (
          <span key={i} className={cn("h-[10px] w-[10px] rounded-[2px]", c)} />
        ))}
        <span>{t("stats.more")}</span>
      </div>

      {/* custom tooltip (replaces the browser's plain title) */}
      {hover && (
        <div
          className="pointer-events-none fixed z-[80] -translate-x-1/2 -translate-y-full rounded-[10px] bg-onyx px-2.5 py-1.5 text-center shadow-[0_10px_28px_rgba(0,0,0,0.28)]"
          style={{ left: hover.x, top: hover.y - 8 }}
        >
          <div className="text-[12px] font-semibold text-white">
            {hover.count > 0 ? t("stats.reviewsCount", { n: hover.count }) : t("stats.noReviews")}
          </div>
          <div className="text-[10px] font-medium text-white/60">
            {new Date(hover.date + "T00:00:00").toLocaleDateString(dateLocale, { month: "short", day: "numeric", year: "numeric" })}
          </div>
        </div>
      )}
    </div>
  );
}
