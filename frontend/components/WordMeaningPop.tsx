"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Plus, Check, Loader2, X } from "lucide-react";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { SpeakButton } from "@/components/SpeakButton";
import { Pinyin } from "@/components/Pinyin";
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
  const { accountId } = useAccount();
  // A direct card link can open before the word list has ever been cached.
  const deck = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
    enabled: !!accountId,
  });
  const owned = deck.data?.find((w) => w.word.trim().toLowerCase() === target.word.trim().toLowerCase()
    && w.sourceLang === target.sourceLang && w.targetLang === target.targetLang);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  const close = useCallback(() => onClose(), [onClose]);

  // Anchor under the tapped word; follow it while the conversation scrolls; dismiss on
  // Escape, on a tap outside the popover, or when the word scrolls off-screen.
  useLayoutEffect(() => {
    const reposition = () => {
      const el = target.anchor;
      if (!el || !el.isConnected) return close();
      const rect = el.getBoundingClientRect();
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
      if (rect.bottom < top || rect.top > top + height) return close();
      const box = popRef.current;
      if (!box) return;
      box.style.maxWidth = `${Math.min(240, width - 16)}px`;
      box.style.maxHeight = `${height - 16}px`;
      const size = { width: box.offsetWidth, height: box.offsetHeight };
      const x = Math.max(left + 8, Math.min(left + width - size.width - 8, rect.left + (rect.width - size.width) / 2));
      const below = rect.bottom + 8;
      const y = Math.max(top + 8, Math.min(top + height - size.height - 8,
        below + size.height <= top + height - 8 ? below : rect.top - size.height - 8));
      setPos((cur) => cur?.x === x && cur.y === y ? cur : { x, y });
    };
    reposition();
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      close();
      target.anchor.focus({ preventScroll: true });
    };
    const onDown = (e: PointerEvent) => {
      if (!popRef.current?.contains(e.target as Node) && !target.anchor.contains(e.target as Node)) close();
    };
    const observer = new ResizeObserver(reposition);
    if (popRef.current) observer.observe(popRef.current);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("keydown", onEsc);
    document.addEventListener("pointerdown", onDown);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("keydown", onEsc);
      document.removeEventListener("pointerdown", onDown);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [target.anchor, close]);

  const positioned = pos !== null;
  useLayoutEffect(() => {
    if (positioned) popRef.current?.focus({ preventScroll: true });
  }, [target.anchor, positioned]);

  const { word, sourceLang, targetLang, isNew } = target;
  const meaning = owned?.meaningZh || target.meaning;
  const transcription = owned?.phonetic || target.transcription;
  const loading = target.loading && !owned;
  const saved = added || !!owned;

  return createPortal(
    <div className="fixed z-[90] w-max max-w-[calc(100vw-16px)]" style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? undefined : "hidden" }}>
      <div
        ref={popRef}
        role="dialog"
        aria-label={word}
        tabIndex={-1}
        className="anim-popover max-w-[240px] overflow-y-auto overscroll-contain break-words rounded-[12px] border border-black/[0.08] bg-surface px-3 py-2 text-left font-sans text-[13px] font-normal leading-snug outline-none shadow-[0_14px_40px_rgba(46,42,38,0.24)]"
      >
        <div className="flex items-center gap-1.5">
          <span className={cn("min-w-0 select-text text-[13px] font-semibold text-ink", srcFont(sourceLang))}>{word}</span>
          <SpeakButton text={word} lang={sourceLang} size="sm" />
          <button type="button" onClick={() => { close(); target.anchor.focus({ preventScroll: true }); }} aria-label={t("common.close")} className="ml-auto shrink-0 rounded p-1.5 text-ink-faint hover:bg-black/[0.05] hover:text-ink">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        {transcription && (
          <div className="mt-0.5 select-text text-[12px] font-medium text-ink-faint">
            {sourceLang === "zh" || sourceLang === "zh-Hant" ? <Pinyin text={transcription} /> : transcription}
          </div>
        )}
        {loading ? (
          <div className="mt-0.5 flex items-center gap-1.5 text-[13px] text-ink-faint">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("pop.loading")}
          </div>
        ) : (
          meaning && (
            <div className={cn("mt-0.5 select-text text-[13px] leading-snug text-sage-deep", srcFont(targetLang))}>{meaning}</div>
          )
        )}
        {saved ? (
          <div role="status" className="mt-1.5 flex items-center gap-1 text-[12px] font-medium text-sage-deep"><Check className="h-3 w-3" />{t("pop.added")}</div>
        ) : isNew && onAdd && deck.isError ? (
          <button type="button" onClick={() => void deck.refetch()} className="mt-1.5 text-[12px] text-ink-muted underline">{t("pop.statusFailed")} {t("errState.retry")}</button>
        ) : isNew && onAdd && (
          <button
            type="button"
            onClick={onAdd}
            disabled={adding || loading || !meaning || !deck.data}
            className="mt-1.5 inline-flex items-center justify-center gap-1 rounded-[8px] bg-sage-tint px-2 py-1.5 text-[12px] font-semibold text-sage-deep transition-colors hover:bg-sage-tint/70 disabled:opacity-60"
          >
            {adding || !deck.data ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            {t("pop.add")}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
