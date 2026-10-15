"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Play, X } from "lucide-react";
import { strokesFor, type Stroke } from "@/lib/strokes";
import { useI18n } from "@/lib/i18n";
import { useLockScroll } from "@/lib/mobileNav";
import { cn } from "@/lib/utils";

const MS_PER_UNIT = 2.4; // drawing time per unit of the 256 grid
const MIN_MS = 220; // a dot still reads as written
const PAUSE = 140; // between strokes
const WIDTH = 16; // pen width on the grid; its round caps reach WIDTH / 2 past a dash

const lengthOf = (s: Stroke) =>
  Math.max(1, s.reduce((n, p, i) => (i ? n + Math.hypot(p[0] - s[i - 1][0], p[1] - s[i - 1][1]) : 0), 0));
const pathOf = (s: Stroke) => s.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");

/**
 * A character's stroke order in a practice-book square: at rest the strokes as
 * written, a tap opens it large (the author, 2026-10-14: "so I could see how to
 * write it bigger"), where the strokes are drawn one by one, and again on a tap.
 * Nothing (no box) for a character the stroke file lacks.
 */
export function StrokeOrder({ char, className }: { char: string; className?: string }) {
  const { t } = useI18n();
  const [strokes, setStrokes] = useState<Stroke[] | null | undefined>(undefined);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let live = true;
    strokesFor(char)
      .then((s) => live && setStrokes(s))
      .catch(() => live && setStrokes(null));
    return () => {
      live = false;
    };
  }, [char]);

  if (strokes === null) return null;
  const box = cn("relative h-[76px] w-[76px] shrink-0 rounded-[12px] border border-black/[0.08] bg-paper", className);
  if (!strokes) return <div className={box} aria-hidden />;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t("chars.strokes")}
        title={t("chars.strokes")}
        className={cn(box, "group transition-colors hover:border-sage/60")}
      >
        <StrokeSquare strokes={strokes} run={0} />
        <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-surface/90 text-ink-faint group-hover:text-sage-deep">
          <Maximize2 className="h-2.5 w-2.5" />
        </span>
      </button>
      {open && <StrokeZoom char={char} strokes={strokes} onClose={() => setOpen(false)} />}
    </>
  );
}

// The character large over the page, drawn as it opens; the square or "Again" draws
// it once more. Esc, the cross or a tap outside closes it.
function StrokeZoom({ char, strokes, onClose }: { char: string; strokes: Stroke[]; onClose: () => void }) {
  const { t } = useI18n();
  const [run, setRun] = useState(1);
  useLockScroll(true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="anim-scrim vv-overlay z-[120] flex items-center justify-center bg-onyx/45 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal
      aria-label={t("chars.strokesOf", { c: char })}
    >
      <div className="anim-scale-in w-[min(100%,440px)] rounded-[24px] border border-black/[0.07] bg-surface p-4 shadow-2xl sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[13px] font-semibold text-ink-soft">
            <span className="mr-2 font-zh text-[22px] text-ink">{char}</span>
            {t("chars.strokeCount", { n: strokes.length })}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-black/[0.05] hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => setRun((r) => r + 1)}
          aria-label={t("chars.strokesAgain")}
          className="block aspect-square w-full rounded-[16px] border border-black/[0.08] bg-paper"
        >
          <StrokeSquare strokes={strokes} run={run} />
        </button>
        <button
          type="button"
          onClick={() => setRun((r) => r + 1)}
          className="mx-auto mt-3 flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-4 py-2 text-[13px] font-semibold text-ink-muted transition-colors hover:border-sage/60 hover:text-sage-deep"
        >
          <Play className="h-3.5 w-3.5" /> {t("chars.strokesAgain")}
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** The square itself: the strokes at rest, or (`run` > 0, bumped per play) drawn one by one. */
function StrokeSquare({ strokes, run }: { strokes: Stroke[]; run: number }) {
  // The run whose paths are drawing: a new run's paths mount undrawn (their key
  // carries `run`), and two frames later they get their transitions.
  const [drawing, setDrawing] = useState(0);
  const go = drawing === run;
  useEffect(() => {
    if (!run) return;
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setDrawing(run));
    });
    return () => cancelAnimationFrame(id);
  }, [run]);

  const lens = strokes.map(lengthOf);
  let clock = 0;
  const timing = lens.map((len) => {
    const d = Math.max(MIN_MS, len * MS_PER_UNIT);
    const at = clock;
    clock += d + PAUSE;
    return { d, at };
  });
  return (
    <svg viewBox="0 0 256 256" className="h-full w-full" aria-hidden>
      {/* 田字格: the practice book's square, split in four */}
      <g className="stroke-black/[0.08]" strokeWidth={2} strokeDasharray="8 8">
        <line x1="128" y1="6" x2="128" y2="250" />
        <line x1="6" y1="128" x2="250" y2="128" />
      </g>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={WIDTH}>
        {strokes.map((s, i) => (
          <path key={i} d={pathOf(s)} className={run ? "stroke-ink/15" : "stroke-ink"} />
        ))}
        {/* Each stroke a dash slid in from before its start, far enough that the
            round cap at the dash's end isn't left showing as a dot. */}
        {run > 0 &&
          strokes.map((s, i) => (
            <path
              key={`${run}-${i}`}
              d={pathOf(s)}
              className="stroke-sage-deep"
              style={{
                strokeDasharray: `${lens[i]} ${lens[i] + 2 * WIDTH}`,
                strokeDashoffset: go ? 0 : lens[i] + WIDTH,
                transition: go ? `stroke-dashoffset ${timing[i].d}ms linear ${timing[i].at}ms` : "none",
              }}
            />
          ))}
      </g>
    </svg>
  );
}
