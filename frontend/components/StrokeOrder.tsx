"use client";

import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import { strokesFor, type Stroke } from "@/lib/strokes";
import { useI18n } from "@/lib/i18n";
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
 * written, a tap draws them again one by one. Nothing (no box) for a character
 * the stroke file lacks.
 */
export function StrokeOrder({ char, className }: { char: string; className?: string }) {
  const { t } = useI18n();
  const [strokes, setStrokes] = useState<Stroke[] | null | undefined>(undefined);
  // Bumped per tap: remounts the drawn paths, so their transitions start over.
  const [run, setRun] = useState(0);
  const [go, setGo] = useState(false);

  useEffect(() => {
    let live = true;
    strokesFor(char)
      .then((s) => live && setStrokes(s))
      .catch(() => live && setStrokes(null));
    return () => {
      live = false;
    };
  }, [char]);

  // The paths mount undrawn; two frames later they get their transitions.
  useEffect(() => {
    if (!run) return;
    setGo(false);
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setGo(true));
    });
    return () => cancelAnimationFrame(id);
  }, [run]);

  if (strokes === null) return null;
  const box = cn("relative h-[76px] w-[76px] shrink-0 rounded-[12px] border border-black/[0.08] bg-paper", className);
  if (!strokes) return <div className={box} aria-hidden />;

  const lens = strokes.map(lengthOf);
  let clock = 0;
  const timing = lens.map((len) => {
    const d = Math.max(MIN_MS, len * MS_PER_UNIT);
    const at = clock;
    clock += d + PAUSE;
    return { d, at };
  });
  return (
    <button
      type="button"
      onClick={() => setRun((r) => r + 1)}
      aria-label={t("chars.strokes")}
      title={t("chars.strokes")}
      className={cn(box, "group transition-colors hover:border-sage/60")}
    >
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
      <span className="absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-surface/90 text-ink-faint group-hover:text-sage-deep">
        <Play className="h-2.5 w-2.5" />
      </span>
    </button>
  );
}
