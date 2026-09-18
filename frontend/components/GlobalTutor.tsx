"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { getLevel } from "@/lib/learnPrefs";
import { useTutorChat } from "@/lib/useTutorChat";
import { LangSelect } from "@/components/LangSelect";
import { TutorThread } from "@/components/TutorThread";
import { HoverTip } from "@/components/ui/HoverTip";
import { Sparkles, RotateCcw, X, LocateFixed, GripHorizontal, Maximize2 } from "lucide-react";

export function GlobalTutor() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const chat = useTutorChat({ active: open });
  const { pair, changePair, messages, input, setInput, send, reset, busy } = chat;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Draggable panel: offset from its docked corner, remembered across opens and
  // page reloads (localStorage). The "reset position" button clears it.
  const [offset, setOffset] = useState<{ x: number; y: number }>(() => {
    try {
      const r = localStorage.getItem("lexa.tutorPos");
      if (r) {
        const p = JSON.parse(r);
        if (typeof p?.x === "number" && typeof p?.y === "number") return p;
      }
    } catch {
      /* ignore */
    }
    return { x: 0, y: 0 };
  });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem("lexa.tutorPos", JSON.stringify(offset));
    } catch {
      /* ignore */
    }
  }, [offset]);
  // Keep the panel fully on screen — so it can never be dragged off and lost, and
  // a stored position from a bigger window is pulled back in.
  function clampToViewport() {
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    setOffset((o) => {
      let x = o.x;
      let y = o.y;
      if (r.left < pad) x += pad - r.left;
      else if (r.right > window.innerWidth - pad) x -= r.right - (window.innerWidth - pad);
      if (r.top < pad) y += pad - r.top;
      else if (r.bottom > window.innerHeight - pad) y -= r.bottom - (window.innerHeight - pad);
      return x === o.x && y === o.y ? o : { x, y };
    });
  }
  function startDrag(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("button, a, input, select, [role='button']")) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
  }
  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    setOffset({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
  }
  function endDrag() {
    dragRef.current = null;
    clampToViewport();
  }
  // Re-clamp when the panel opens or the window resizes (never leave the viewport).
  useEffect(() => {
    if (!open) return;
    const onResize = () => clampToViewport();
    // A tick after open so the panel has laid out.
    const id = window.setTimeout(clampToViewport, 0);
    window.addEventListener("resize", onResize);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);
  const moved = offset.x !== 0 || offset.y !== 0;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  function fillTemplate(template: string) {
    setInput(template);
    inputRef.current?.focus();
  }

  return (
    <>
      {/* floating action button */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("tutor.open")}
          className="fixed bottom-[calc(64px_+_env(safe-area-inset-bottom))] right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-sage to-sage-deep text-white shadow-[0_12px_32px_rgba(46,42,38,0.32)] transition-transform hover:scale-105 active:scale-95 md:bottom-6"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}

      {/* chat panel */}
      {open && (
        <div
          ref={panelRef}
          className="fixed inset-x-2 bottom-[calc(64px_+_env(safe-area-inset-bottom))] z-50 mx-auto flex max-h-[75vh] w-auto max-w-[420px] flex-col overflow-hidden rounded-[22px] border border-black/[0.08] bg-surface shadow-[0_24px_60px_rgba(46,42,38,0.34)] sm:inset-x-auto sm:right-4 sm:bottom-6 sm:w-[400px]"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        >
          {/* header — title, centered drag handle, clickable language pair, actions */}
          <div className="border-b border-black/[0.06] bg-gradient-to-br from-sage-tint/70 to-transparent px-4 pt-3 pb-4">
            <div className="relative flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-serif text-[17px] font-semibold text-ink">
                <Sparkles className="h-[18px] w-[18px] text-sage-deep" />
                {t("tutor.title")}
              </div>
              <div
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                aria-label={t("common.drag")}
                className="absolute left-1/2 flex -translate-x-1/2 cursor-grab touch-none select-none items-center px-6 py-1 text-ink-faint transition-colors hover:text-ink-muted active:cursor-grabbing"
              >
                <GripHorizontal className="h-4 w-4" />
              </div>
              <div className="flex items-center gap-1.5">
                {moved && (
                  <HoverTip title={t("tutor.resetPos")} className="inline-flex">
                    <button
                      type="button"
                      onClick={() => setOffset({ x: 0, y: 0 })}
                      aria-label={t("tutor.resetPos")}
                      className="rounded-lg p-1.5 text-ink-faint hover:bg-black/[0.04] hover:text-ink"
                    >
                      <LocateFixed className="h-3.5 w-3.5" />
                    </button>
                  </HoverTip>
                )}
                {messages.length > 0 && (
                  <button
                    type="button"
                    onClick={reset}
                    className="rounded-lg p-1.5 text-ink-faint hover:bg-black/[0.04] hover:text-ink"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </button>
                )}
                <HoverTip title={t("tutor.openPage")} className="inline-flex">
                  <Link
                    href="/mika"
                    onClick={() => setOpen(false)}
                    aria-label={t("tutor.openPage")}
                    className="rounded-lg p-1.5 text-ink-faint hover:bg-black/[0.04] hover:text-ink"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Link>
                </HoverTip>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={t("common.cancel")}
                  className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-black/[0.05] hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-[13px] text-ink-soft">
              <LangSelect value={pair.source} onChange={(v) => changePair({ source: v, target: pair.target })} className="h-8 min-w-0" />
              <span className="text-ink-faint">→</span>
              <LangSelect value={pair.target} onChange={(v) => changePair({ source: pair.source, target: v })} className="h-8 min-w-0" />
            </div>
          </div>

          {/* conversation / welcome */}
          <div ref={scrollRef} className="min-h-[160px] flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-[14px] leading-relaxed text-ink-soft">{t("tutor.welcome")}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Chip onClick={() => fillTemplate(t("tutor.topicTemplate"))}>{t("tutor.suggestTopic")}</Chip>
                  <Chip onClick={() => send(t("tutor.levelTemplate", { level: getLevel(pair.source) ?? "B1" }))}>
                    {t("tutor.suggestLevel")}
                  </Chip>
                  <Chip onClick={() => fillTemplate(t("tutor.explainTemplate"))}>{t("tutor.suggestExplain")}</Chip>
                </div>
              </div>
            )}

            <TutorThread chat={chat} />
          </div>

          {/* footer: input (collection choice appears with the "create cards" action) */}
          <div className="border-t border-black/[0.06] px-3 py-2.5">
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t("tutor.placeholder")}
                disabled={busy}
                className="h-10 flex-1 rounded-full border border-black/[0.08] bg-surface px-4 text-[16px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none sm:text-[14px]"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="shrink-0 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sage-deep disabled:opacity-40"
              >
                {t("word.send")}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function Chip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-sage/40 bg-sage-tint/50 px-3 py-1.5 text-[12px] font-semibold text-sage-deep transition-colors hover:bg-sage-tint"
    >
      {children}
    </button>
  );
}
