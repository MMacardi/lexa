"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { isAiSupported, langLabel } from "@/lib/langs";
import { getExampleStyle, getLevel, pushRecentPair, useRecentPairs } from "@/lib/learnPrefs";
import { segment, wordKey } from "@/lib/segment";
import { Button } from "@/components/ui/button";
import { LangSelect } from "@/components/LangSelect";
import { cn } from "@/lib/utils";

const PAIR_KEY = "lexa.wordPair"; // shared with the Add form so the pair follows you

// Chinese/Japanese read better in the CJK face.
const sourceFont = (lang: string) => (lang === "zh" || lang === "ja" ? "font-zh" : "");

const SAMPLE: Record<string, string> = {
  en: "The small harbour town wakes slowly. Fishermen mend their nets while gulls wheel overhead, and the smell of salt lingers in the narrow, cobbled streets long after the boats have gone.",
  ru: "Маленький портовый городок просыпается медленно. Рыбаки чинят сети, чайки кружат над головой, а запах соли ещё долго висит в узких мощёных улочках.",
  es: "El pequeño pueblo pesquero despierta despacio. Los pescadores remiendan sus redes mientras las gaviotas giran en lo alto y el olor a sal permanece en las calles estrechas.",
  de: "Die kleine Hafenstadt erwacht langsam. Fischer flicken ihre Netze, Möwen kreisen über den Dächern, und der Geruch von Salz hängt in den engen Gassen.",
  fr: "La petite ville portuaire s’éveille lentement. Les pêcheurs réparent leurs filets tandis que les mouettes tournoient et que l’odeur du sel s’attarde dans les ruelles étroites.",
  zh: "清晨的小城慢慢醒来。渔民在修补渔网，海鸥在头顶盘旋，狭窄的石板街道里久久弥漫着海盐的味道。",
  ja: "小さな港町はゆっくりと目を覚ます。漁師たちは網を繕い、カモメが頭上を旋回し、狭い石畳の路地には潮の匂いが漂っている。",
  ko: "작은 항구 마을이 천천히 깨어난다. 어부들은 그물을 손질하고 갈매기는 머리 위를 맴돌며, 좁은 골목에는 소금 냄새가 오래 남아 있다.",
};

export default function ReaderPage() {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const qc = useQueryClient();
  const { show, trackImport } = useToast();
  const router = useRouter();
  const recentPairs = useRecentPairs();

  const [sourceLang, setSourceLang] = useState("en");
  const [targetLang, setTargetLang] = useState("zh");
  const [ready, setReady] = useState(false);
  const [text, setText] = useState("");
  const [reading, setReading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [queueing, setQueueing] = useState(false);
  // whole-text translation (on-demand; cached for the text it was made from)
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [showTr, setShowTr] = useState(false);
  const translatedFor = useRef<string>("");
  // per-word quick gloss popover (tap a word → its translation)
  const [gloss, setGloss] = useState<{ key: string; word: string; x: number; y: number } | null>(null);
  const [glossText, setGlossText] = useState<string | null>(null);
  const [glossLoading, setGlossLoading] = useState(false);
  const glossCache = useRef<Map<string, string>>(new Map());
  const glossKeyRef = useRef<string>("");

  // Restore the shared pair (Reader needs a concrete source language, not auto).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PAIR_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { sourceLang?: string; targetLang?: string };
        if (p.sourceLang && p.sourceLang !== "auto") setSourceLang(p.sourceLang);
        if (p.targetLang) setTargetLang(p.targetLang);
      }
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(PAIR_KEY, JSON.stringify({ sourceLang, targetLang }));
  }, [ready, sourceLang, targetLang]);

  const { data: words } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
  });

  // Words already saved for this exact pair → key → card id (to link to it).
  const knownMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of words ?? []) {
      if (w.sourceLang === sourceLang && w.targetLang === targetLang) {
        const k = wordKey(w.word);
        if (!m.has(k)) m.set(k, w.id);
      }
    }
    return m;
  }, [words, sourceLang, targetLang]);

  const tokens = useMemo(() => (reading ? segment(text, sourceLang) : []), [reading, text, sourceLang]);

  const { wordCount, newKeys } = useMemo(() => {
    let count = 0;
    const fresh = new Set<string>();
    for (const tk of tokens) {
      if (!tk.wordLike) continue;
      count++;
      const k = wordKey(tk.text);
      if (!knownMap.has(k) && !added.has(k)) fresh.add(k);
    }
    return { wordCount: count, newKeys: fresh };
  }, [tokens, knownMap, added]);

  const busy = queueing;

  function startReading() {
    if (!text.trim()) {
      show({ icon: "📖", title: t("reader.emptyText") });
      return;
    }
    setSelected(new Set());
    setShowTr(false);
    setReading(true);
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Show a quick translation of a single word, anchored under the tapped token.
  function openGloss(key: string, wordText: string, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 140, Math.max(140, rect.left + rect.width / 2));
    setGloss({ key, word: wordText, x, y: rect.bottom });
    glossKeyRef.current = key;
    const cached = glossCache.current.get(key);
    if (cached != null) {
      setGlossText(cached);
      setGlossLoading(false);
      return;
    }
    setGlossText(null);
    setGlossLoading(true);
    api
      .translate({ text: wordText, sourceLang, targetLang })
      .then((r) => {
        glossCache.current.set(key, r.translation);
        if (glossKeyRef.current === key) {
          setGlossText(r.translation);
          setGlossLoading(false);
        }
      })
      .catch(() => {
        if (glossKeyRef.current === key) {
          setGlossText(t("reader.translateFailed"));
          setGlossLoading(false);
        }
      });
  }

  // Dismiss the gloss on scroll / Escape while it's open.
  useEffect(() => {
    if (!gloss) return;
    const close = () => setGloss(null);
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onEsc);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onEsc);
    };
  }, [gloss]);

  async function addSelected() {
    const keys = Array.from(selected);
    if (keys.length === 0 || busy) return;
    const level = getLevel(sourceLang) ?? undefined;
    const style = getExampleStyle();
    const enrich = isAiSupported(sourceLang);
    setQueueing(true);
    try {
      // Cards are created right away; AI enrichment runs in the background worker,
      // so the user can leave the Reader while their cards fill in.
      const r = await api.batchAddWords({
        telegramId: accountId,
        sourceLang,
        targetLang,
        words: keys,
        level,
        exampleStyle: style,
        enrich,
      });
      setAdded((prev) => new Set([...prev, ...keys]));
      setSelected(new Set());
      pushRecentPair(sourceLang, targetLang);
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      // Hand progress off to the persistent background toast (survives navigation).
      if (r.job) {
        trackImport({ jobId: r.job.id, telegramId: accountId, words: keys, total: r.job.total, processed: 0 });
      }
      show({ icon: "📖", title: t("reader.addedToast", { n: r.created }) });
      if (r.skipped > 0) show({ icon: "⚠️", title: t("reader.someFailed", { n: r.skipped }) });
    } catch (e) {
      show({ icon: "⚠️", title: t("reader.someFailed", { n: keys.length }), subtitle: (e as Error).message });
    } finally {
      setQueueing(false);
    }
  }

  async function translateAll() {
    if (translating) return;
    // Already translated this exact text → just toggle the panel.
    if (translation && translatedFor.current === text) {
      setShowTr((s) => !s);
      return;
    }
    setTranslating(true);
    try {
      const r = await api.translate({ text, sourceLang, targetLang });
      setTranslation(r.translation);
      translatedFor.current = text;
      setShowTr(true);
    } catch (e) {
      show({ icon: "⚠️", title: t("reader.translateFailed"), subtitle: (e as Error).message });
    } finally {
      setTranslating(false);
    }
  }

  const trReady = translation !== null && translatedFor.current === text;

  // ---------------- Input state ----------------
  if (!reading) {
    return (
      <div className="mx-auto max-w-[720px] space-y-5">
        <div>
          <h1 className="font-serif text-[28px] font-medium text-ink sm:text-[32px]">{t("reader.title")}</h1>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{t("reader.subtitle")}</p>
        </div>

        <div className="space-y-3 rounded-[20px] border border-black/[0.06] bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
            <LangSelect value={sourceLang} onChange={setSourceLang} />
            <span className="text-ink-faint">→</span>
            <LangSelect value={targetLang} onChange={setTargetLang} />
          </div>

          {recentPairs.filter((p) => !(p.s === sourceLang && p.t === targetLang)).length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {recentPairs
                .filter((p) => !(p.s === sourceLang && p.t === targetLang) && p.s !== "auto")
                .map((p) => (
                  <button
                    key={`${p.s}>${p.t}`}
                    type="button"
                    onClick={() => {
                      setSourceLang(p.s);
                      setTargetLang(p.t);
                    }}
                    className="rounded-full border border-black/[0.08] bg-surface px-2.5 py-1 text-xs font-medium text-ink-muted transition-colors hover:border-sage hover:text-sage-deep"
                  >
                    {langLabel(p.s)} → {langLabel(p.t)}
                  </button>
                ))}
            </div>
          )}

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("reader.placeholder")}
            className={cn(
              "min-h-[220px] w-full resize-y rounded-[14px] border border-black/[0.08] bg-surface p-4 text-[16px] leading-relaxed text-ink placeholder:text-[#b3aa9a] focus:border-sage focus:outline-none sm:min-h-[260px]",
              sourceFont(sourceLang),
            )}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={startReading} disabled={!text.trim()} className="flex-1 sm:flex-none">
              {t("reader.read")}
            </Button>
            <Button
              variant="outline"
              onClick={() => setText(SAMPLE[sourceLang] ?? SAMPLE.en)}
              type="button"
            >
              {t("reader.pasteSample")}
            </Button>
            {text.trim() && (
              <Button variant="ghost" onClick={() => setText("")} type="button">
                {t("reader.clear")}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------------- Reading state ----------------
  return (
    <div className="mx-auto max-w-[720px] pb-28 md:pb-6">
      {/* sticky toolbar */}
      <div className="sticky top-[53px] z-20 -mx-4 mb-3 flex flex-wrap items-center gap-2 border-b border-black/[0.06] bg-paper/95 px-4 py-2.5 backdrop-blur sm:top-0 sm:mx-0 sm:rounded-[14px] sm:border sm:px-4">
        <button
          type="button"
          onClick={() => setReading(false)}
          className="rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
        >
          ← {t("reader.edit")}
        </button>
        <span className="hidden text-xs font-medium text-ink-faint sm:inline">
          {langLabel(sourceLang)} → {langLabel(targetLang)}
        </span>
        <span className="ml-auto text-xs font-medium text-ink-faint">
          {t("reader.wordCount", { n: wordCount })} · {t("reader.newCount", { n: newKeys.size })}
        </span>

        {/* translate whole text */}
        <button
          type="button"
          onClick={translateAll}
          disabled={translating}
          className="rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03] disabled:opacity-50"
        >
          {translating
            ? t("reader.translating")
            : trReady && showTr
              ? t("reader.hideTranslation")
              : trReady
                ? t("reader.showTranslation")
                : `🌐 ${t("reader.translate")}`}
        </button>

        {newKeys.size > 0 && selected.size < newKeys.size && (
          <button
            type="button"
            onClick={() => setSelected(new Set(newKeys))}
            className="rounded-full bg-sage-tint px-3 py-1.5 text-xs font-semibold text-sage-deep hover:bg-sage-tint/70"
          >
            {t("reader.selectAllNew")}
          </button>
        )}
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
          >
            {t("reader.deselectAll")}
          </button>
        )}
      </div>

      <p className="mb-3 text-[13px] text-ink-faint">{t("reader.tapHint")}</p>

      {/* tokenized text (+ optional translation side-by-side) */}
      <div className={cn("grid gap-4", showTr && trReady && "md:grid-cols-2")}>
        <div
          className={cn(
            "select-none whitespace-pre-wrap break-words rounded-[20px] border border-black/[0.06] bg-surface p-5 font-serif text-[19px] leading-[1.9] text-ink sm:p-7 sm:text-[21px]",
            sourceFont(sourceLang),
          )}
        >
          {tokens.map((tk, i) => {
            if (!tk.wordLike) return <span key={i}>{tk.text}</span>;
            const key = wordKey(tk.text);
            const knownId = knownMap.get(key);
            const isAdded = added.has(key);
            const isSel = selected.has(key);
            if (isAdded) {
              return (
                <span key={i} className="rounded-[5px] bg-sage-tint px-0.5 text-sage-deep">
                  {tk.text}
                </span>
              );
            }
            if (knownId) {
              // Already saved → de-emphasized so new words stand out; taps open the card.
              return (
                <span
                  key={i}
                  onClick={() => router.push(`/word/${knownId}`)}
                  className="cursor-pointer rounded-[4px] text-ink-faint underline decoration-ink-faint/30 underline-offset-4 hover:text-sage-deep"
                >
                  {tk.text}
                </span>
              );
            }
            const onPick = (el: HTMLElement) => {
              const wasSelected = selected.has(key);
              toggle(key);
              if (wasSelected) setGloss(null); // deselecting → hide gloss
              else openGloss(key, tk.text, el); // selecting → show quick translation
            };
            return (
              <span
                key={i}
                role="button"
                tabIndex={0}
                onClick={(e) => onPick(e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onPick(e.currentTarget);
                  }
                }}
                className={cn(
                  "cursor-pointer rounded-[5px] px-0.5 transition-colors",
                  isSel ? "bg-sage text-white" : "hover:bg-sage-tint/60",
                )}
              >
                {tk.text}
              </span>
            );
          })}
        </div>

        {showTr && trReady && (
          <div className="rounded-[20px] border border-black/[0.06] bg-paper p-5 sm:p-7">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {t("reader.translationTitle")}
            </div>
            <div className={cn("whitespace-pre-line text-[16px] leading-relaxed text-ink-soft", sourceFont(targetLang))}>
              {translation}
            </div>
          </div>
        )}
      </div>

      {/* sticky add bar (floats above the mobile tab bar) */}
      {(selected.size > 0 || busy) && (
        <div className="fixed inset-x-0 bottom-[calc(56px_+_env(safe-area-inset-bottom))] z-40 px-4 md:bottom-6">
          <div className="mx-auto flex max-w-[720px] items-center gap-3 rounded-full border border-black/[0.08] bg-surface/95 px-4 py-2.5 shadow-[0_14px_40px_rgba(46,42,38,0.24)] backdrop-blur">
            <span className="text-sm font-semibold text-ink">
              {busy ? t("reader.queueing") : t("reader.selectedN", { n: selected.size })}
            </span>
            {!busy && (
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-xs font-semibold text-ink-faint hover:text-ink-muted"
              >
                {t("reader.clearSel")}
              </button>
            )}
            <Button onClick={addSelected} disabled={busy || selected.size === 0} className="ml-auto shrink-0">
              {busy ? "…" : t("reader.addCards", { n: selected.size })}
            </Button>
          </div>
        </div>
      )}

      {/* per-word quick gloss popover */}
      {gloss &&
        createPortal(
          <div
            className="anim-fade-up fixed z-[90] -translate-x-1/2"
            style={{ left: gloss.x, top: gloss.y + 8 }}
          >
            <div className="max-w-[240px] rounded-[12px] border border-black/[0.08] bg-surface px-3 py-2 shadow-[0_14px_40px_rgba(46,42,38,0.24)]">
              <div className={cn("text-[13px] font-semibold text-ink", sourceFont(sourceLang))}>{gloss.word}</div>
              <div className={cn("mt-0.5 text-[13px] text-sage-deep", sourceFont(targetLang))}>
                {glossLoading ? t("reader.translating") : glossText}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
