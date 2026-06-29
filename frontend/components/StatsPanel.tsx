"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useDailyGoal } from "@/lib/goal";
import { pairLabel } from "@/lib/langs";
import { Achievements } from "@/components/Achievements";
import { cn } from "@/lib/utils";

const RANGES = [
  { key: "14", label: "14D", days: 14 },
  { key: "30", label: "30D", days: 30 },
  { key: "90", label: "90D", days: 90 },
  { key: "365", label: "1Y", days: 365 },
  { key: "all", label: "All", days: 0 },
] as const;

function Tile({ value, label, accent }: { value: React.ReactNode; label: string; accent?: string }) {
  return (
    <div className="rounded-[16px] border border-black/[0.06] bg-paper p-4">
      <div className={`font-serif text-[26px] font-bold leading-none ${accent ?? "text-ink"}`}>
        {value}
      </div>
      <div className="mt-1.5 text-[12px] font-medium text-ink-soft">{label}</div>
    </div>
  );
}

// Circular daily-goal progress ring (trained today vs. goal), with +/- to tune.
function GoalRing({ done, goal, setGoal }: { done: number; goal: number; setGoal: (n: number) => void }) {
  const pct = Math.min(1, done / goal);
  const r = 34;
  const c = 2 * Math.PI * r;
  const hit = done >= goal;
  return (
    <div className="flex items-center gap-4 rounded-[16px] border border-black/[0.06] bg-paper p-4">
      <div className="relative h-[84px] w-[84px] shrink-0">
        <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90">
          <circle cx="42" cy="42" r={r} fill="none" stroke="var(--color-track)" strokeWidth="9" />
          <circle
            cx="42"
            cy="42"
            r={r}
            fill="none"
            stroke="var(--color-sage)"
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={c * (1 - pct)}
            style={{ transition: "stroke-dashoffset 0.6s ease" }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-serif text-[20px] font-bold leading-none text-ink">{done}</span>
          <span className="text-[10px] font-medium text-ink-faint">/ {goal}</span>
        </div>
      </div>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-ink">
          {hit ? "🎉 Daily goal reached!" : "Daily goal"}
        </div>
        <div className="mt-0.5 text-[12px] text-ink-soft">
          {hit ? "Great work today." : `${Math.max(0, goal - done)} cards to go`}
        </div>
        <div className="mt-2 flex items-center gap-1.5">
          <button
            onClick={() => setGoal(goal - 1)}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-black/[0.08] text-ink-muted hover:bg-black/[0.04]"
          >
            −
          </button>
          <span className="w-6 text-center text-[13px] font-semibold text-ink">{goal}</span>
          <button
            onClick={() => setGoal(goal + 1)}
            className="flex h-6 w-6 items-center justify-center rounded-full border border-black/[0.08] text-ink-muted hover:bg-black/[0.04]"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}

// Cumulative "words collected" line over the last 14 days — a real learning curve.
// Day label — short month for long ranges, day+month for short ones.
function dayLabel(iso: string, monthOnly: boolean) {
  const d = new Date(iso + "T00:00:00");
  return monthOnly
    ? d.toLocaleDateString("en-US", { month: "short" })
    : d.toLocaleDateString("en-US", { day: "numeric", month: "short" });
}

// Cumulative "words collected" over the last `days` days, computed from each
// word's createdAt — so any range works without extra API calls.
function LearningCurve({ words, days }: { words: Word[]; days: number }) {
  const times = words.map((w) => new Date(w.createdAt).getTime()).sort((a, b) => a - b);
  const start = new Date();
  start.setHours(0, 0, 0, 0);

  const pts: { date: string; value: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(start);
    d.setDate(d.getDate() - i);
    const next = new Date(d);
    next.setDate(next.getDate() + 1);
    const cutoff = next.getTime();
    // number of words created before the end of this day (binary search)
    let lo = 0;
    let hi = times.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (times[mid] < cutoff) lo = mid + 1;
      else hi = mid;
    }
    pts.push({ date: d.toISOString().slice(0, 10), value: lo });
  }

  const monthOnly = days > 45;
  const showDots = days <= 31;
  const n = pts.length || 1;
  // Y axis: 0 → niceMax, with a few round gridline ticks.
  const maxVal = Math.max(1, ...pts.map((p) => p.value));
  const ticks = 3;
  const step = Math.max(1, Math.ceil(maxVal / ticks));
  const niceMax = step * ticks;

  // Coordinates in 0..100 space (SVG stretches; stroke kept crisp via vector-effect).
  const xPct = (i: number) => (i / (n - 1 || 1)) * 100;
  const yPct = (v: number) => 100 - (v / niceMax) * 100;

  const line = pts.map((p, i) => `${xPct(i)},${yPct(p.value)}`).join(" ");
  const area = `M 0 100 ${pts.map((p, i) => `L ${xPct(i)} ${yPct(p.value)}`).join(" ")} L 100 100 Z`;

  // Show ~5 evenly spaced date labels so the axis isn't crowded.
  const labelEvery = Math.max(1, Math.round((n - 1) / 4));

  return (
    <div>
      <div className="flex">
        {/* y-axis tick labels */}
        <div className="relative mr-2 h-[140px] w-6 shrink-0">
          {Array.from({ length: ticks + 1 }).map((_, i) => {
            const val = niceMax - (niceMax / ticks) * i;
            return (
              <span
                key={i}
                className="absolute right-0 -translate-y-1/2 text-[10px] font-medium text-ink-faint"
                style={{ top: `${(i / ticks) * 100}%` }}
              >
                {val}
              </span>
            );
          })}
        </div>

        {/* plot area */}
        <div className="relative h-[140px] flex-1">
          {/* gridlines */}
          {Array.from({ length: ticks + 1 }).map((_, i) => (
            <span
              key={i}
              className="absolute inset-x-0 border-t border-black/[0.06]"
              style={{ top: `${(i / ticks) * 100}%` }}
            />
          ))}

          <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" preserveAspectRatio="none">
            <defs>
              <linearGradient id="lexaCurve" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-sage)" stopOpacity="0.32" />
                <stop offset="100%" stopColor="var(--color-sage)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#lexaCurve)" />
            <polyline
              points={line}
              fill="none"
              stroke="var(--color-sage)"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          {/* data dots (crisp HTML overlay) — only for short ranges + the endpoint */}
          {pts.map((p, i) =>
            showDots || i === n - 1 ? (
              <span
                key={p.date}
                title={`${dayLabel(p.date, false)} · ${p.value} words`}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-sage-deep ${
                  i === n - 1 ? "h-3 w-3" : "h-2 w-2"
                }`}
                style={{ left: `${xPct(i)}%`, top: `${yPct(p.value)}%` }}
              />
            ) : null,
          )}
        </div>
      </div>

      {/* x-axis date labels */}
      <div className="relative ml-8 mt-1.5 h-4">
        {pts.map((p, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <span
              key={p.date}
              className="absolute -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-ink-faint"
              style={{ left: `${xPct(i)}%` }}
            >
              {i === n - 1 ? "today" : dayLabel(p.date, monthOnly)}
            </span>
          ) : null,
        )}
      </div>
    </div>
  );
}

// Horizontal share bars (used for both distributions).
function BarRow({ rows }: { rows: { label: string; value: number; cls: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.label} className="flex items-center gap-2 text-[12px]">
          <span className="w-24 shrink-0 truncate font-medium text-ink-soft">{r.label}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-track">
            <div className={`h-full rounded-full ${r.cls}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <span className="w-6 shrink-0 text-right font-semibold text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

function Distributions({ words }: { words: Word[] }) {
  const pairMap = new Map<string, number>();
  for (const w of words) {
    const k = pairLabel(w.sourceLang, w.targetLang);
    pairMap.set(k, (pairMap.get(k) ?? 0) + 1);
  }
  const pairRows = Array.from(pairMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([label, value]) => ({ label, value, cls: "bg-sage" }));

  const mastered = words.filter((w) => w.reviewCount >= 5).length;
  const learning = words.filter((w) => w.reviewCount >= 1 && w.reviewCount < 5).length;
  const fresh = words.filter((w) => w.reviewCount === 0).length;
  const masteryRows = [
    { label: "Mastered", value: mastered, cls: "bg-sage-deep" },
    { label: "Learning", value: learning, cls: "bg-sage" },
    { label: "New", value: fresh, cls: "bg-taupe" },
  ];

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
          By language pair
        </p>
        <BarRow rows={pairRows} />
      </div>
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
          By progress
        </p>
        <BarRow rows={masteryRows} />
      </div>
    </div>
  );
}

export function StatsPanel() {
  const { accountId } = useAccount();
  const [goal, setGoal] = useDailyGoal();
  const [range, setRange] = useState<string>("14");
  const { data } = useQuery({
    queryKey: ["stats", accountId],
    queryFn: () => api.stats(accountId),
  });
  const { data: words } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
  });

  if (!data) return null;

  // Resolve the selected range to a day count ("All" = since the first word).
  const sel = RANGES.find((r) => r.key === range) ?? RANGES[0];
  const earliest =
    words && words.length
      ? Math.min(...words.map((w) => new Date(w.createdAt).getTime()))
      : Date.now();
  const allDays = Math.ceil((Date.now() - earliest) / 86_400_000) + 1;
  const effDays = Math.min(730, Math.max(14, sel.days === 0 ? allDays : sel.days));

  return (
    <section className="anim-fade-up space-y-7 rounded-[24px] border border-black/[0.06] bg-surface p-6">
      <div className="flex items-baseline justify-between">
        <h3 className="font-serif text-[20px] font-medium italic text-ink">Your progress</h3>
        <span className="text-[13px] font-medium text-ink-faint">🔥 {data.streak}-day streak</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile value={data.total} label="words collected" />
        <Tile value={data.mastered} label="mastered" accent="text-sage" />
        <Tile value={data.trainedToday} label="trained today" />
        <Tile value={<>🔥 {data.streak}</>} label="day streak" accent="text-orange-500" />
      </div>

      <GoalRing done={data.trainedToday} goal={goal} setGoal={setGoal} />

      {/* learning curve with a date-range selector */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Words collected
          </p>
          <div className="flex items-center gap-3">
            <span className="text-[12px] font-semibold text-sage-deep">{data.total} total</span>
            <div className="flex gap-0.5 rounded-full bg-black/[0.05] p-0.5 text-[11px] font-semibold">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={cn(
                    "rounded-full px-2.5 py-1 transition-colors",
                    range === r.key ? "bg-sage text-white" : "text-ink-muted hover:text-ink",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <LearningCurve words={words ?? []} days={effDays} />
      </div>

      {words && words.length > 0 && <Distributions words={words} />}

      <Achievements stats={data} goal={goal} />
    </section>
  );
}
