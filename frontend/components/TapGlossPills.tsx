"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { getShowTranscription, hasTranscription } from "@/lib/learnPrefs";
import { isLocalTr, localTranscribe } from "@/lib/transcribe";
import { cn } from "@/lib/utils";

const srcFont = (lang: string) => (lang === "zh" || lang === "zh-Hant" || lang === "ja" ? "font-zh" : "");
const tgtFont = (lang: string) => (lang === "zh" || lang === "zh-Hant" ? "font-zh" : "");

type Pop = { text: string; x: number; y: number };

/**
 * A row of chips (e.g. collocations) where each chip is tappable: a tap fetches a
 * quick gloss — its meaning in the target language, plus a transcription for CJK
 * when that setting is on — and shows it in a small popover, just like the Reader.
 */
export function TapGlossPills({
  label,
  items,
  sourceLang,
  targetLang,
}: {
  label: string;
  items: string[];
  sourceLang: string;
  targetLang: string;
}) {
  const { t } = useI18n();
  const [pop, setPop] = useState<Pop | null>(null);
  const [closing, setClosing] = useState(false);
  const [gloss, setGloss] = useState<string | null>(null);
  const [tr, setTr] = useState("");
  const [loading, setLoading] = useState(false);
  const cache = useRef<Map<string, { gloss: string; tr: string }>>(new Map());
  const keyRef = useRef("");
  const anchorRef = useRef<HTMLElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<number | null>(null);

  // Animate the popover out, then unmount. Kept in a ref-cleared timer so a rapid
  // re-open cancels a pending close.
  const requestClose = useCallback(() => {
    setClosing(true);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setPop(null);
      setClosing(false);
      anchorRef.current = null;
    }, 150);
  }, []);

  const isOpen = pop !== null;

  // While open: follow the anchor on scroll (don't vanish), close on a tap
  // outside the popover, on resize, or on Escape. Taps *inside* the popover are
  // ignored so the meaning stays put long enough to select and copy it.
  useEffect(() => {
    if (!isOpen) return;
    const reposition = () => {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < -40 || rect.top > window.innerHeight + 40) return requestClose();
      const x = Math.min(window.innerWidth - 140, Math.max(140, rect.left + rect.width / 2));
      setPop((p) => (p ? { ...p, x, y: rect.bottom } : p));
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && requestClose();
    const onDown = (e: PointerEvent) => {
      if (popupRef.current?.contains(e.target as Node)) return;
      requestClose();
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", requestClose);
    window.addEventListener("keydown", onEsc);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", requestClose);
      window.removeEventListener("keydown", onEsc);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [isOpen, requestClose]);

  function tap(text: string, el: HTMLElement) {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    setClosing(false);
    anchorRef.current = el;
    const rect = el.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 140, Math.max(140, rect.left + rect.width / 2));
    setPop({ text, x, y: rect.bottom });
    keyRef.current = text;
    const cached = cache.current.get(text);
    if (cached) {
      setGloss(cached.gloss);
      setTr(cached.tr);
      setLoading(false);
      return;
    }
    setGloss(null);
    setTr("");
    setLoading(true);
    const local = isLocalTr(sourceLang);
    const showTr = getShowTranscription() && hasTranscription(sourceLang);
    // Chinese/Korean transcription is computed locally (instant, no model call).
    if (local && showTr) {
      localTranscribe(text, sourceLang).then((p) => {
        if (keyRef.current === text) setTr(p);
      });
    }
    const wantTr = showTr && !local; // only Japanese asks the model
    api
      .gloss({ word: text, sentence: text, sourceLang, targetLang, withTranscription: wantTr })
      .then(async (r) => {
        const tr = local && showTr ? await localTranscribe(text, sourceLang) : r.transcription ?? "";
        const entry = { gloss: r.gloss, tr };
        cache.current.set(text, entry);
        if (keyRef.current === text) {
          setGloss(entry.gloss);
          if (tr) setTr(tr);
          setLoading(false);
        }
      })
      .catch(() => {
        if (keyRef.current === text) {
          setGloss(t("reader.translateFailed"));
          setLoading(false);
        }
      });
  }

  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <button
            key={it}
            type="button"
            // stop the propagation so the document-level dismiss doesn't immediately
            // close the popover we're about to open on this same tap.
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => tap(it, e.currentTarget)}
            className={cn(
              "cursor-pointer rounded-full border border-black/[0.06] bg-sage-tint px-2.5 py-0.5 text-sm text-sage-deep transition-colors hover:border-sage/50 hover:bg-sage-tint/70",
              srcFont(sourceLang),
            )}
          >
            {it}
          </button>
        ))}
      </div>

      {pop &&
        createPortal(
          <div className="fixed z-[90] -translate-x-1/2" style={{ left: pop.x, top: pop.y + 8 }}>
            <div
              ref={popupRef}
              className={cn(
                "max-w-[240px] rounded-[12px] border border-black/[0.08] bg-surface px-3 py-2 shadow-[0_14px_40px_rgba(46,42,38,0.24)]",
                closing ? "anim-popover-out" : "anim-popover",
              )}
            >
              <div className={cn("select-text text-[13px] font-semibold text-ink", srcFont(sourceLang))}>{pop.text}</div>
              {!loading && tr && <div className="mt-0.5 select-text text-[12px] font-medium text-ink-faint">{tr}</div>}
              <div className={cn("mt-0.5 select-text text-[13px] text-sage-deep", tgtFont(targetLang))}>
                {loading ? t("reader.translating") : gloss}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
