"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ReaderTextFull } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { ReaderTextTools, SaveModal } from "@/components/ReaderTextTools";
import { SavedTexts } from "@/components/SavedTexts";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
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
  useAutoGloss,
  setAutoGloss,
} from "@/lib/learnPrefs";
import { segment, wordKey } from "@/lib/segment";
import { isLocalTr, localTranscribe as libTranscribe } from "@/lib/transcribe";
import { getGloss as getCachedGloss, setGloss as setCachedGloss } from "@/lib/glossCache";
import { Button } from "@/components/ui/button";
import { LangSelect } from "@/components/LangSelect";
import { HighlightWord } from "@/components/HighlightWord";
import { cn } from "@/lib/utils";
import { ArrowRightLeft, Camera, Save, Languages, X, GripHorizontal, LocateFixed, Baseline, Loader2 } from "lucide-react";

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
  const autoGloss = useAutoGloss();

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
  const [textLevel, setTextLevel] = useState<string | null>(null); // CEFR of the open saved text
  const [openText, setOpenText] = useState<ReaderTextFull | null>(null); // the saved text being read (for edit-in-place on save)
  // A "open in Reader" hand-off that references a saved text by title (from a card
  // example) — resolved to the full text once the account id is available.
  const [srcPrefill, setSrcPrefill] = useState<{ text: string; sourceLang?: string; targetLang?: string; word?: string; source: string } | null>(null);
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
  const glossElRef = useRef<HTMLElement | null>(null); // the tapped word, to follow on scroll
  const glossPopRef = useRef<HTMLDivElement | null>(null); // popup box, to ignore taps inside it
  const [glossClosing, setGlossClosing] = useState(false);
  const glossCloseTimer = useRef<number | null>(null);
  // OCR: scan a photo into the text box
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // known word: short tap → small popup (meaning + add example); long-press → card panel
  const [knownPop, setKnownPop] = useState<{ wordId: string; word: string; meaning: string | null; sentence: string; x: number; y: number } | null>(null);
  const knownElRef = useRef<HTMLElement | null>(null); // tapped word, to follow on scroll
  const knownPopRef = useRef<HTMLDivElement | null>(null); // popup box, to detect outside taps
  const [knownClosing, setKnownClosing] = useState(false);
  const knownCloseTimer = useRef<number | null>(null);
  const [cardPanel, setCardPanel] = useState<{ wordId: string; sentence: string } | null>(null);
  const [addingExample, setAddingExample] = useState(false);
  // Background AI text generations we're waiting on (poll until ready).
  const [pendingGen, setPendingGen] = useState<string[]>([]);
  const [showSave, setShowSave] = useState(false); // save-text modal in the reading view
  // "pinyin over characters" (ruby) for CJK: one batch call, cached per word.
  const [rubyOn, setRubyOn] = useState(false);
  const [rubyMap, setRubyMap] = useState<Record<string, string>>({});
  const [rubyBusy, setRubyBusy] = useState(false);
  const rubyCache = useRef<Map<string, string>>(new Map());
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
            qc.invalidateQueries({ queryKey: ["reader-texts", accountId] });
            show({ icon: "📄", title: t("reader.genReady"), subtitle: full.title });
          } else if (full.status === "failed") {
            setPendingGen((p) => p.filter((x) => x !== id));
            qc.invalidateQueries({ queryKey: ["reader-texts", accountId] });
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
  }, [pendingGen, accountId, show, t, qc]);

  function startGen(id: string) {
    setPendingGen((p) => [...p, id]);
    qc.invalidateQueries({ queryKey: ["reader-texts", accountId] }); // show the "generating" row at once
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
        const p = JSON.parse(pre) as { text?: string; sourceLang?: string; targetLang?: string; word?: string; source?: string };
        if (p.text?.trim()) {
          if (p.source?.trim()) {
            // Came from an example that belongs to a saved text — try to reopen the
            // FULL text (resolved once the account id is ready), not just the line.
            setSrcPrefill({ text: p.text, sourceLang: p.sourceLang, targetLang: p.targetLang, word: p.word, source: p.source });
          } else {
            setText(p.text);
            if (p.sourceLang && p.sourceLang !== "auto") setSourceLang(p.sourceLang);
            if (p.targetLang) setTargetLang(p.targetLang);
            // Opened for a specific word (from a card's example) → jump straight into
            // reading with that word highlighted.
            if (p.word?.trim()) {
              setReading(true);
              setSelected(new Set([wordKey(p.word.trim())]));
            }
          }
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

  // Resolve an "open in Reader" hand-off that referenced a saved text by title:
  // find that text and open it in full; if it's gone, fall back to the sentence.
  useEffect(() => {
    if (!srcPrefill || !accountId) return;
    let cancel = false;
    (async () => {
      try {
        const texts = await api.readerTexts(accountId);
        const match = texts.find((x) => x.status === "ready" && x.title.trim() === srcPrefill.source.trim());
        if (match) {
          const full = await api.readerText(match.id, accountId);
          if (cancel) return;
          openSavedText(full);
          if (srcPrefill.word?.trim()) setSelected(new Set([wordKey(srcPrefill.word.trim())]));
          if (!cancel) setSrcPrefill(null);
          return;
        }
      } catch {
        /* fall through to the sentence */
      }
      if (cancel) return;
      setText(srcPrefill.text);
      if (srcPrefill.sourceLang && srcPrefill.sourceLang !== "auto") setSourceLang(srcPrefill.sourceLang);
      if (srcPrefill.targetLang) setTargetLang(srcPrefill.targetLang);
      if (srcPrefill.word?.trim()) {
        setReading(true);
        setSelected(new Set([wordKey(srcPrefill.word.trim())]));
      }
      setSrcPrefill(null);
    })();
    return () => {
      cancel = true;
    };
  }, [srcPrefill, accountId]);

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

  // "Pinyin over characters" (ruby). Chinese is transcribed LOCALLY with pinyin-pro
  // (instant, offline, zero tokens); Japanese/Korean use one batched model call,
  // cached per word. Results are cached so re-toggling and repeats are free.
  useEffect(() => {
    if (!rubyOn || !reading || !hasTranscription(sourceLang)) {
      setRubyMap({});
      setRubyBusy(false);
      return;
    }
    const key = (w: string) => `${sourceLang}:${w}`;
    const distinct = Array.from(new Set(tokens.filter((tk) => tk.wordLike).map((tk) => tk.text)));
    const build = () => {
      const m: Record<string, string> = {};
      for (const w of distinct) {
        const v = rubyCache.current.get(key(w));
        if (v) m[w] = v;
      }
      setRubyMap(m);
    };
    let cancel = false;

    // Chinese / Korean → local, instant, no tokens.
    if (isLocalTr(sourceLang)) {
      (async () => {
        for (const w of distinct) {
          if (!rubyCache.current.has(key(w))) await localTranscribe(w);
        }
        if (!cancel) build();
      })();
      return () => {
        cancel = true;
      };
    }

    // Japanese → one batched model call for the missing words.
    build();
    const missing = distinct.filter((w) => !rubyCache.current.has(key(w)));
    if (missing.length === 0) return;
    setRubyBusy(true);
    api
      .transcribe(missing, sourceLang)
      .then((items) => {
        if (cancel) return;
        missing.forEach((w, i) => {
          const v = items[i]?.trim();
          if (v) rubyCache.current.set(key(w), v);
        });
        build();
      })
      .catch(() => {
        /* best-effort */
      })
      .finally(() => {
        if (!cancel) setRubyBusy(false);
      });
    return () => {
      cancel = true;
    };
    // localTranscribe is stable w.r.t. these deps (reads sourceLang + a ref).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rubyOn, reading, sourceLang, tokens]);

  function startReading() {
    if (!text.trim()) {
      show({ icon: "📖", title: t("reader.emptyText") });
      return;
    }
    setSelected(new Set());
    setShowTr(false);
    setTextLevel(null); // a freshly pasted text has no level until it's saved
    setOpenText(null); // fresh paste → Save creates a new text, not an update
    setReading(true);
  }

  // Leave the reading view. A saved text is edited via its own edit modal now, so
  // the back button starts a FRESH, empty input. An unsaved paste is kept in the
  // box so the user can tweak the text they just wrote.
  function leaveReading() {
    if (openText) {
      setText("");
      setTranslation(null);
      translatedFor.current = "";
      setSelected(new Set());
      setAdded(new Set());
      setTextLevel(null);
      setOpenText(null);
      setReaderSource("");
    }
    setReading(false);
  }

  // Open a saved text: restore its content, pair, translation and the words the
  // reader had engaged with, then jump straight into the reading view.
  function openSavedText(full: ReaderTextFull) {
    setText(full.content);
    setTextLevel(full.level ?? null);
    setOpenText(full); // editing this one → Save updates it instead of duplicating
    // Attribute words added from this text to its title (falls back to "Reader").
    if (full.title?.trim()) setReaderSource(full.title.trim());
    if (full.sourceLang && full.sourceLang !== "auto") setSourceLang(full.sourceLang);
    if (full.targetLang) setTargetLang(full.targetLang);
    if (full.translation) {
      setTranslation(full.translation);
      translatedFor.current = full.content;
    } else {
      setTranslation(null);
    }
    setShowTr(false);
    setAdded(new Set(full.clickedWords ?? []));
    setSelected(new Set());
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

  // Languages we can transcribe LOCALLY (offline, no model call): Chinese via
  // pinyin-pro, Korean via es-hangul. Japanese still needs the model (kanji).
  // Local transcription for one word, cached alongside ruby (offline, no tokens).
  async function localTranscribe(word: string): Promise<string> {
    const ck = `${sourceLang}:${word}`;
    const hit = rubyCache.current.get(ck);
    if (hit !== undefined) return hit;
    const v = await libTranscribe(word, sourceLang);
    rubyCache.current.set(ck, v);
    return v;
  }

  // Show a quick translation of a single word, anchored under the tapped token.
  function openGloss(key: string, wordText: string, el: HTMLElement) {
    if (glossCloseTimer.current) window.clearTimeout(glossCloseTimer.current);
    setGlossClosing(false);
    const rect = el.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 140, Math.max(140, rect.left + rect.width / 2));
    setGloss({ key, word: wordText, x, y: rect.bottom });
    glossKeyRef.current = key;
    glossElRef.current = el;
    // In-memory first, then the cross-session localStorage cache (a repeat tap of
    // the same word, even later, costs no model call).
    const cached = glossCache.current.get(key) ?? getCachedGloss(wordText, sourceLang, targetLang) ?? undefined;
    if (cached != null) {
      glossCache.current.set(key, cached);
      setGlossText(cached.gloss);
      setGlossTr(cached.tr);
      setGlossLoading(false);
      return;
    }
    setGlossText(null);
    setGlossTr("");
    setGlossLoading(true);
    const local = isLocalTr(sourceLang);
    const showTr = getShowTranscription() && hasTranscription(sourceLang);
    // Chinese/Korean transcription: computed locally (instant, no model call).
    if (local && showTr) {
      localTranscribe(wordText).then((p) => {
        if (glossKeyRef.current === key) setGlossTr(p);
      });
    }
    // Only ask the model for a transcription for Japanese.
    const wantTr = showTr && !local;
    api
      .gloss({ word: wordText, sentence: wordText, sourceLang, targetLang, withTranscription: wantTr })
      .then((r) => {
        const tr = local ? rubyCache.current.get(`${sourceLang}:${wordText}`) ?? "" : r.transcription ?? "";
        const entry = { gloss: r.gloss, tr };
        glossCache.current.set(key, entry);
        setCachedGloss(wordText, sourceLang, targetLang, entry);
        if (glossKeyRef.current === key) {
          setGlossText(entry.gloss);
          if (tr) setGlossTr(tr);
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

  // Animate the gloss out, then unmount (a re-open cancels a pending close).
  const closeGloss = useCallback(() => {
    setGlossClosing(true);
    if (glossCloseTimer.current) window.clearTimeout(glossCloseTimer.current);
    glossCloseTimer.current = window.setTimeout(() => {
      setGloss(null);
      setGlossClosing(false);
    }, 150);
  }, []);

  // Keep the gloss anchored to its word while scrolling/resizing (instead of
  // vanishing); dismiss on Escape or a tap *outside* the popup. Taps inside stay
  // put so the meaning can be selected/copied. Off-screen → close.
  const glossOpen = gloss !== null;
  useEffect(() => {
    if (!glossOpen) return;
    const reposition = () => {
      const el = glossElRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        closeGloss();
        return;
      }
      const x = Math.min(window.innerWidth - 140, Math.max(140, rect.left + rect.width / 2));
      setGloss((g) => (g ? { ...g, x, y: rect.bottom } : g));
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && closeGloss();
    const onDown = (e: PointerEvent) => {
      if (glossPopRef.current?.contains(e.target as Node)) return;
      closeGloss();
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
  }, [glossOpen, closeGloss]);

  // Animate the known-word popup out, then unmount.
  const closeKnown = useCallback(() => {
    setKnownClosing(true);
    if (knownCloseTimer.current) window.clearTimeout(knownCloseTimer.current);
    knownCloseTimer.current = window.setTimeout(() => {
      setKnownPop(null);
      setKnownClosing(false);
    }, 150);
  }, []);

  // Escape closes the known-word popup / card panel.
  useEffect(() => {
    if (!knownPop && !cardPanel) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeKnown();
        setCardPanel(null);
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [knownPop, cardPanel, closeKnown]);

  // Known-word popup: follow its word while scrolling (don't vanish), and close
  // on a tap anywhere outside the popup itself (its buttons stay clickable).
  const knownOpen = knownPop !== null;
  useEffect(() => {
    if (!knownOpen) return;
    const reposition = () => {
      const el = knownElRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) {
        closeKnown();
        return;
      }
      const x = Math.min(window.innerWidth - 140, Math.max(140, rect.left + rect.width / 2));
      setKnownPop((p) => (p ? { ...p, x, y: rect.bottom } : p));
    };
    const onDown = (e: PointerEvent) => {
      if (!knownPopRef.current?.contains(e.target as Node)) closeKnown();
    };
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [knownOpen, closeKnown]);

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
    if (knownCloseTimer.current) window.clearTimeout(knownCloseTimer.current);
    setKnownClosing(false);
    const w = (words ?? []).find((x) => x.id === wordId);
    knownElRef.current = el;
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
      show({ icon: "⚠️", title: errText(e, t) });
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
      show({ icon: "⚠️", title: t("reader.someFailed", { n: keys.length }), subtitle: errText(e, t) });
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
      show({ icon: "⚠️", title: t("reader.translateFailed"), subtitle: errText(e, t) });
    } finally {
      setTranslating(false);
    }
  }

  const trReady = translation !== null && translatedFor.current === text;

  // Render a word: the highlight (selection/known tint) goes on the base character
  // only, and the transcription floats ABOVE it on the clean page background — so
  // ruby and the green selection never overlap.
  const rtClass = "pb-1 text-[0.5em] font-normal leading-none tracking-tight text-ink-faint";
  const wordNode = (txt: string, highlight: string) => {
    if (!(rubyOn && rubyMap[txt])) return <span className={highlight}>{txt}</span>;
    const chars = Array.from(txt);
    const syllables = rubyMap[txt].split(/\s+/).filter(Boolean);
    // Per-character ruby when the syllables line up 1:1 with the characters: each
    // reading sits centred over its OWN character. A single <rt> spanning the whole
    // word let the browser's ruby-align justify it — spreading "ān" into "a  n" and
    // pushing syllables off-centre. The highlight stays on each base char (never the
    // reading), so the pinyin still floats on the clean page background.
    if (syllables.length === chars.length && chars.length > 1) {
      const flat = highlight.replace(/\brounded-\[5px\]\b/g, "").replace(/\bpx-0\.5\b/g, "");
      return (
        <ruby className="leading-none">
          {chars.map((c, i) => (
            <Fragment key={i}>
              <span className={flat}>{c}</span>
              <rt className={rtClass}>{syllables[i]}</rt>
            </Fragment>
          ))}
        </ruby>
      );
    }
    return (
      <ruby className="leading-none">
        <span className={highlight}>{txt}</span>
        <rt className={rtClass}>{rubyMap[txt]}</rt>
      </ruby>
    );
  };

  async function scanPhoto(file: File) {
    if (scanning) return;
    setScanning(true);
    try {
      const dataUrl = await downscaleImage(file);
      const r = await api.ocr({ image: dataUrl, sourceLang });
      const found = r.text.trim();
      if (found) setText((prev) => (prev.trim() ? `${prev}\n${found}` : found));
    } catch (e) {
      show({ icon: "⚠️", title: t("reader.scanFailed"), subtitle: errText(e, t) });
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
            <ReaderTextTools sourceLang={sourceLang} targetLang={targetLang} onStartGen={startGen} />
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

        <SavedTexts onOpen={openSavedText} />
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
          onClick={leaveReading}
          className="rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
        >
          ← {t(openText ? "reader.back" : "reader.edit")}
        </button>
        <span className="hidden text-xs font-medium text-ink-faint sm:inline">
          {langLabel(sourceLang)} → {langLabel(targetLang)}
        </span>
        {textLevel && (
          <span className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-semibold text-sage-deep">~{textLevel}</span>
        )}
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

        {/* auto-translate a word on tap (a per-tap model call) — toggle to save it */}
        <button
          type="button"
          onClick={() => setAutoGloss(!autoGloss)}
          title={t("reader.autoGlossHint")}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
            autoGloss ? "border-sage bg-sage-tint text-sage-deep" : "border-black/[0.08] bg-surface text-ink-muted hover:bg-black/[0.03]",
          )}
        >
          <Languages className="h-3.5 w-3.5" /> {t("reader.autoGloss")}
        </button>

        {/* pinyin/romaji over the characters (CJK only) */}
        {hasTranscription(sourceLang) && (
          <button
            type="button"
            onClick={() => setRubyOn((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              rubyOn ? "border-sage bg-sage-tint text-sage-deep" : "border-black/[0.08] bg-surface text-ink-muted hover:bg-black/[0.03]",
            )}
          >
            {rubyBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Baseline className="h-3.5 w-3.5" />}
            {rubyBusy ? t("reader.rubyLoading") : t("reader.ruby")}
          </button>
        )}

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
            "select-none whitespace-pre-wrap break-words rounded-[20px] border border-black/[0.06] bg-surface p-5 font-serif text-[19px] text-ink sm:p-7 sm:text-[21px]",
            rubyOn ? "leading-[2.7]" : "leading-[1.9]",
            sourceFont(sourceLang),
          )}
        >
          {tokens.map((tk, i) => {
            if (!tk.wordLike) return <span key={i}>{tk.text}</span>;
            const key = wordKey(tk.text);
            const knownId = knownMap.get(key);
            const isAdded = added.has(key);
            const isSel = selected.has(key);
            // A saved word (including one just added this session) stays clickable:
            // tap = meaning popup, press-and-hold = the card panel. Freshly-added
            // ones keep the green tint so you can see what you just added.
            if (knownId) {
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
                  className="cursor-pointer"
                >
                  {wordNode(
                    tk.text,
                    cn(
                      "rounded-[5px] underline-offset-4",
                      isAdded
                        ? "bg-sage-tint px-0.5 text-sage-deep"
                        : "text-ink-faint underline decoration-ink-faint/30",
                    ),
                  )}
                </span>
              );
            }
            // Added but its card id hasn't resolved yet (enrichment lag) → green.
            if (isAdded) {
              return <span key={i}>{wordNode(tk.text, "rounded-[5px] bg-sage-tint px-0.5 text-sage-deep")}</span>;
            }
            const onPick = (el: HTMLElement) => {
              const wasSelected = selected.has(key);
              toggle(key);
              if (wasSelected) setGloss(null); // deselecting → hide gloss
              else if (autoGloss) openGloss(key, tk.text, el); // selecting → quick translation (opt-in)
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
                className="cursor-pointer"
              >
                {wordNode(
                  tk.text,
                  cn("rounded-[5px] px-0.5 transition-colors", isSel ? "bg-sage text-white" : "hover:bg-sage-tint/60"),
                )}
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
          <div className="fixed z-[90] -translate-x-1/2" style={{ left: gloss.x, top: gloss.y + 8 }}>
            <div
              ref={glossPopRef}
              className={cn(
                "max-w-[240px] rounded-[12px] border border-black/[0.08] bg-surface px-3 py-2 shadow-[0_14px_40px_rgba(46,42,38,0.24)]",
                glossClosing ? "anim-popover-out" : "anim-popover",
              )}
            >
              <div className={cn("select-text text-[13px] font-semibold text-ink", sourceFont(sourceLang))}>{gloss.word}</div>
              {!glossLoading && glossTr && (
                <div className="mt-0.5 select-text text-[12px] font-medium text-ink-faint">{glossTr}</div>
              )}
              <div className={cn("mt-0.5 select-text text-[13px] text-sage-deep", sourceFont(targetLang))}>
                {glossLoading ? t("reader.translating") : glossText}
              </div>
            </div>
          </div>,
          document.body,
        )}

      {/* known word — short tap popup: meaning + add example from this sentence */}
      {knownPop &&
        createPortal(
          <div className="fixed z-[90] -translate-x-1/2" style={{ left: knownPop.x, top: knownPop.y + 8 }}>
            <div
              ref={knownPopRef}
              className={cn(
                "w-[240px] rounded-[14px] border border-black/[0.08] bg-surface p-3 shadow-[0_14px_40px_rgba(46,42,38,0.24)]",
                knownClosing ? "anim-popover-out" : "anim-popover",
              )}
            >
              <div className={cn("select-text text-[14px] font-semibold text-ink", sourceFont(sourceLang))}>{knownPop.word}</div>
              {knownPop.meaning && (
                <div className={cn("mt-0.5 select-text text-[13px] text-sage-deep", sourceFont(targetLang))}>{knownPop.meaning}</div>
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
              className="fixed inset-x-3 bottom-[calc(56px_+_env(safe-area-inset-bottom))] z-[85] md:inset-x-auto md:right-4 md:top-20 md:bottom-auto md:w-[360px]"
              style={{ transform: `translate(${cardOffset.x}px, ${cardOffset.y}px)` }}
            >
              <div className="anim-fade-up overflow-hidden rounded-[18px] border border-black/[0.08] bg-surface shadow-[0_18px_44px_rgba(46,42,38,0.26)]">
                {/* title bar: reset (left) · grip drag handle (center) · close (right) */}
                <div className="relative flex items-center border-b border-black/[0.06] px-2 py-1.5">
                  {(cardOffset.x !== 0 || cardOffset.y !== 0) && (
                    <button
                      type="button"
                      onClick={() => setCardOffset({ x: 0, y: 0 })}
                      aria-label={t("tutor.resetPos")}
                      title={t("tutor.resetPos")}
                      className="rounded-md p-1 text-ink-faint transition-colors hover:bg-black/[0.05] hover:text-ink"
                    >
                      <LocateFixed className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <div
                    onPointerDown={startCardDrag}
                    onPointerMove={moveCardDrag}
                    onPointerUp={endCardDrag}
                    aria-label={t("common.drag")}
                    className="absolute left-1/2 flex -translate-x-1/2 cursor-grab touch-none select-none items-center px-6 py-1 text-ink-faint transition-colors hover:text-ink-muted active:cursor-grabbing"
                  >
                    <GripHorizontal className="h-4 w-4" />
                  </div>
                  <button
                    type="button"
                    onClick={() => setCardPanel(null)}
                    aria-label={t("common.cancel")}
                    className="ml-auto rounded-md p-1 text-ink-faint transition-colors hover:bg-black/[0.05] hover:text-ink"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="max-h-[calc(70vh-2.75rem)] overflow-y-auto p-5">
                <div className="min-w-0">
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
          translation={trReady ? translation ?? undefined : undefined}
          clickedWords={Array.from(new Set([...added, ...selected]))}
          sourceLang={sourceLang}
          targetLang={targetLang}
          editId={openText?.id}
          initialTitle={openText?.title}
          initialCollection={openText?.collection ?? ""}
          initialLevel={openText?.level ?? ""}
          onClose={() => setShowSave(false)}
          onSaved={(saved) => {
            if (openText && saved) setOpenText({ ...openText, ...saved });
            setTextLevel(saved?.level ?? textLevel);
            setShowSave(false);
          }}
        />
      )}
    </div>
  );
}
