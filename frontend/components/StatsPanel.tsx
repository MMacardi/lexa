"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useDailyGoal } from "@/lib/goal";
import { pairLabel } from "@/lib/langs";
import { useI18n } from "@/lib/i18n";
import { Achievements } from "@/components/Achievements";
import { ActivityHeatmap } from "@/components/ActivityHeatmap";
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
  const { t } = useI18n();
  const [tip, setTip] = useState<{ x: number; y: number; date: string; value: number } | null>(null);

  useEffect(() => {
    if (!tip) return;
    const close = () => setTip(null);
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest("[data-curvedot]")) setTip(null);
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setTip(null);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onEsc);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onEsc);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [tip]);

  const showTip = (el: HTMLElement, date: string, value: number) => {
    const r = el.getBoundingClientRect();
    setTip({ x: r.left + r.width / 2, y: r.top, date, value });
  };
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
                data-curvedot
                onMouseEnter={(e) => showTip(e.currentTarget, p.date, p.value)}
                onMouseLeave={() => setTip(null)}
                onPointerDown={(e) => {
                  if (e.pointerType !== "mouse") showTip(e.currentTarget, p.date, p.value);
                }}
                className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border-2 border-surface bg-sage-deep transition-transform hover:scale-125 ${
                  i === n - 1 ? "h-3 w-3" : "h-2 w-2"
                }`}
                style={{ left: `${xPct(i)}%`, top: `${yPct(p.value)}%` }}
              />
            ) : null,
          )}
        </div>
      </div>

      {/* portaled tooltip (correct under transformed ancestors + touch tap) */}
      {tip &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[95] -translate-x-1/2 -translate-y-full rounded-[10px] bg-onyx px-2.5 py-1.5 text-center shadow-[0_10px_28px_rgba(0,0,0,0.28)]"
            style={{ left: tip.x, top: tip.y - 8 }}
          >
            <div className="text-[12px] font-semibold text-white">{t("stats.wordsCount", { n: tip.value })}</div>
            <div className="text-[10px] font-medium text-white/60">{dayLabel(tip.date, false)}</div>
          </div>,
          document.body,
        )}

      {/* x-axis date labels — reserve the last slot for "today" and drop any
          regular label too close to it so they don't overlap. */}
      <div className="relative ml-8 mt-1.5 h-4">
        {pts.map((p, i) => {
          const isEnd = i === n - 1;
          const near = Math.max(1, Math.floor(labelEvery / 2));
          const show = isEnd || (i % labelEvery === 0 && i < n - 1 - near);
          if (!show) return null;
          return (
            <span
              key={p.date}
              className={cn(
                "absolute whitespace-nowrap text-[10px] font-medium text-ink-faint",
                isEnd ? "-translate-x-full text-right" : "-translate-x-1/2",
                i === 0 && "translate-x-0",
              )}
              style={{ left: `${xPct(i)}%` }}
            >
              {isEnd ? t("stats.today") : dayLabel(p.date, monthOnly)}
            </span>
          );
        })}
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
  const { t } = useI18n();
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
    { label: t("stats.mastered"), value: mastered, cls: "bg-sage-deep" },
    { label: t("stats.learning"), value: learning, cls: "bg-sage" },
    { label: t("stats.new"), value: fresh, cls: "bg-taupe" },
  ];

  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
          {t("stats.byPair")}
        </p>
        <BarRow rows={pairRows} />
      </div>
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
          {t("stats.byProgress")}
        </p>
        <BarRow rows={masteryRows} />
      </div>
    </div>
  );
}

export function StatsPanel() {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const [goal] = useDailyGoal();
  const [range, setRange] = useState<string>("14");
  const [metric, setMetric] = useState<"collected" | "mastered">("collected");
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

  // Curve source: all words (collected) or only mastered ones. Mastered history
  // isn't stored, so we approximate by createdAt of currently-mastered words.
  const allWords = words ?? [];
  const curveWords = metric === "mastered" ? allWords.filter((w) => w.reviewCount >= 5) : allWords;
  const curveTotal = metric === "mastered" ? data.mastered : data.total;

  return (
    <section className="anim-fade-up space-y-7 rounded-[24px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <div className="flex items-baseline justify-between">
        <h3 className="font-serif text-[20px] font-medium italic text-ink">{t("stats.title")}</h3>
        <span className="text-[13px] font-medium text-ink-faint">{t("stats.streakSummary", { n: data.streak })}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile value={data.total} label={t("stats.tile.collected")} />
        <Tile value={data.mastered} label={t("stats.tile.mastered")} accent="text-sage" />
        <Tile value={data.trainedToday} label={t("stats.tile.trainedToday")} />
        <Tile value={<>🔥 {data.streak}</>} label={t("stats.tile.streak")} accent="text-orange-500" />
      </div>

      {/* learning curve: metric toggle + date-range selector */}
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-0.5 rounded-full bg-black/[0.05] p-0.5 text-[12px] font-semibold">
            {(["collected", "mastered"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={cn(
                  "rounded-full px-3 py-1 transition-colors",
                  metric === m ? "bg-sage text-white" : "text-ink-muted hover:text-ink",
                )}
              >
                {t(m === "collected" ? "stats.metricCollected" : "stats.metricMastered")}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] font-semibold text-sage-deep">{t("stats.total", { n: curveTotal })}</span>
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
        <LearningCurve words={curveWords} days={effDays} />
      </div>

      {data.heat && data.heat.length > 0 && <ActivityHeatmap heat={data.heat} />}

      {words && words.length > 0 && <Distributions words={words} />}

      <Achievements stats={data} goal={goal} />
    </section>
  );
}
