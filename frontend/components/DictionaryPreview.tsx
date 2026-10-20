"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { dictEntry, isChineseLang, peekDictEntry } from "@/lib/dictEntry";
import { useI18n } from "@/lib/i18n";

// Only the family graph's word preview: reuse dictionary data, without a model call.
export function DictionaryPreview({ word, sourceLang, targetLang, children }: {
  word: string;
  sourceLang: string;
  targetLang: string;
  children: (descriptionId: string | undefined) => ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { data: entry, isFetching } = useQuery({
    queryKey: ["dictionaryPreview", targetLang, word],
    queryFn: () => dictEntry(word, targetLang),
    initialData: () => peekDictEntry(word, targetLang),
    enabled: open && isChineseLang(sourceLang),
    staleTime: Infinity,
  });
  const meaning = entry?.meaning || (targetLang === "en" ? entry?.gloss : null);
  useLayoutEffect(() => {
    if (!open) return;
    const tip = box.current, el = anchor.current;
    if (!tip || !el) return;
    const rect = el.getBoundingClientRect();
    const vv = window.visualViewport;
    const left = vv?.offsetLeft ?? 0, top = vv?.offsetTop ?? 0;
    const width = vv?.width ?? document.documentElement.clientWidth;
    const height = vv?.height ?? window.innerHeight;
    tip.style.maxWidth = `${Math.min(260, width - 16)}px`;
    tip.style.maxHeight = `${height - 16}px`;
    const x = Math.max(left + 8, Math.min(left + width - tip.offsetWidth - 8, rect.left + (rect.width - tip.offsetWidth) / 2));
    const above = rect.top - tip.offsetHeight - 8;
    const y = Math.max(top + 8, Math.min(top + height - tip.offsetHeight - 8, above >= top + 8 ? above : rect.bottom + 8));
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  }, [open, entry, isFetching, t]);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return <span ref={anchor} className="block"
    onPointerEnter={e => { if (e.pointerType === "mouse") setOpen(true); }}
    onPointerLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>
    {children(open ? id : undefined)}
    {open && createPortal(<div ref={box} id={id} role="tooltip"
      className="pointer-events-none fixed z-[95] w-max overflow-hidden break-words rounded-[10px] bg-onyx px-2.5 py-1.5 text-center text-[12px] font-semibold text-white shadow-[0_10px_28px_rgba(0,0,0,0.28)]">
      {entry?.phonetic && <div className="font-pinyin text-white/70">{entry.phonetic}</div>}
      <div className="line-clamp-3">{meaning || (isFetching ? t("pop.loading") : t("pop.noDictionaryMeaning"))}</div>
    </div>, document.body)}
  </span>;
}
