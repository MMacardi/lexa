"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { ReaderTextTools, SaveModal } from "@/components/ReaderTextTools";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { detectDominantLang, isAiSupported, langLabel, scriptFamily } from "@/lib/langs";
import {
  getReaderSource,
  getShowTranscription,
  hasTranscription,
  pushRecentPair,
  setReaderSource,
  useReaderSource,
  useRecentPairs,
} from "@/lib/learnPrefs";
import { segment, wordKey } from "@/lib/segment";
import { Button } from "@/components/ui/button";
import { LangSelect } from "@/components/LangSelect";
import { HighlightWord } from "@/components/HighlightWord";
import { cn } from "@/lib/utils";
import { ArrowRightLeft, Camera, Save, Languages, X, GripHorizontal } from "lucide-react";

const PAIR_KEY = "lexa.wordPair"; // shared with the Add form so the pair follows you

// Downscale + re-encode a photo before upload, so OCR payloads stay small/fast.
function downscaleImage(file: File, maxDim = 1600, quality = 0.8): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("no canvas"));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("bad image"));
    };
    img.src = url;
  });
}

// Chinese/Japanese read better in the CJK face.
const sourceFont = (lang: string) => (lang === "zh" || lang === "zh-Hant" || lang === "ja" ? "font-zh" : "");

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
  const recentPairs = useRecentPairs();
  const readerSource = useReaderSource();

  const [sourceLang, setSourceLang] = useState("en");
  const [targetLang, setTargetLang] = useState("zh");
  const [swapSpin, setSwapSpin] = useState(false);
  const swapLangs = () => {
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
    setSwapSpin((v) => !v);
  };
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
  const [glossTr, setGlossTr] = useState<string>(""); // transcription (pinyin/romaji)
  const [glossLoading, setGlossLoading] = useState(false);
  const glossCache = useRef<Map<string, { gloss: string; tr: string }>>(new Map());
  const glossKeyRef = useRef<string>("");
  // OCR: scan a photo into the text box
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // known word: short tap → small popup (meaning + add example); long-press → card panel
  const [knownPop, setKnownPop] = useState<{ wordId: string; word: string; meaning: string | null; sentence: string; x: number; y: number } | null>(null);
  const [cardPanel, setCardPanel] = useState<{ wordId: string; sentence: string } | null>(null);
  const [addingExample, setAddingExample] = useState(false);
  // Background AI text generations we're waiting on (poll until ready).
  const [pendingGen, setPendingGen] = useState<string[]>([]);
  const [showSave, setShowSave] = useState(false); // save-text modal in the reading view
  // Draggable word-card panel: offset from its docked position (reset per card).
  const [cardOffset, setCardOffset] = useState({ x: 0, y: 0 });
  const cardDrag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const pressRef = useRef<{ x: number; y: number; moved: boolean; fired: boolean } | null>(null);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Poll background text generations; toast when each is ready (or failed).
  useEffect(() => {
    if (pendingGen.length === 0) return;
    let cancel = false;
    const timer = setInterval(async () => {
      for (const id of pendingGen) {
        try {
          const full = await api.readerText(id, accountId);
          if (cancel) return;
          if (full.status === "ready") {
            setPendingGen((p) => p.filter((x) => x !== id));
            show({ icon: "📄", title: t("reader.genReady"), subtitle: full.title });
          } else if (full.status === "failed") {
            setPendingGen((p) => p.filter((x) => x !== id));
            show({ icon: "⚠️", title: t("reader.genFailed") });
          }
        } catch {
          /* keep polling */
        }
      }
    }, 2500);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [pendingGen, accountId, show, t]);

  function startGen(id: string) {
    setPendingGen((p) => [...p, id]);
    show({ icon: "✨", title: t("reader.genStarted") });
  }

  // Reset the card-panel drag offset whenever a different card opens.
  useEffect(() => {
    setCardOffset({ x: 0, y: 0 });
  }, [cardPanel?.wordId]);

  function startCardDrag(e: React.PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    cardDrag.current = { sx: e.clientX, sy: e.clientY, ox: cardOffset.x, oy: cardOffset.y };
  }
  function moveCardDrag(e: React.PointerEvent) {
    const d = cardDrag.current;
    if (!d) return;
    setCardOffset({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
  }
  function endCardDrag() {
    cardDrag.current = null;
  }

  // Restore the shared pair (Reader needs a concrete source language, not auto).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PAIR_KEY);
      if (raw) {
        const p = JSON.parse(raw) as { sourceLang?: string; targetLang?: string };
        if (p.sourceLang && p.sourceLang !== "auto") setSourceLang(p.sourceLang);
        if (p.targetLang) setTargetLang(p.targetLang);
      }
      // A sentence handed off from a word page ("Open in Reader") — pre-fill it.
      const pre = sessionStorage.getItem("lexa.readerPrefill");
      if (pre) {
        sessionStorage.removeItem("lexa.readerPrefill");
        const p = JSON.parse(pre) as { text?: string; sourceLang?: string; targetLang?: string };
        if (p.text?.trim()) {
          setText(p.text);
          if (p.sourceLang && p.sourceLang !== "auto") setSourceLang(p.sourceLang);
          if (p.targetLang) setTargetLang(p.targetLang);
        }
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
      setGlossText(cached.gloss);
      setGlossTr(cached.tr);
      setGlossLoading(false);
      return;
    }
    setGlossText(null);
    setGlossTr("");
    setGlossLoading(true);
    const wantTr = getShowTranscription() && hasTranscription(sourceLang);
    api
      .gloss({ word: wordText, sentence: wordText, sourceLang, targetLang, withTranscription: wantTr })
      .then((r) => {
        const entry = { gloss: r.gloss, tr: r.transcription ?? "" };
        glossCache.current.set(key, entry);
        if (glossKeyRef.current === key) {
          setGlossText(entry.gloss);
          setGlossTr(entry.tr);
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

  // Dismiss the gloss on scroll / resize / Escape / a tap anywhere. Tapping a
  // word re-opens it (that happens on pointer-up, after this pointer-down clears).
  useEffect(() => {
    if (!gloss) return;
    const close = () => setGloss(null);
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onEsc);
    document.addEventListener("pointerdown", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onEsc);
      document.removeEventListener("pointerdown", close);
    };
  }, [gloss]);

  // Escape closes the known-word popup / card panel.
  useEffect(() => {
    if (!knownPop && !cardPanel) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setKnownPop(null);
        setCardPanel(null);
      }
    };
    window.addEventListener("keydown", onEsc);
    window.addEventListener("scroll", () => setKnownPop(null), true);
    return () => {
      window.removeEventListener("keydown", onEsc);
      window.removeEventListener("scroll", () => setKnownPop(null), true);
    };
  }, [knownPop, cardPanel]);

  // The sentence a token belongs to (for provided example / context).
  function sentenceAround(index: number): string {
    const isBoundary = (s: string) => /[.!?。！？\n]/.test(s);
    let a = index;
    let b = index;
    while (a > 0 && !isBoundary(tokens[a - 1].text)) a--;
    while (b < tokens.length - 1 && !isBoundary(tokens[b].text)) b++;
    return tokens
      .slice(a, b + 1)
      .map((tk) => tk.text)
      .join("")
      .trim();
  }

  // The first sentence in the text that contains a given (normalized) word.
  function sentenceForKey(key: string): string {
    const i = tokens.findIndex((tk) => tk.wordLike && wordKey(tk.text) === key);
    return i >= 0 ? sentenceAround(i) : "";
  }

  // Short tap on a saved word → small popup with its meaning + "add example".
  function openKnownPop(wordId: string, wordText: string, index: number, el: HTMLElement) {
    const w = (words ?? []).find((x) => x.id === wordId);
    const rect = el.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 140, Math.max(140, rect.left + rect.width / 2));
    setKnownPop({
      wordId,
      word: wordText,
      meaning: w?.meaningZh ?? null,
      sentence: sentenceAround(index),
      x,
      y: rect.bottom,
    });
  }

  // Add the tapped sentence as a new example on an existing card (translate first).
  async function addExampleFromSentence(wordId: string, sentence: string) {
    if (addingExample || !sentence.trim()) return;
    const w = (words ?? []).find((x) => x.id === wordId);
    if (!w) return;
    setAddingExample(true);
    try {
      let sentenceZh = "";
      try {
        sentenceZh = (await api.translate({ text: sentence, sourceLang, targetLang })).translation;
      } catch {
        /* keep the example even if translation fails */
      }
      const examples = [
        ...w.examples.map((e) => ({ id: e.id, sentenceEn: e.sentenceEn, sentenceZh: e.sentenceZh, sourceName: e.sourceName })),
        { sentenceEn: sentence, sentenceZh, sourceName: readerSource.trim() || t("reader.sourceDefault") },
      ];
      await api.updateWord(wordId, { examples });
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["word", wordId] });
      show({ icon: "📝", title: t("reader.exampleAdded", { word: w.word }) });
    } catch (e) {
      show({ icon: "⚠️", title: (e as Error).message });
    } finally {
      setAddingExample(false);
      setKnownPop(null);
    }
  }

  function startPress(e: React.PointerEvent, onHold: (() => void) | null) {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pressRef.current = { x: e.clientX, y: e.clientY, moved: false, fired: false };
    clearTimeout(pressTimer.current);
    if (!onHold) return;
    pressTimer.current = setTimeout(() => {
      if (pressRef.current && !pressRef.current.moved) {
        pressRef.current.fired = true;
        onHold();
      }
    }, 380);
  }
  function movePress(e: React.PointerEvent) {
    const p = pressRef.current;
    if (!p) return;
    if (Math.abs(e.clientX - p.x) + Math.abs(e.clientY - p.y) > 10) {
      p.moved = true;
      clearTimeout(pressTimer.current);
    }
  }
  // Runs the tap action only if it was a genuine short tap (not a hold or drag).
  function endPress(onTap: () => void) {
    clearTimeout(pressTimer.current);
    const p = pressRef.current;
    pressRef.current = null;
    if (!p || p.fired || p.moved) return;
    onTap();
  }

  async function addSelected() {
    const keys = Array.from(selected);
    if (keys.length === 0 || busy) return;
    const enrich = isAiSupported(sourceLang);
    setQueueing(true);
    try {
      // Cards are created right away; AI enrichment runs in the background worker,
      // so the user can leave the Reader while their cards fill in.
      const r = await api.batchAddWords({
        telegramId: accountId,
        sourceLang,
        targetLang,
        // carry each word's sentence so the card's example/context comes from the Reader
        items: keys.map((k) => ({ word: k, sentence: sentenceForKey(k) })),
        source: getReaderSource().trim() || t("reader.sourceDefault"),
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

  async function scanPhoto(file: File) {
    if (scanning) return;
    setScanning(true);
    try {
      const dataUrl = await downscaleImage(file);
      const r = await api.ocr({ image: dataUrl, sourceLang });
      const found = r.text.trim();
      if (found) setText((prev) => (prev.trim() ? `${prev}\n${found}` : found));
    } catch (e) {
      show({ icon: "⚠️", title: t("reader.scanFailed"), subtitle: (e as Error).message });
    } finally {
      setScanning(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

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
            <button
              type="button"
              onClick={swapLangs}
              aria-label={t("add.swap")}
              title={t("add.swap")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-black/[0.08] bg-surface text-ink-muted transition-colors hover:border-sage hover:text-sage-deep"
            >
              <ArrowRightLeft className={cn("h-[15px] w-[15px] transition-transform duration-300", swapSpin && "rotate-180")} />
            </button>
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

          {/* where this text is from — used to attribute the example/context of
              words you add from here (defaults to your own text) */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("reader.sourceLabel")}</span>
            <input
              value={readerSource}
              onChange={(e) => setReaderSource(e.target.value)}
              placeholder={t("reader.sourceDefault")}
              className="h-9 min-w-[220px] flex-1 rounded-[12px] border border-black/[0.08] bg-surface px-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
            />
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("reader.placeholder")}
            className={cn(
              "min-h-[220px] w-full resize-y rounded-[14px] border border-black/[0.08] bg-surface p-4 text-[16px] leading-relaxed text-ink placeholder:text-[#b3aa9a] focus:border-sage focus:outline-none sm:min-h-[260px]",
              sourceFont(sourceLang),
            )}
          />

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) scanPhoto(f);
            }}
          />
          {/* primary action */}
          <Button onClick={startReading} disabled={!text.trim()} className="w-full">
            {t("reader.read")}
          </Button>
          {/* secondary tools — one compact chip row */}
          <div className="flex flex-wrap items-center gap-1.5">
            <ReaderTextTools text={text} sourceLang={sourceLang} targetLang={targetLang} onLoad={(c) => setText(c)} onStartGen={startGen} />
            <button
              type="button"
              disabled={scanning}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-black/[0.03] disabled:opacity-50"
            >
              <Camera className="h-3.5 w-3.5" /> {scanning ? t("reader.scanning") : t("reader.scan")}
            </button>
            <button
              type="button"
              onClick={() => setText(SAMPLE[sourceLang] ?? SAMPLE.en)}
              className="rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-black/[0.03]"
            >
              {t("reader.pasteSample")}
            </button>
            {text.trim() && (
              <button
                type="button"
                onClick={() => setText("")}
                className="rounded-full px-3 py-1.5 text-xs font-semibold text-ink-faint transition-colors hover:text-ink-muted"
              >
                {t("reader.clear")}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ---------------- Reading state ----------------
  // Spot an obvious paste/source mismatch (e.g. Russian text while source = English).
  const detectedLang = detectDominantLang(text);
  const langMismatch = detectedLang !== null && scriptFamily(detectedLang) !== scriptFamily(sourceLang);
  const mismatchIsSwap = detectedLang === targetLang; // pair is just backwards

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

        {/* save this text (works before or after translating) */}
        <button
          type="button"
          onClick={() => setShowSave(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
        >
          <Save className="h-3.5 w-3.5" /> {t("reader.save")}
        </button>

        {/* translate whole text */}
        <button
          type="button"
          onClick={translateAll}
          disabled={translating}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03] disabled:opacity-50"
        >
          {!translating && !trReady && <Languages className="h-3.5 w-3.5" />}
          {translating
            ? t("reader.translating")
            : trReady && showTr
              ? t("reader.hideTranslation")
              : trReady
                ? t("reader.showTranslation")
                : t("reader.translate")}
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

      {langMismatch && (
        <div className="anim-fade-up mb-3 flex flex-wrap items-center gap-2 rounded-[14px] border border-warn/40 bg-warn-bg px-3.5 py-2.5 text-[13px] text-warn-text">
          <span>{t("reader.langMismatch", { detected: langLabel(detectedLang!), source: langLabel(sourceLang) })}</span>
          {mismatchIsSwap ? (
            <button
              type="button"
              onClick={swapLangs}
              className="inline-flex items-center gap-1.5 rounded-full bg-warn px-3 py-1 text-xs font-semibold text-white"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" /> {t("add.swap")}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setSourceLang(detectedLang!)}
              className="rounded-full bg-warn px-3 py-1 text-xs font-semibold text-white"
            >
              {t("reader.useAsSource", { lang: langLabel(detectedLang!) })}
            </button>
          )}
        </div>
      )}

      <p className="mb-3 text-[13px] text-ink-faint">
        {t("reader.tapHint")} <span className="opacity-80">{t("reader.holdHint")}</span>
      </p>

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
              // Already saved → tap shows a small popup (meaning + add example);
              // press-and-hold opens the card in a panel (no page switch).
              return (
                <span
                  key={i}
                  role="button"
                  tabIndex={0}
                  onPointerDown={(e) => startPress(e, () => setCardPanel({ wordId: knownId, sentence: sentenceAround(i) }))}
                  onPointerMove={movePress}
                  onPointerUp={(e) => {
                    const el = e.currentTarget;
                    endPress(() => openKnownPop(knownId, tk.text, i, el));
                  }}
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
                onPointerDown={(e) => startPress(e, null)}
                onPointerMove={movePress}
                onPointerUp={(e) => {
                  const el = e.currentTarget;
                  endPress(() => onPick(el));
                }}
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
              {!glossLoading && glossTr && (
                <div className="mt-0.5 text-[12px] font-medium text-ink-faint">{glossTr}</div>
              )}
              <div className={cn("mt-0.5 text-[13px] text-sage-deep", sourceFont(targetLang))}>
                {glossLoading ? t("reader.translating") : glossText}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* known word — short tap popup: meaning + add example from this sentence */}
      {knownPop &&
        createPortal(
          <div className="anim-fade-up fixed z-[90] -translate-x-1/2" style={{ left: knownPop.x, top: knownPop.y + 8 }}>
            <div className="w-[240px] rounded-[14px] border border-black/[0.08] bg-surface p-3 shadow-[0_14px_40px_rgba(46,42,38,0.24)]">
              <div className={cn("text-[14px] font-semibold text-ink", sourceFont(sourceLang))}>{knownPop.word}</div>
              {knownPop.meaning && (
                <div className={cn("mt-0.5 text-[13px] text-sage-deep", sourceFont(targetLang))}>{knownPop.meaning}</div>
              )}
              <div className="mt-2.5 flex flex-col gap-1.5">
                <button
                  type="button"
                  disabled={addingExample || !knownPop.sentence}
                  onClick={() => addExampleFromSentence(knownPop.wordId, knownPop.sentence)}
                  className="rounded-[10px] bg-sage-tint px-2.5 py-1.5 text-left text-[13px] font-semibold text-sage-deep hover:bg-sage-tint/70 disabled:opacity-50"
                >
                  {addingExample ? t("reader.translating") : t("reader.addExample")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCardPanel({ wordId: knownPop.wordId, sentence: knownPop.sentence });
                    setKnownPop(null);
                  }}
                  className="rounded-[10px] px-2.5 py-1.5 text-left text-[13px] font-semibold text-ink-muted hover:bg-black/[0.04]"
                >
                  {t("reader.openCard")}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* known word — press-and-hold: the card in a panel (no page switch) */}
      {cardPanel &&
        (() => {
          const w = (words ?? []).find((x) => x.id === cardPanel.wordId);
          if (!w) return null;
          return createPortal(
            <div
              className="anim-fade-up fixed inset-x-3 bottom-[calc(56px_+_env(safe-area-inset-bottom))] z-[85] md:inset-x-auto md:right-4 md:top-20 md:bottom-auto md:w-[360px]"
              style={{ transform: `translate(${cardOffset.x}px, ${cardOffset.y}px)` }}
            >
              {/* close button pinned to the panel corner — always reachable while scrolling */}
              <button
                type="button"
                onClick={() => setCardPanel(null)}
                aria-label={t("common.cancel")}
                className="absolute right-2.5 top-1.5 z-10 flex h-8 w-8 items-center justify-center rounded-full border border-black/[0.08] bg-surface/90 text-ink-faint shadow-sm backdrop-blur transition-colors hover:bg-black/[0.05] hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
              <div className="overflow-hidden rounded-[18px] border border-black/[0.08] bg-surface shadow-[0_18px_44px_rgba(46,42,38,0.26)]">
                {/* drag handle — grab here to move the card */}
                <div
                  onPointerDown={startCardDrag}
                  onPointerMove={moveCardDrag}
                  onPointerUp={endCardDrag}
                  className="flex cursor-move touch-none select-none items-center justify-center border-b border-black/[0.05] py-1.5 text-ink-faint transition-colors hover:text-ink-muted"
                >
                  <GripHorizontal className="h-4 w-4" />
                </div>
                <div className="max-h-[calc(70vh-2.25rem)] overflow-y-auto p-5">
                <div className="min-w-0 pr-9">
                  <div className={cn("font-serif text-[26px] font-semibold text-ink", sourceFont(w.sourceLang))}>{w.word}</div>
                  {w.phonetic && <div className="text-[15px] text-ink-faint">{w.phonetic}</div>}
                </div>
                {w.partOfSpeech && (
                  <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint">{w.partOfSpeech}</div>
                )}
                {w.meaningZh && (
                  <div className={cn("mt-1.5 text-[18px] font-semibold text-sage-deep", sourceFont(w.targetLang))}>{w.meaningZh}</div>
                )}
                {(w.synonyms.length > 0 || w.antonyms.length > 0 || w.collocations.length > 0) && (
                  <div className="mt-3 space-y-2 border-t border-black/[0.06] pt-3">
                    {([
                      ["synonyms", w.synonyms, "syn"],
                      ["antonyms", w.antonyms, "ant"],
                      ["collocations", w.collocations, "muted"],
                    ] as const).map(([key, items, tone]) =>
                      items.length ? (
                        <div key={key}>
                          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">{t(`field.${key}`)}</span>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            {items.map((it) => (
                              <span
                                key={it}
                                className={cn(
                                  "rounded-full border px-2 py-0.5 text-[12px]",
                                  tone === "syn"
                                    ? "border-sage/40 bg-sage-tint text-sage-deep"
                                    : tone === "ant"
                                      ? "border-warn/40 bg-warn-bg text-warn-text"
                                      : "border-black/[0.08] bg-paper text-ink-muted",
                                )}
                              >
                                {it}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null,
                    )}
                  </div>
                )}
                {w.examples.length > 0 && (
                  <div className="mt-3 space-y-2 border-t border-black/[0.06] pt-3">
                    {w.examples.map((ex) => (
                      <div key={ex.id}>
                        <p className={cn("whitespace-pre-line text-[15px] leading-relaxed text-quote", sourceFont(w.sourceLang))}>
                          <HighlightWord text={ex.sentenceEn} word={w.word} />
                        </p>
                        {ex.sentenceZh && (
                          <p className={cn("mt-0.5 whitespace-pre-line text-[13px] text-ink-soft", sourceFont(w.targetLang))}>
                            {ex.sentenceZh}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {w.notes?.trim() && (
                  <p className="mt-3 whitespace-pre-wrap border-t border-black/[0.06] pt-3 text-[14px] leading-relaxed text-ink-soft">
                    {w.notes}
                  </p>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={addingExample || !cardPanel.sentence}
                    onClick={() => addExampleFromSentence(w.id, cardPanel.sentence)}
                    className="rounded-full bg-sage px-3.5 py-1.5 text-[13px] font-semibold text-white hover:bg-sage-deep disabled:opacity-50"
                  >
                    {addingExample ? t("reader.translating") : t("reader.addExample")}
                  </button>
                  <a
                    href={`/word/${w.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-full border border-black/[0.08] px-3.5 py-1.5 text-[13px] font-semibold text-ink-muted hover:bg-black/[0.03]"
                  >
                    {t("review.openCard")} ↗
                  </a>
                </div>
                </div>
              </div>
            </div>,
            document.body,
          );
        })()}

      {showSave && (
        <SaveModal
          text={text}
          sourceLang={sourceLang}
          targetLang={targetLang}
          onClose={() => setShowSave(false)}
          onSaved={() => setShowSave(false)}
        />
      )}
    </div>
  );
}
