"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Plus, Check, Loader2 } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { SpeakButton } from "@/components/SpeakButton";
import { cn } from "@/lib/utils";

const srcFont = (l: string) => (l === "zh" || l === "zh-Hant" || l === "ja" ? "font-zh" : "");

export type WordPopTarget = {
  word: string;
  meaning?: string;
  transcription?: string; // pinyin / romaji, when the source language has one
  loading?: boolean; // the gloss request is still in flight
  sentence?: string; // the bubble the word was tapped in → the card's example
  sourceLang: string;
  targetLang: string;
  isNew?: boolean; // not yet in the learner's deck → offer "add to my words"
  anchor: HTMLElement; // the tapped highlight, to follow on scroll
};

// A small meaning popover for a highlighted word in the Coach chat / scene bubbles —
// the same "tap a word, see what it means" mechanic as the Reader. For a word the
// learner doesn't own yet it also offers a one-tap "add to my words".
export function WordMeaningPop({
  target,
  adding,
  added,
  onAdd,
  onClose,
}: {
  target: WordPopTarget;
  adding?: boolean;
  added?: boolean;
  onAdd?: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const close = useCallback(() => onClose(), [onClose]);

  // Anchor under the tapped word; follow it while the conversation scrolls; dismiss on
  // Escape, on a tap outside the popover, or when the word scrolls off-screen.
  useEffect(() => {
    const reposition = () => {
      const el = target.anchor;
      if (!el || !el.isConnected) return close();
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) return close();
      const x = Math.min(window.innerWidth - 124, Math.max(124, rect.left + rect.width / 2));
      setPos({ x, y: rect.bottom });
    };
    reposition();
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: PointerEvent) => {
      if (!popRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("keydown", onEsc);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("keydown", onEsc);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [target.anchor, close]);

  if (!pos) return null;
  const { word, meaning, transcription, loading, sourceLang, targetLang, isNew } = target;

  return createPortal(
    <div className="fixed z-[90] -translate-x-1/2" style={{ left: pos.x, top: pos.y + 8 }}>
      <div
        ref={popRef}
        className="anim-popover w-[228px] rounded-[14px] border border-black/[0.08] bg-surface p-3 shadow-[0_14px_40px_rgba(46,42,38,0.24)]"
      >
        <div className="flex items-center gap-1.5">
          <span className={cn("select-text text-[15px] font-semibold text-ink", srcFont(sourceLang))}>{word}</span>
          <SpeakButton text={word} lang={sourceLang} size="sm" />
          {isNew && (
            <span className="ml-auto rounded-full bg-warn-bg px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warn-text">
              {t("pop.new")}
            </span>
          )}
        </div>
        {transcription && (
          <div className="mt-0.5 select-text text-[12px] font-medium tracking-wide text-ink-faint">{transcription}</div>
        )}
        {loading ? (
          <div className="mt-1.5 flex items-center gap-1.5 text-[13px] text-ink-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("pop.loading")}
          </div>
        ) : (
          meaning && (
            <div className={cn("mt-1 select-text text-[13px] leading-snug text-sage-deep", srcFont(targetLang))}>{meaning}</div>
          )
        )}
        {isNew && onAdd && (
          <button
            type="button"
            onClick={onAdd}
            disabled={adding || added || loading || !meaning}
            className="mt-2.5 inline-flex w-full items-center justify-center gap-1.5 rounded-[10px] bg-sage px-2.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-sage-deep disabled:opacity-60"
          >
            {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : added ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {added ? t("pop.added") : t("pop.add")}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
