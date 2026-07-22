"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useDailyGoal } from "@/lib/goal";
import { useI18n } from "@/lib/i18n";

// A standalone, prominent daily-goal panel: a big progress ring, encouragement,
// a 7-day "goal met" strip, and +/- to tune the target.
export function DailyGoalCard() {
  const { accountId } = useAccount();
  const { t, locale } = useI18n();
  const [goal, setGoal] = useDailyGoal();
  const { data } = useQuery({
    queryKey: ["stats", accountId],
    queryFn: () => api.stats(accountId),
  });
  if (!data) return null;

  const done = data.trainedToday;
  const pct = Math.min(1, done / goal);
  const hit = done >= goal;
  const percent = Math.round(pct * 100);

  const r = 52;
  const c = 2 * Math.PI * r;
  const last7 = data.days.slice(-7);
  const dl = locale === "ru" ? "ru-RU" : locale === "zh" ? "zh-CN" : "en-US";

  return (
    <section className="anim-fade-up overflow-hidden rounded-[24px] border border-black/[0.06] bg-surface">
      <div className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
        {/* ring */}
        <div className="relative mx-auto h-[140px] w-[140px] shrink-0 sm:mx-0">
          <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
            <circle cx="70" cy="70" r={r} fill="none" stroke="var(--color-track)" strokeWidth="13" />
            <circle
              cx="70"
              cy="70"
              r={r}
              fill="none"
              stroke={hit ? "var(--color-sage-deep)" : "var(--color-sage)"}
              strokeWidth="13"
              strokeLinecap="round"
              strokeDasharray={c}
              strokeDashoffset={c * (1 - pct)}
              style={{ transition: "stroke-dashoffset 0.7s cubic-bezier(0.22,0.8,0.26,1)" }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-serif text-[34px] font-bold leading-none text-ink">{done}</span>
            <span className="text-[12px] font-medium text-ink-faint">/ {goal}</span>
            <span className="mt-1 text-[11px] font-semibold text-sage-deep">{percent}%</span>
          </div>
        </div>

        {/* right side */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-[22px] font-medium text-ink">{t("stats.goal")}</h3>
            <span className="text-[20px]">{hit ? "🎉" : "🎯"}</span>
          </div>
          <p className="mt-1 text-[15px] text-ink-soft">
            {hit ? t("stats.goalGreat") : t("stats.goalToGo", { n: Math.max(0, goal - done) })}
          </p>

          {/* 7-day strip */}
          <div className="mt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
              {t("stats.last7")}
            </p>
            <div className="flex gap-1.5">
              {last7.map((d) => {
                const met = d.reviews >= goal;
                const some = d.reviews > 0 && !met;
                const letter = new Date(d.date + "T00:00:00")
                  .toLocaleDateString(dl, { weekday: "short" })
                  .slice(0, 2);
                return (
                  <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      title={`${d.date} · ${d.reviews}`}
                      className={`flex h-8 w-full items-center justify-center rounded-[10px] text-[13px] font-bold ${
                        met
                          ? "bg-sage text-white"
                          : some
                            ? "bg-sage-tint text-sage-deep"
                            : "bg-paper text-ink-faint/60"
                      }`}
                    >
                      {met ? "✓" : some ? d.reviews : ""}
                    </div>
                    <span className="text-[9px] font-medium text-ink-faint">{letter}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* goal adjuster */}
          <div className="mt-4 flex items-center gap-2">
            <span className="text-[12px] text-ink-soft">{t("stats.goal")}:</span>
            <button
              onClick={() => setGoal(goal - 1)}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-black/[0.08] text-ink-muted hover:bg-black/[0.04]"
            >
              −
            </button>
            <span className="w-6 text-center text-[14px] font-semibold text-ink">{goal}</span>
            <button
              onClick={() => setGoal(goal + 1)}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-black/[0.08] text-ink-muted hover:bg-black/[0.04]"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
