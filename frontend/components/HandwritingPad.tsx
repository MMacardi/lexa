"use client";

// Draw a hanzi with your finger, Pleco-style: the characters that look like what
// you've drawn line up above the pad, and half a character is enough — a 女 on
// the left already offers 好, 妈, 她. Tapping one hands it to the field and clears
// the pad for the next. Recognition is offline (lib/handwriting.ts, in a worker).

import { useCallback, useEffect, useRef, useState } from "react";
import { Delete, Eraser, Undo2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import type { Point } from "@/lib/handwriting";

// One worker for the page's life: it holds the parsed templates, so a pad that
// is closed and reopened doesn't parse them again.
let worker: Worker | null = null;
let nextId = 0;
function getWorker(): Worker {
  worker ??= new Worker(new URL("../lib/handwriting.worker.ts", import.meta.url));
  return worker;
}

export function HandwritingPad({
  onPick,
  onBackspace,
  canBackspace,
  disabled,
}: {
  onPick: (ch: string) => void;
  onBackspace: () => void;
  canBackspace: boolean;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef<Point[] | null>(null);
  const size = useRef(0);
  const asked = useRef(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [candidates, setCandidates] = useState<string[]>([]);
  const [inked, setInked] = useState(false);

  useEffect(() => {
    const w = getWorker();
    const onMessage = (e: MessageEvent<{ ready?: true; error?: string; id?: number; chars?: string[] }>) => {
      if (e.data.error) setStatus("error");
      else if (e.data.ready) setStatus("ready");
      else if (e.data.id === asked.current) setCandidates(e.data.chars ?? []);
    };
    w.addEventListener("message", onMessage);
    w.postMessage("load");
    return () => w.removeEventListener("message", onMessage);
  }, []);

  const redraw = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.current, size.current);
    ctx.strokeStyle = ctx.fillStyle = getComputedStyle(c).color;
    ctx.lineWidth = Math.max(4, size.current / 32);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of strokes.current) {
      ctx.beginPath();
      if (s.length === 1) {
        ctx.arc(s[0][0], s[0][1], ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.moveTo(s[0][0], s[0][1]);
      for (const [x, y] of s.slice(1)) ctx.lineTo(x, y);
      ctx.stroke();
    }
  }, []);

  // Keep the backing store at device resolution for whatever width the pad gets.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const fit = () => {
      const w = c.getBoundingClientRect().width;
      if (!w) return;
      const dpr = window.devicePixelRatio || 1;
      // Rescale the ink with the pad, so a rotation mid-character keeps it.
      const k = size.current ? w / size.current : 1;
      if (k !== 1) strokes.current = strokes.current.map((s) => s.map(([x, y]) => [x * k, y * k] as Point));
      size.current = w;
      c.width = Math.round(w * dpr);
      c.height = Math.round(w * dpr);
      redraw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(c);
    return () => ro.disconnect();
  }, [redraw]);

  // A finger held still (a dot) is iOS's long press, which went looking for text
  // to select next to the pad. Cancelling the touch at its start keeps it a
  // stroke: pointer events still arrive, the press-and-hold gesture never starts.
  // Native and non-passive, as React's touch listeners are passive.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const hold = (e: TouchEvent) => e.preventDefault();
    c.addEventListener("touchstart", hold, { passive: false });
    return () => c.removeEventListener("touchstart", hold);
  }, []);

  const ask = () => {
    const id = ++nextId;
    asked.current = id;
    if (!strokes.current.length) {
      setCandidates([]);
      return;
    }
    getWorker().postMessage({ id, strokes: strokes.current, box: size.current });
  };

  const at = (e: { clientX: number; clientY: number }): Point => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const clear = () => {
    strokes.current = [];
    setInked(false);
    redraw();
    ask();
  };

  return (
    // select-none + no touch callout: a long press while writing is a stroke, not
    // iOS's Copy / Translate / Share bubble over the pad.
    <div className="anim-fade-up space-y-2 rounded-[14px] border border-black/[0.08] bg-surface p-2.5 select-none [-webkit-touch-callout:none]">
      {/* Candidates sit above the pad, where a drawing hand doesn't cover them. */}
      <div className="flex h-11 items-center gap-1 overflow-x-auto" aria-live="polite">
        {candidates.length ? (
          candidates.map((ch) => (
            <button
              key={ch}
              type="button"
              disabled={disabled}
              onClick={() => {
                onPick(ch);
                clear();
              }}
              className="h-10 w-10 shrink-0 rounded-[10px] font-zh text-[22px] leading-none text-ink transition-colors hover:bg-sage-tint active:bg-sage-tint disabled:opacity-50"
            >
              {ch}
            </button>
          ))
        ) : (
          <span className="px-1 text-[13px] leading-snug text-ink-faint">
            {status === "error" ? t("draw.loadFailed") : status === "loading" && inked ? t("draw.loading") : t("draw.hint")}
          </span>
        )}
      </div>
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          {/* 米字格 — the practice grid Chinese exercise books use. */}
          <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 h-full w-full text-ink-faint/40" aria-hidden>
            <g stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 2" fill="none">
              <line x1="50" y1="0" x2="50" y2="100" />
              <line x1="0" y1="50" x2="100" y2="50" />
              <line x1="0" y1="0" x2="100" y2="100" />
              <line x1="100" y1="0" x2="0" y2="100" />
            </g>
          </svg>
          {/* data-own-touch: a downward stroke isn't a swipe to close the sheet. */}
          <canvas
            ref={canvasRef}
            data-own-touch
            aria-label={t("draw.pad")}
            className="relative block aspect-square w-full touch-none rounded-[10px] border border-black/[0.08] text-ink"
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              if (disabled || (e.pointerType === "mouse" && e.button !== 0)) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              drawing.current = [at(e)];
              strokes.current.push(drawing.current);
              setInked(true);
              redraw();
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
              for (const ev of events.length ? events : [e.nativeEvent]) drawing.current.push(at(ev));
              redraw();
            }}
            onPointerUp={() => {
              if (!drawing.current) return;
              drawing.current = null;
              ask();
            }}
            onPointerCancel={() => {
              if (!drawing.current) return;
              strokes.current.pop();
              drawing.current = null;
              setInked(strokes.current.length > 0);
              redraw();
            }}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          {(
            [
              {
                Icon: Undo2,
                label: t("draw.undo"),
                off: !inked,
                run: () => {
                  strokes.current.pop();
                  setInked(strokes.current.length > 0);
                  redraw();
                  ask();
                },
              },
              { Icon: Eraser, label: t("draw.clear"), off: !inked, run: clear },
              { Icon: Delete, label: t("draw.backspace"), off: !canBackspace || disabled, run: onBackspace },
            ] as const
          ).map(({ Icon, label, off, run }) => (
            <button
              key={label}
              type="button"
              title={label}
              aria-label={label}
              disabled={off}
              onClick={run}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-black/[0.08] text-ink-muted transition-colors hover:bg-black/[0.03] disabled:opacity-40"
            >
              <Icon className="h-[18px] w-[18px]" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
