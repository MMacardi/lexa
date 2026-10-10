"use client";

// The writing trainer: a word's characters written stroke by stroke on a
// practice-book square, each stroke checked the moment the pen lifts
// (lib/strokeMatch.ts, on the stroke file the Characters block animates).
// "Trace" shows the character to write over; "From memory" only the grid. A
// right stroke settles into place, a wrong one fades out with a word on why
// (a later stroke, the wrong way round), and after three misses on one stroke
// it's drawn as a hint. Offline, no model call. On the word page and /write.

import { useEffect, useRef, useState } from "react";
import { Check, Lightbulb, RotateCcw } from "lucide-react";
import { strokesFor, type Stroke } from "@/lib/strokes";
import { judgeStroke, type Pt, type Verdict } from "@/lib/strokeMatch";
import { useI18n } from "@/lib/i18n";
import { Segmented } from "@/components/ui/Segmented";
import { cn } from "@/lib/utils";

export type WriteMode = "trace" | "memory";
export type WriteResult = { mistakes: number; hints: number };

const HAN = /\p{Script=Han}/u;
const WIDTH = 16; // the character's pen, as StrokeOrder draws it
const INK = 10; // the learner's pen
const HINT_AFTER = 3; // misses on one stroke before it's shown
const MS_PER_UNIT = 2.4; // a hint's drawing speed, StrokeOrder's
const NEXT_CHAR_MS = 450; // the finished character stays a moment

const lengthOf = (s: Pt[]) => Math.max(1, s.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - s[i - 1][0], p[1] - s[i - 1][1]) : 0), 0));
const pathOf = (s: Pt[]) =>
  s.length === 1 ? `M${s[0][0]} ${s[0][1]}h0` : s.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");

// Remembered per place (the word page traces, the drill writes from memory).
function useWriteMode(key: string, fallback: WriteMode) {
  const [mode, setMode] = useState<WriteMode>(fallback);
  useEffect(() => {
    try {
      const v = localStorage.getItem(key);
      if (v === "trace" || v === "memory") setMode(v);
    } catch {
      /* ignore */
    }
  }, [key]);
  const set = (m: WriteMode) => {
    setMode(m);
    try {
      localStorage.setItem(key, m);
    } catch {
      /* ignore */
    }
  };
  return [mode, set] as const;
}

export function WritingTrainer({
  word,
  storeKey = "word",
  defaultMode = "trace",
  fixedMode,
  onFinish,
  children,
}: {
  word: string;
  /** Where the learner's Trace / From memory choice is remembered. */
  storeKey?: string;
  defaultMode?: WriteMode;
  /** The drill decides the mode per card: no switch, no "Write again". */
  fixedMode?: WriteMode;
  onFinish?: (r: WriteResult) => void;
  /** Shown beside the result once the word is written. */
  children?: React.ReactNode;
}) {
  const { t } = useI18n();
  const [chosen, setMode] = useWriteMode(`lexa.writeMode.${storeKey}`, defaultMode);
  const mode = fixedMode ?? chosen;
  const chars = [...word].filter((c) => HAN.test(c));
  // Per character its strokes, or null when the stroke file lacks it (then it
  // stands written and is skipped).
  const [data, setData] = useState<(Stroke[] | null)[] | null>(null);
  const [at, setAt] = useState(0);
  const [run, setRun] = useState(0); // bumped by "Write again": every square starts over
  const [total, setTotal] = useState<WriteResult>({ mistakes: 0, hints: 0 });
  const [finished, setFinished] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let live = true;
    setData(null);
    Promise.all([...word].filter((c) => HAN.test(c)).map((c) => strokesFor(c).catch(() => null))).then((d) => {
      if (!live) return;
      setData(d);
      setAt(Math.max(0, d.findIndex(Boolean)));
    });
    return () => {
      live = false;
    };
  }, [word]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  if (!data) return <div className="mx-auto aspect-square w-full max-w-[300px] rounded-[16px] border border-black/[0.08] bg-paper" aria-hidden />;
  if (!data.some(Boolean)) return <p className="text-[14px] text-ink-muted">{t("write.noData")}</p>;

  function charDone(r: WriteResult) {
    const sum = { mistakes: total.mistakes + r.mistakes, hints: total.hints + r.hints };
    setTotal(sum);
    const next = data!.findIndex((s, i) => i > at && s);
    timer.current = window.setTimeout(() => {
      if (next >= 0) setAt(next);
      else {
        setFinished(true);
        onFinish?.(sum);
      }
    }, NEXT_CHAR_MS);
  }

  function again() {
    window.clearTimeout(timer.current);
    setAt(Math.max(0, data!.findIndex(Boolean)));
    setTotal({ mistakes: 0, hints: 0 });
    setFinished(false);
    setRun((r) => r + 1);
  }

  const strokes = data[at];
  const clean = !total.mistakes && !total.hints;
  return (
    <div className="space-y-3">
      {!fixedMode && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented
            size="sm"
            ariaLabel={t("write.mode")}
            value={mode}
            onChange={setMode}
            options={[
              { value: "trace", label: t("write.trace") },
              { value: "memory", label: t("write.memory") },
            ]}
          />
          <button
            type="button"
            onClick={again}
            title={t("write.again")}
            aria-label={t("write.again")}
            className="rounded-full p-2 text-ink-faint transition-colors hover:bg-black/[0.04] hover:text-ink"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* The word so far: written characters in ink, the one being written
          framed; from memory the rest stay blank. */}
      {chars.length > 1 && (
        <div className="flex flex-wrap justify-center gap-1.5">
          {chars.map((c, i) => {
            const written = finished || i < at || !data[i];
            return (
              <span
                key={i}
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-[10px] border font-zh text-[22px] leading-none",
                  i === at && !finished ? "border-sage" : "border-black/[0.08]",
                  written ? "text-ink" : "text-ink/20",
                )}
              >
                {written || mode === "trace" ? c : ""}
              </span>
            );
          })}
        </div>
      )}

      {strokes && <WriteChar key={`${run}-${at}`} strokes={strokes} mode={mode} onDone={charDone} />}

      {finished && (
        <div className="anim-fade-in flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          <p className={cn("inline-flex items-center gap-1.5 text-[14px] font-semibold", clean ? "text-sage-deep" : "text-ink-soft")}>
            {clean && <Check className="h-4 w-4" />}
            {clean ? t("write.clean") : t("write.score", { m: total.mistakes, h: total.hints })}
          </p>
          {!fixedMode && (
            <button
              type="button"
              onClick={again}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] px-3 py-1.5 text-[13px] font-semibold text-ink-muted transition-colors hover:border-sage/60 hover:text-sage-deep"
            >
              <RotateCcw className="h-3.5 w-3.5" /> {t("write.again")}
            </button>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

// One character's square: the strokes written so far, the learner's pen, and a
// line under it saying which stroke is next or what was wrong with the last.
function WriteChar({ strokes, mode, onDone }: { strokes: Stroke[]; mode: WriteMode; onDone: (r: WriteResult) => void }) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const inkRef = useRef<SVGPathElement>(null);
  const pen = useRef<Pt[] | null>(null);
  const [next, setNext] = useState(0);
  const [misses, setMisses] = useState(0); // on the stroke being written
  const [hint, setHint] = useState(0); // >0: that stroke is shown; bumped to replay it
  const [score, setScore] = useState<WriteResult>({ mistakes: 0, hints: 0 });
  const [miss, setMiss] = useState<{ d: string; n: number } | null>(null);
  const [note, setNote] = useState<Verdict | null>(null);
  const done = next >= strokes.length;

  // A finger held still is iOS's long press, which goes looking for text to
  // select; cancelling the touch at its start keeps it a stroke (HandwritingPad).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const hold = (e: TouchEvent) => e.preventDefault();
    el.addEventListener("touchstart", hold, { passive: false });
    return () => el.removeEventListener("touchstart", hold);
  }, []);

  const toGrid = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) * 256) / r.width, ((e.clientY - r.top) * 256) / r.height];
  };
  const paint = () => inkRef.current?.setAttribute("d", pen.current ? pathOf(pen.current) : "");

  function judge(drawn: Pt[]) {
    const v = judgeStroke(drawn, strokes, next, mode === "trace");
    if (v === "ok") {
      setNext(next + 1);
      setMisses(0);
      setHint(0);
      setNote(null);
      setMiss(null);
      if (next + 1 === strokes.length) onDone(score);
      return;
    }
    const s = { ...score, mistakes: score.mistakes + 1 };
    const showNow = misses + 1 >= HINT_AFTER && !hint;
    if (showNow) {
      s.hints++;
      setHint(1);
    }
    setScore(s);
    setMisses(misses + 1);
    setMiss({ d: pathOf(drawn), n: (miss?.n ?? 0) + 1 });
    // The hint says it better than the reason for this miss.
    setNote(showNow ? null : v);
  }

  function showHint() {
    if (done) return;
    if (!hint) setScore((s) => ({ ...s, hints: s.hints + 1 }));
    setHint((h) => h + 1);
  }

  const want = strokes[next];
  const wantLen = want ? lengthOf(want) : 0;
  const status = done
    ? t("write.charDone")
    : note === "miss"
      ? t("write.miss")
      : note === "order"
        ? t("write.order")
        : note === "backwards"
          ? t("write.backwards")
          : hint
            ? t("write.followHint")
            : t("write.stroke", { n: next + 1, total: strokes.length });

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative aspect-square w-full max-w-[300px] select-none rounded-[16px] border border-black/[0.08] bg-paper [-webkit-touch-callout:none]">
        {/* data-own-touch: a downward stroke isn't a swipe to close a sheet. */}
        <svg
          ref={svgRef}
          viewBox="0 0 256 256"
          data-own-touch
          role="img"
          aria-label={t("write.pad")}
          className={cn("block h-full w-full touch-none", !done && "cursor-crosshair")}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            if (done || (e.pointerType === "mouse" && e.button !== 0)) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            pen.current = [toGrid(e)];
            setNote(null);
            paint();
          }}
          onPointerMove={(e) => {
            if (!pen.current) return;
            const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
            for (const ev of events.length ? events : [e.nativeEvent]) pen.current.push(toGrid(ev));
            paint();
          }}
          onPointerUp={() => {
            const drawn = pen.current;
            pen.current = null;
            paint();
            if (drawn) judge(drawn);
          }}
          onPointerCancel={() => {
            pen.current = null;
            paint();
          }}
        >
          {/* 米字格 — the practice grid Chinese exercise books use. */}
          <g className="stroke-ink/[0.12]" strokeWidth={1.5} strokeDasharray="6 6">
            <line x1="128" y1="4" x2="128" y2="252" />
            <line x1="4" y1="128" x2="252" y2="128" />
            <line x1="4" y1="4" x2="252" y2="252" />
            <line x1="252" y1="4" x2="4" y2="252" />
          </g>
          <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={WIDTH}>
            {mode === "trace" && strokes.map((s, i) => i >= next && <path key={`o${i}`} d={pathOf(s)} className="stroke-ink/[0.13]" />)}
            {hint > 0 && want && (
              <path
                key={`h${next}-${hint}`}
                d={pathOf(want)}
                className="stroke-draw stroke-sage/70"
                style={
                  {
                    strokeDasharray: `${wantLen} ${wantLen + 2 * WIDTH}`,
                    "--dash-from": wantLen + WIDTH,
                    "--dash-ms": `${Math.max(220, wantLen * MS_PER_UNIT)}ms`,
                  } as React.CSSProperties
                }
              />
            )}
            {strokes.slice(0, next).map((s, i) => (
              <path key={i} d={pathOf(s)} className={cn(done ? "stroke-sage-deep" : "stroke-ink", i === next - 1 && "ink-in")} />
            ))}
          </g>
          <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={INK}>
            {miss && <path key={miss.n} d={miss.d} className="ink-miss stroke-warn" />}
            <path ref={inkRef} className="stroke-ink-soft" />
          </g>
        </svg>
      </div>
      <div className="flex w-full max-w-[300px] items-center justify-between gap-2">
        <p aria-live="polite" className={cn("min-w-0 text-[13px] leading-snug", note ? "text-warn-text" : done ? "text-sage-deep" : "text-ink-muted")}>
          {status}
        </p>
        {!done && (
          <button
            type="button"
            onClick={showHint}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-black/[0.08] px-3 py-1.5 text-[12px] font-semibold text-ink-muted transition-colors hover:border-sage/60 hover:text-sage-deep"
          >
            <Lightbulb className="h-3.5 w-3.5" /> {t("write.hint")}
          </button>
        )}
      </div>
    </div>
  );
}
