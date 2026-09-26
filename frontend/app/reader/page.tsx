"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type DictEntry, type HskVersion, type ReaderTextFull } from "@/lib/api";
import { downscaleImage } from "@/lib/image";
import { useAccount } from "@/lib/account";
import { ReaderTextTools, SaveModal } from "@/components/ReaderTextTools";
import { PasteButton } from "@/components/PasteButton";
import { SavedTexts } from "@/components/SavedTexts";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { useToast } from "@/lib/toast";
import { detectDominantLang, isAiSupported, langLabel, scriptFamily } from "@/lib/langs";
import {
  getReaderSource,
  hasTranscription,
  pushRecentPair,
  setReaderSource,
  useReaderSource,
  useRecentPairs,
  useAutoGloss,
  setAutoGloss,
  useRubyAll,
  setRubyAll,
} from "@/lib/learnPrefs";
import { segment, wordKey, type Token } from "@/lib/segment";
import { useIsMobile } from "@/lib/mobileNav";
import { isLocalTr, localTranscribe as libTranscribe } from "@/lib/transcribe";
import { resolveMeaning } from "@/lib/resolveMeaning";
import { dictEntry, isChineseLang, peekDictEntry } from "@/lib/dictEntry";
import { Button } from "@/components/ui/button";
import { PairChip } from "@/components/PairChip";
import { FOCUS } from "@/lib/focus";
import { holdsEnglish } from "@/components/DictMeaningLabel";
import { HoverTip } from "@/components/ui/HoverTip";
import { HighlightWord } from "@/components/HighlightWord";
import { SpeakButton } from "@/components/SpeakButton";
import { speechLang, dictationSupported, startDictation, type DictationController } from "@/lib/dictation";
import { recorderSupported } from "@/lib/record";
import { getShowTextLevel, micBrowserFailed, markMicBrowserFailed } from "@/lib/learnPrefs";
import { ReadAloudCheck } from "@/components/ReadAloudCheck";
import { cn } from "@/lib/utils";
import { ArrowRightLeft, Camera, Check, Mic, Save, Languages, X, GripHorizontal, LocateFixed, Baseline, Loader2, PenLine } from "lucide-react";

const PAIR_KEY = "lexa.wordPair"; // shared with the Add form so the pair follows you

// Where a word popup sits: centred under its word, kept 140px off either edge so
// the 240px card stays on screen, in *document* coordinates. The popup is
// `absolute`, so the page's own scroll carries it with its word (lib/anchor.ts
// has the story: a `fixed` popup re-measured per scroll event slid off its word
// on a fast swipe, and every event re-rendered the whole text).
function popAt(rect: DOMRect) {
  return {
    x: window.scrollX + Math.min(window.innerWidth - 140, Math.max(140, rect.left + rect.width / 2)),
    y: window.scrollY + rect.bottom,
  };
}

// Pinyin mode: an explicit break opportunity before each word, except right after
// an opening bracket or quote (a line mustn't end on one). A browser that finds no
// break between ruby elements sized the text to its longest line and pushed the
// page sideways on an iPhone.
const OPENS_BEFORE = /[“‘「『《〈【（(\[]$/;

// The underline colour of each HSK level (globals.css); spelled out so Tailwind
// sees every class.
const HSK_DECOR: Record<number, string> = {
  1: "decoration-hsk1",
  2: "decoration-hsk2",
  3: "decoration-hsk3",
  4: "decoration-hsk4",
  5: "decoration-hsk5",
  6: "decoration-hsk6",
  7: "decoration-hsk7",
};

// A token the coverage counts: a word with a letter in it — a year or a page
// number is not a word to know. Twin of countsAsWord in backend services/coverage.ts.
const countsAsWord = (tk: Token) => tk.wordLike && /\p{L}/u.test(tk.text);

// Is `b` an edit of `a` (an OCR slip fixed) rather than a different text? Edits
// keep most of the start and the end; a new paste shares almost none of either.
function sameText(a: string, b: string) {
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return p + s >= Math.min(a.length, b.length) * 0.5;
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
  const { accountId, profile } = useAccount();
  const mobile = useIsMobile();
  const { t } = useI18n();
  const qc = useQueryClient();
  const { show, trackImport } = useToast();
  const recentPairs = useRecentPairs();
  const readerSource = useReaderSource();
  const autoGloss = useAutoGloss();
  const rubyAll = useRubyAll();

  const [sourceLang, setSourceLang] = useState("en");
  const [targetLang, setTargetLang] = useState("zh");
  const swapLangs = () => {
    setSourceLang(targetLang);
    setTargetLang(sourceLang);
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
  // Instant capture: CC-CEDICT's pinyin + English, shown the moment a Chinese word
  // is tapped while the contextual gloss (a model call) is still on its way.
  const [glossCedict, setGlossCedict] = useState<DictEntry | null>(null);
  const glossKeyRef = useRef<string>("");
  const glossElRef = useRef<HTMLElement | null>(null); // the tapped word, to follow on scroll
  const glossPopRef = useRef<HTMLDivElement | null>(null); // popup box, to ignore taps inside it
  const [glossClosing, setGlossClosing] = useState(false);
  const glossCloseTimer = useRef<number | null>(null);
  // OCR: scan a photo into the text box
  const [scanning, setScanning] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Dictaphone: live speech-to-text into the text box (lecture mode).
  const [dictating, setDictating] = useState(false);
  const [dictSupported, setDictSupported] = useState(false);
  const [dictInterim, setDictInterim] = useState("");
  const dictRef = useRef<DictationController | null>(null);
  // known word: short tap → small popup (meaning + add example); long-press → card panel
  const [knownPop, setKnownPop] = useState<{ wordId: string; word: string; meaning: string | null; dictMeaning?: boolean; filling?: boolean; sentence: string; x: number; y: number } | null>(null);
  const knownElRef = useRef<HTMLElement | null>(null); // tapped word, to follow on scroll
  const knownPopRef = useRef<HTMLDivElement | null>(null); // popup box, to detect outside taps
  const [knownClosing, setKnownClosing] = useState(false);
  const knownCloseTimer = useRef<number | null>(null);
  const [cardPanel, setCardPanel] = useState<{ wordId: string; sentence: string } | null>(null);
  const [addingExample, setAddingExample] = useState(false);
  // Background AI text generations we're waiting on (poll until ready).
  const [pendingGen, setPendingGen] = useState<string[]>([]);
  const [showSave, setShowSave] = useState(false); // save-text modal in the reading view
  // The saved row the text on screen lives in. Every text is kept the moment it
  // is read (autosave); Save then only renames it or files it in a collection.
  const [savedRow, setSavedRow] = useState<{ id: string; content: string; title: string } | null>(null);
  // Read-aloud practice (server STT — works on mobile and in China, unlike the
  // browser recogniser): toggle + per-sentence scoring panel under the text.
  const [readAloud, setReadAloud] = useState(false);
  const [recOk, setRecOk] = useState(false);
  useEffect(() => setRecOk(recorderSupported()), []);
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

  // Of those, the words the learner knows: a card past FSRS's learning steps, or
  // one they can use — the readiness mark's "recognise". A card still in learning
  // is shown apart and doesn't count as known. Same rule as the saved-text %
  // (backend services/coverage.ts).
  const knownKeys = useMemo(() => {
    const s = new Set<string>();
    for (const w of words ?? []) {
      if (w.sourceLang === sourceLang && w.targetLang === targetLang && (w.canUseAt || (w.state ?? 0) >= 2)) s.add(wordKey(w.word));
    }
    return s;
  }, [words, sourceLang, targetLang]);

  // Chinese boundaries come from the server: ICU (what the browser has) repaired
  // with CC-CEDICT, so 他打了三个 doesn't offer "了三" as one word. The browser's
  // own split shows first and stands in if the request fails.
  const localTokens = useMemo(() => (reading ? segment(text, sourceLang) : []), [reading, text, sourceLang]);
  const { data: dictTokens } = useQuery({
    queryKey: ["segment", text],
    queryFn: () => api.segment(text),
    enabled: reading && (sourceLang === "zh" || sourceLang === "zh-Hant") && text.trim().length > 0,
    staleTime: Infinity,
  });
  const tokens = reading && dictTokens && (sourceLang === "zh" || sourceLang === "zh-Hant") ? dictTokens : localTokens;

  // A word's level on the list the learner targets (HSK 3.0 until they pick),
  // from the server's segmenter; null off both lists and outside Chinese.
  const hskVersion: HskVersion = profile?.hskVersion ?? "3.0";
  const hskTarget = profile?.hskTarget ?? null;
  const hskLevel = (tk: Token) => tk.hsk?.[hskVersion] ?? null;

  // Sentences for read-aloud practice: split on terminal punctuation (incl. CJK),
  // drop empties, cap the panel so it stays scannable. Stable across renders so
  // the panel doesn't reset its scores on every keystroke elsewhere.
  const { sentences: readAloudSentences, hidden: readAloudHidden } = useMemo(() => {
    if (!reading) return { sentences: [] as string[], hidden: 0 };
    const parts = text
      .split(/(?<=[.!?。！？…])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1);
    const list = parts.length ? parts : text.trim() ? [text.trim()] : [];
    return { sentences: list.slice(0, 12), hidden: Math.max(0, list.length - 12) };
  }, [reading, text]);

  // The line over the text: "You know 82% · 14 new, 6 of them for HSK 4". The %
  // is of running words, repeats included (Migaku's comprehension score; the
  // saved-text list counts the same way). "New" is distinct words with no card,
  // and the HSK part counts the ones on the learner's exam list — every level up
  // to the target, since that is what the exam asks.
  const { knownPct, newKeys, newForTarget, levelsHere } = useMemo(() => {
    let total = 0;
    let known = 0;
    const fresh = new Set<string>();
    const forTarget = new Set<string>();
    const levels = new Set<number>();
    for (const tk of tokens) {
      if (!countsAsWord(tk)) continue;
      total++;
      const k = wordKey(tk.text);
      const lvl = tk.hsk?.[hskVersion];
      if (lvl) levels.add(lvl);
      if (knownKeys.has(k)) known++;
      if (!knownMap.has(k) && !added.has(k)) {
        fresh.add(k);
        if (lvl && hskTarget && lvl <= hskTarget) forTarget.add(k);
      }
    }
    return {
      knownPct: total ? Math.round((known / total) * 100) : null,
      newKeys: fresh,
      newForTarget: forTarget.size,
      levelsHere: Array.from(levels).sort((a, b) => a - b),
    };
  }, [tokens, knownMap, knownKeys, added, hskVersion, hskTarget]);

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

  // Live dictation into the text box — on-device Web Speech only (free, live interim
  // text). The clip-based server fallback was removed: every ~3 s clip made the ASR
  // append a period, littering the text, and it burned ASR seconds. Where Web Speech
  // is dead (iOS Safari, mainland China) the button simply isn't offered; a runtime
  // failure sticks lexa.micBrowserFailed so the other mics self-heal to the
  // record-then-STT engine and this button hides.
  function stopDictate() {
    dictRef.current?.stop();
    dictRef.current = null;
    setDictating(false);
    setDictInterim("");
  }

  function toggleDictate() {
    if (dictating) {
      stopDictate();
      return;
    }
    const ctrl = startDictation({
      lang: speechLang(sourceLang),
      base: text,
      onText: setText,
      onInterim: setDictInterim,
      onError: (kind) => {
        dictRef.current = null;
        setDictInterim("");
        setDictating(false);
        if (kind === "fail") {
          // On-device engine died at runtime (China / iOS) → remember, hide the button.
          markMicBrowserFailed();
          setDictSupported(false);
          show({ icon: "⚠️", title: t("reader.micFail") });
          return;
        }
        show({ icon: "⚠️", title: t("reader.micUnsupported") });
      },
      onEnd: () => {
        dictRef.current = null;
        setDictating(false);
        setDictInterim("");
      },
    });
    if (ctrl) {
      dictRef.current = ctrl;
      setDictating(true);
    }
  }

  useEffect(() => setDictSupported(dictationSupported() && !micBrowserFailed()), []);
  // Stop the mic if the reader unmounts mid-recording.
  useEffect(
    () => () => {
      dictRef.current?.stop();
    },
    [],
  );

  // `from`: a text that isn't in the box yet (Paste & read hands it straight over).
  function startReading(from = text) {
    if (!from.trim()) {
      show({ icon: "📖", title: t("reader.emptyText") });
      return;
    }
    if (from !== text) setText(from);
    dictRef.current?.stop(); // leaving the input view — release the mic
    setSelected(new Set());
    setShowTr(false);
    setTextLevel(null); // a freshly pasted text has no level until it's saved
    setOpenText(null); // fresh paste → Save creates a new text, not an update
    setReading(true);
    autosave(from.trim());
  }

  // Keep the text: an edit of the one already saved updates that row, anything
  // else becomes a new one (the server hands back the old row for a text read
  // before, translation and all). A failure costs nothing — Save still works.
  async function autosave(content: string) {
    const prev = savedRow;
    try {
      if (prev && sameText(prev.content, content)) {
        if (prev.content !== content) await api.updateReaderText(prev.id, { telegramId: accountId, content });
        setSavedRow({ ...prev, content });
      } else {
        const saved = await api.saveReaderText({
          telegramId: accountId,
          title: "",
          content,
          autosave: true,
          estimateLevel: getShowTextLevel(),
          sourceLang,
          targetLang,
        });
        setSavedRow({ id: saved.id, content, title: saved.title });
        if (saved.level) setTextLevel(saved.level);
        if (saved.translation && translatedFor.current !== text) {
          setTranslation(saved.translation);
          translatedFor.current = text;
        }
      }
      qc.invalidateQueries({ queryKey: ["reader-texts"] });
    } catch {
      /* not kept this time; the Save button still is */
    }
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
    setSavedRow({ id: full.id, content: full.content, title: full.title });
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
  // `sentence` is the one the token sits in, so the gloss is the sense used there.
  function openGloss(key: string, wordText: string, el: HTMLElement, sentence: string) {
    if (glossCloseTimer.current) window.clearTimeout(glossCloseTimer.current);
    setGlossClosing(false);
    setGloss({ key, word: wordText, ...popAt(el.getBoundingClientRect()) });
    glossKeyRef.current = key;
    glossElRef.current = el;
    // The dictionary answers at once, with no model call: the reading, and the
    // shared default meaning in the learner's language. When the default is
    // settled (one sense, one reading) resolveMeaning stops there; otherwise the
    // model picks the sense this sentence uses and replaces it.
    const zh = isChineseLang(sourceLang);
    setGlossCedict(zh ? (peekDictEntry(wordText, targetLang) ?? null) : null);
    if (zh) {
      void dictEntry(wordText, targetLang).then((e) => {
        if (glossKeyRef.current === key) setGlossCedict(e);
      });
    }
    // Per-token in-memory fast path. resolveMeaning owns the rest of the chain —
    // the cross-session cache, inflight dedupe, local zh/ko transcription and the
    // gloss request — so the Reader no longer carries its own copy of it.
    const cached = glossCache.current.get(key) ?? undefined;
    if (cached != null) {
      setGlossText(cached.gloss);
      setGlossTr(cached.tr);
      setGlossLoading(false);
      return;
    }
    setGlossText(null);
    setGlossTr("");
    setGlossLoading(true);
    resolveMeaning({ word: wordText, sentence, sourceLang, targetLang })
      .then((r) => {
        const entry = { gloss: r.meaning, tr: r.transcription };
        glossCache.current.set(key, entry);
        if (glossKeyRef.current === key) {
          setGlossText(entry.gloss);
          if (entry.tr) setGlossTr(entry.tr);
          setGlossLoading(false);
        }
      })
      .catch(() => {
        if (glossKeyRef.current === key) {
          // No contextual sense, but the default is still a meaning.
          setGlossText(peekDictEntry(wordText, targetLang)?.meaning ?? t("reader.translateFailed"));
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

  // The page's scroll carries the gloss with its word (see popAt); only a resize
  // (rotation, reflow) moves the word from under it. Dismiss on Escape or a tap
  // *outside* the popup. Taps inside stay put so the meaning can be
  // selected/copied, and a swipe that starts on it scrolls the page, card and all.
  const glossOpen = gloss !== null;
  useEffect(() => {
    if (!glossOpen) return;
    const reposition = () => {
      const el = glossElRef.current;
      if (!el?.isConnected) return;
      const at = popAt(el.getBoundingClientRect());
      setGloss((g) => (g ? { ...g, ...at } : g));
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && closeGloss();
    const onDown = (e: PointerEvent) => {
      if (glossPopRef.current?.contains(e.target as Node)) return;
      closeGloss();
    };
    window.addEventListener("resize", reposition);
    window.addEventListener("keydown", onEsc);
    document.addEventListener("pointerdown", onDown);
    return () => {
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

  // Known-word popup: scrolls with its word like the gloss, and closes on a tap
  // anywhere outside the popup itself (its buttons stay clickable).
  const knownOpen = knownPop !== null;
  useEffect(() => {
    if (!knownOpen) return;
    const reposition = () => {
      const el = knownElRef.current;
      if (!el?.isConnected) return;
      const at = popAt(el.getBoundingClientRect());
      setKnownPop((p) => (p ? { ...p, ...at } : p));
    };
    const onDown = (e: PointerEvent) => {
      if (!knownPopRef.current?.contains(e.target as Node)) closeKnown();
    };
    window.addEventListener("resize", reposition);
    document.addEventListener("pointerdown", onDown);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [knownOpen, closeKnown]);

  // Phone: the word panel docks at the bottom (Pleco's reader) — in thumb reach,
  // and fixed to the screen, so a fast scroll has nothing to slide off. It must
  // never cover the line being read: when the tapped word would sit under it the
  // text scrolls up, and a spacer under the text gives the last line room to.
  // Re-checked as the meaning arrives, since that is what makes the panel taller.
  const dockRef = useRef<HTMLDivElement | null>(null);
  const dockOpen = mobile && (gloss !== null || knownPop !== null);
  useEffect(() => {
    if (!dockOpen) return;
    const dock = dockRef.current?.getBoundingClientRect();
    const el = gloss ? glossElRef.current : knownElRef.current;
    if (!dock || !el?.isConnected) return;
    const under = el.getBoundingClientRect().bottom - (dock.top - 16);
    if (under > 0) window.scrollBy({ top: under, behavior: "smooth" });
  }, [dockOpen, gloss, knownPop, glossText, glossCedict]);

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
    setKnownPop({
      wordId,
      word: wordText,
      meaning: w && holdsEnglish(w) ? null : (w?.meaningZh ?? null),
      dictMeaning: w?.dictMeaning,
      filling: Boolean(w && holdsEnglish(w)),
      sentence: sentenceAround(index),
      ...popAt(el.getBoundingClientRect()),
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
      // Kept with the saved text, so opening it again doesn't pay for it twice.
      if (savedRow && savedRow.content === text.trim()) {
        api.updateReaderText(savedRow.id, { telegramId: accountId, translation: r.translation }).catch(() => {});
      }
    } catch (e) {
      show({ icon: "⚠️", title: t("reader.translateFailed"), subtitle: errText(e, t) });
    } finally {
      setTranslating(false);
    }
  }

  const trReady = translation !== null && translatedFor.current === text;

  // Render a word: the highlight (selection/known tint) goes on the base character
  // only, and the transcription floats ABOVE it on the clean page background — so
  // ruby and the green selection never overlap. A word the learner knows gets no
  // pinyin unless they asked for it over every word (Du Chinese's toggle).
  const rtClass = "pb-1 text-[0.5em] font-normal leading-none tracking-tight text-ink-faint";
  const wordNode = (txt: string, highlight: string, known = false) => {
    if (!(rubyOn && rubyMap[txt]) || (known && !rubyAll)) return <span className={highlight}>{txt}</span>;
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
  const breakBefore = (i: number) => (rubyOn && i > 0 && !OPENS_BEFORE.test(tokens[i - 1].text) ? <wbr /> : null);

  // The two word popups' contents, shown under the word or docked (phone), where
  // the type is larger and the panel has its own close button.
  const dockBox =
    "mx-auto max-h-[40vh] w-full max-w-[720px] overflow-y-auto rounded-[18px] border border-black/[0.08] bg-surface px-4 py-3 shadow-[0_14px_40px_rgba(46,42,38,0.24)]";
  const dockClose = (close: () => void) => (
    <button
      type="button"
      onClick={close}
      aria-label={t("common.close")}
      className="ml-auto rounded-md p-1.5 text-ink-faint transition-colors hover:bg-black/[0.05] hover:text-ink"
    >
      <X className="h-4 w-4" />
    </button>
  );
  const glossBody = (docked: boolean) =>
    gloss && (
      <>
        <div className="flex items-center gap-1.5">
          <span className={cn("select-text font-semibold text-ink", docked ? "text-[20px]" : "text-[13px]", sourceFont(sourceLang))}>{gloss.word}</span>
          <SpeakButton text={gloss.word} lang={sourceLang} size="sm" />
          {docked && dockClose(closeGloss)}
        </div>
        {/* The dictionary's reading wins: it is the one its gloss below is
            for (a bare 了 is le, where the pinyin library says liǎo). */}
        {(glossTr && !glossLoading) || glossCedict ? (
          <div className={cn("mt-0.5 select-text font-medium text-ink-faint", docked ? "text-[14px]" : "text-[12px]")}>
            {glossCedict?.phonetic || glossTr}
          </div>
        ) : null}
        {glossCedict && !glossCedict.meaning && (targetLang === "en" || (!glossLoading && (!glossText || glossText === t("reader.translateFailed")))) && (
          <div className={cn("mt-0.5 select-text text-ink-soft", docked ? "text-[14px]" : "text-[12px]")}>
            {glossCedict.gloss}
            <span className="ml-1 text-[10px] font-semibold tracking-[0.04em] text-ink-faint">{t("capture.dictLabel")}</span>
          </div>
        )}
        <div className={cn("mt-0.5 select-text text-sage-deep", docked ? "text-[16px]" : "text-[13px]", sourceFont(targetLang))}>
          {glossLoading ? (glossCedict?.meaning ?? t("reader.translating")) : glossText}
        </div>
        {glossLoading && glossCedict?.meaning && (
          <div className={cn("mt-0.5 text-ink-faint", docked ? "text-[12px]" : "text-[11px]")}>{t("reader.contextPending")}</div>
        )}
      </>
    );
  const knownBody = (docked: boolean) =>
    knownPop && (
      <>
        <div className="flex items-center gap-1.5">
          <span className={cn("select-text font-semibold text-ink", docked ? "text-[20px]" : "text-[14px]", sourceFont(sourceLang))}>
            {knownPop.word}
          </span>
          <SpeakButton text={knownPop.word} lang={sourceLang} size="sm" />
          {docked && dockClose(closeKnown)}
        </div>
        {knownPop.filling && <div className="mt-0.5 text-[12px] text-ink-faint">{t("capture.filling")}</div>}
        {knownPop.meaning && (
          <div className={cn("mt-0.5 select-text text-sage-deep", docked ? "text-[16px]" : "text-[13px]", sourceFont(targetLang))}>
            {knownPop.meaning}
            {knownPop.dictMeaning && (
              <span className="ml-1 text-[10px] font-semibold tracking-[0.04em] text-ink-faint">{t("capture.dictLabel")}</span>
            )}
          </div>
        )}
        <div className={cn("mt-2.5 flex gap-1.5", docked ? "flex-row" : "flex-col")}>
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
      </>
    );

  // One photo or several (a two-page spread picked from the gallery), read in
  // order, each page appended to the box.
  async function scanPhotos(files: File[]) {
    if (scanning || !files.length) return;
    setScanning(true);
    try {
      for (const file of files) {
        const dataUrl = await downscaleImage(file);
        const r = await api.ocr({ image: dataUrl, sourceLang });
        const found = r.text.trim();
        if (found) setText((prev) => (prev.trim() ? `${prev}\n${found}` : found));
      }
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
          {/* The pair stated, not asked; the pickers open from the chip. */}
          <PairChip source={sourceLang} target={targetLang} onSource={setSourceLang} onTarget={setTargetLang} onSwap={swapLangs} />

          {/* Quick switches to other recent pairs: another "which language?" in a
              one-pair app, so hidden while focused (F17); the chip still changes it. */}
          {!FOCUS && recentPairs.filter((p) => !(p.s === sourceLang && p.t === targetLang)).length > 0 && (
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

          {dictating && (
            <div className="anim-fade-up -mt-1 flex items-center gap-2 rounded-[12px] border border-warn/30 bg-warn-bg/60 px-3 py-2 text-[13px] text-ink-soft">
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-warn-text" />
              <span className="min-w-0 flex-1 truncate">
                {dictInterim ? dictInterim : <span className="text-ink-faint">{t("reader.micListening")}</span>}
              </span>
            </div>
          )}

          {/* No `capture`: it sent a phone straight to the camera. Without it iOS
              offers Take Photo / Photo Library / Choose File, and Android its
              camera-or-gallery chooser. */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => scanPhotos(Array.from(e.target.files ?? []))}
          />
          {/* primary action */}
          <Button onClick={() => startReading()} disabled={!text.trim()} className="w-full">
            {t("reader.read")}
          </Button>
          {/* secondary tools — one compact chip row */}
          <div className="flex flex-wrap items-center gap-1.5">
            <PasteButton
              onPaste={(s) => startReading(s)}
              label={t("reader.pasteRead")}
              className="border-sage/40 text-xs text-sage-deep hover:bg-sage-tint/60"
            />
            <ReaderTextTools sourceLang={sourceLang} targetLang={targetLang} onStartGen={startGen} />
            <button
              type="button"
              disabled={scanning}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:bg-black/[0.03] disabled:opacity-50"
            >
              <Camera className="h-3.5 w-3.5" /> {scanning ? t("reader.scanning") : t("reader.scan")}
            </button>
            {dictSupported && (
              <button
                type="button"
                onClick={toggleDictate}
                aria-pressed={dictating}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                  dictating
                    ? "border-warn/40 bg-warn-bg text-warn-text"
                    : "border-black/[0.08] bg-surface text-ink-muted hover:bg-black/[0.03]",
                )}
              >
                {dictating ? (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-warn-text" />
                ) : (
                  <Mic className="h-3.5 w-3.5" />
                )}
                {dictating ? t("reader.micStop") : t("reader.mic")}
              </button>
            )}
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
      <div className="scroll-row sticky top-14 z-20 -mx-4 mb-3 flex flex-wrap items-center gap-2 border-b border-black/[0.06] bg-paper/95 px-4 py-2.5 backdrop-blur sm:top-0 sm:mx-0 sm:rounded-[14px] sm:border sm:px-4">
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

        {/* save this text (works before or after translating) */}
        <button
          type="button"
          onClick={() => setShowSave(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
        >
          {/* Already kept (autosave): the button renames it or files it away. */}
          {savedRow && savedRow.content === text.trim() ? (
            <>
              <Check className="h-3.5 w-3.5 text-sage-deep" /> {t("reader.savedShort")}
            </>
          ) : (
            <>
              <Save className="h-3.5 w-3.5" /> {t("reader.save")}
            </>
          )}
        </button>

        {/* edit the text on screen: back to the input view with THIS text loaded
            (openText kept, so Save updates it instead of creating a duplicate).
            Only meaningful for a saved text — an unsaved paste already keeps its
            text on "back". */}
        {openText && (
          <button
            type="button"
            onClick={() => setReading(false)}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
          >
            <PenLine className="h-3.5 w-3.5" /> {t("reader.edit")}
          </button>
        )}

        {/* auto-translate a word on tap (a per-tap model call) — toggle to save it */}
        <HoverTip title={t("reader.autoGlossHint")} className="inline-flex">
          <button
            type="button"
            onClick={() => setAutoGloss(!autoGloss)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              autoGloss ? "border-sage bg-sage-tint text-sage-deep" : "border-black/[0.08] bg-surface text-ink-muted hover:bg-black/[0.03]",
            )}
          >
            <Languages className="h-3.5 w-3.5" /> {t("reader.autoGloss")}
          </button>
        </HoverTip>

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
        {/* which words carry it: the ones you don't know yet, or all of them */}
        {hasTranscription(sourceLang) && rubyOn && (
          <div role="group" aria-label={t("reader.rubyOver")} className="inline-flex rounded-full border border-black/[0.08] bg-surface p-0.5">
            {([false, true] as const).map((all) => (
              <button
                key={String(all)}
                type="button"
                onClick={() => setRubyAll(all)}
                aria-pressed={rubyAll === all}
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-semibold transition-colors",
                  rubyAll === all ? "bg-sage-tint text-sage-deep" : "text-ink-muted hover:text-ink",
                )}
              >
                {t(all ? "reader.rubyAllWords" : "reader.rubyUnknown")}
              </button>
            ))}
          </div>
        )}

        {/* read-aloud practice: per-sentence pronunciation check via server STT */}
        {recOk && (
          <button
            type="button"
            onClick={() => setReadAloud((v) => !v)}
            aria-pressed={readAloud}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              readAloud ? "border-sage bg-sage-tint text-sage-deep" : "border-black/[0.08] bg-surface text-ink-muted hover:bg-black/[0.03]",
            )}
          >
            <Mic className="h-3.5 w-3.5" /> {t("reader.readAloud")}
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

      {/* how much of it you know, what's new, and the key to the underlines */}
      <div className="mb-3 space-y-1">
        <p className="text-[13px] text-ink-muted">
          {knownPct !== null && (
            <>
              <span title={t("reader.knownPctHint")} className="font-semibold text-ink">
                {t("reader.knowPct", { n: knownPct })}
              </span>
              {" · "}
            </>
          )}
          {t("reader.newCount", { n: newKeys.size })}
          {newForTarget > 0 && hskTarget && `, ${t("reader.newForTarget", { n: newForTarget, level: hskTarget === 7 ? "7–9" : hskTarget })}`}
        </p>
        {(levelsHere.length > 0 || knownMap.size > 0) && (
          <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-medium text-ink-muted">
            {levelsHere.map((n) => (
              <span key={n} className={cn("underline decoration-2 underline-offset-[3px]", HSK_DECOR[n])}>
                {n === 7 ? t("hsk.band79") : t("hsk.level", { n })}
              </span>
            ))}
            {knownMap.size > 0 && (
              <>
                <span className="underline decoration-ink-faint/60 decoration-dashed decoration-2 underline-offset-[3px]">{t("reader.legendLearning")}</span>
                <span className="text-ink-faint">{t("reader.legendKnown")}</span>
              </>
            )}
          </p>
        )}
        <p className="text-[13px] text-ink-faint">
          {t("reader.tapHint")} <span className="opacity-80">{t("reader.holdHint")}</span>
        </p>
      </div>

      {/* tokenized text (+ optional translation side-by-side). Explicit minmax(0)
          columns + min-w-0: a grid column otherwise grows to the text's
          min-content width, which is the longest line when a browser finds no
          break inside the pinyin. */}
      <div className={cn("grid grid-cols-1 gap-4", showTr && trReady && "md:grid-cols-2")}>
        <div
          className={cn(
            "min-w-0 select-none whitespace-pre-wrap break-words rounded-[20px] border border-black/[0.06] bg-surface p-5 font-serif text-[19px] text-ink sm:p-7 sm:text-[21px]",
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
            // Colour = the word's HSK level; line = where the learner stands on it:
            // solid for a word with no card, dashed while its card is in learning,
            // none (and faded) once it is known.
            const lvl = hskLevel(tk);
            const isKnown = knownKeys.has(key);
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
                  {breakBefore(i)}
                  {wordNode(
                    tk.text,
                    cn(
                      "rounded-[5px] underline-offset-4",
                      isAdded
                        ? "bg-sage-tint px-0.5 text-sage-deep"
                        : isKnown
                          ? "text-ink-faint"
                          : cn("underline decoration-dashed decoration-2", lvl ? HSK_DECOR[lvl] : "decoration-ink-faint/60"),
                    ),
                    isKnown,
                  )}
                </span>
              );
            }
            // Added but its card id hasn't resolved yet (enrichment lag) → green.
            if (isAdded) {
              return (
                <span key={i}>
                  {breakBefore(i)}
                  {wordNode(tk.text, "rounded-[5px] bg-sage-tint px-0.5 text-sage-deep")}
                </span>
              );
            }
            const onPick = (el: HTMLElement) => {
              const wasSelected = selected.has(key);
              toggle(key);
              if (wasSelected) setGloss(null); // deselecting → hide gloss
              else if (autoGloss) openGloss(key, tk.text, el, sentenceAround(i)); // selecting → quick translation (opt-in)
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
                {breakBefore(i)}
                {wordNode(
                  tk.text,
                  cn(
                    "rounded-[5px] px-0.5 transition-colors",
                    isSel ? "bg-sage text-white" : "hover:bg-sage-tint/60",
                    !isSel && lvl != null && cn("underline decoration-2 underline-offset-4", HSK_DECOR[lvl]),
                  ),
                )}
              </span>
            );
          })}
        </div>

        {showTr && trReady && (
          <div className="min-w-0 rounded-[20px] border border-black/[0.06] bg-paper p-5 sm:p-7">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {t("reader.translationTitle")}
            </div>
            <div className={cn("whitespace-pre-line text-[16px] leading-relaxed text-ink-soft", sourceFont(targetLang))}>
              {translation}
            </div>
          </div>
        )}
      </div>

      {readAloud && readAloudSentences.length > 0 && (
        <div className="mt-4">
          <ReadAloudCheck sentences={readAloudSentences} lang={sourceLang} hiddenCount={readAloudHidden} />
        </div>
      )}

      {/* Bottom dock, above the mobile tab bar: the add bar, and on a phone the
          tapped word's panel over it (see keepAboveDock). A wider screen keeps
          the popups under their word. */}
      {(dockOpen || selected.size > 0 || busy) && (
        <div ref={dockRef} className="fixed inset-x-0 bottom-[calc(56px_+_env(safe-area-inset-bottom))] z-40 flex flex-col gap-2 px-4 md:bottom-6">
          {dockOpen && gloss && (
            <div ref={glossPopRef} className={cn(dockBox, glossClosing ? "anim-popover-out" : "anim-fade-up")}>
              {glossBody(true)}
            </div>
          )}
          {dockOpen && knownPop && !gloss && (
            <div ref={knownPopRef} className={cn(dockBox, knownClosing ? "anim-popover-out" : "anim-fade-up")}>
              {knownBody(true)}
            </div>
          )}
          {(selected.size > 0 || busy) && (
            <div className="mx-auto flex w-full max-w-[720px] items-center gap-3 rounded-full border border-black/[0.08] bg-surface/95 px-4 py-2.5 shadow-[0_14px_40px_rgba(46,42,38,0.24)] backdrop-blur">
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
          )}
        </div>
      )}

      {/* per-word quick gloss popover (wider screens; a phone docks it) */}
      {gloss &&
        !mobile &&
        createPortal(
          <div className="absolute z-[90] w-max -translate-x-1/2" style={{ left: gloss.x, top: gloss.y + 8 }}>
            <div
              ref={glossPopRef}
              className={cn(
                "max-w-[240px] rounded-[12px] border border-black/[0.08] bg-surface px-3 py-2 shadow-[0_14px_40px_rgba(46,42,38,0.24)]",
                glossClosing ? "anim-popover-out" : "anim-popover",
              )}
            >
              {glossBody(false)}
            </div>
          </div>,
          document.body,
        )}

      {/* known word — short tap popup: meaning + add example from this sentence */}
      {knownPop &&
        !mobile &&
        createPortal(
          <div className="absolute z-[90] w-max -translate-x-1/2" style={{ left: knownPop.x, top: knownPop.y + 8 }}>
            <div
              ref={knownPopRef}
              className={cn(
                "w-[240px] rounded-[14px] border border-black/[0.08] bg-surface p-3 shadow-[0_14px_40px_rgba(46,42,38,0.24)]",
                knownClosing ? "anim-popover-out" : "anim-popover",
              )}
            >
              {knownBody(false)}
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
                    <HoverTip title={t("tutor.resetPos")} className="inline-flex">
                      <button
                        type="button"
                        onClick={() => setCardOffset({ x: 0, y: 0 })}
                        aria-label={t("tutor.resetPos")}
                        className="rounded-md p-1 text-ink-faint transition-colors hover:bg-black/[0.05] hover:text-ink"
                      >
                        <LocateFixed className="h-3.5 w-3.5" />
                      </button>
                    </HoverTip>
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
                  <div className="flex items-center gap-2">
                    <div className={cn("min-w-0 font-serif text-[26px] font-semibold text-ink", sourceFont(w.sourceLang))}>{w.word}</div>
                    <SpeakButton text={w.word} lang={w.sourceLang} size="sm" />
                  </div>
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

      {/* room for the last line to scroll up above a docked word panel */}
      {dockOpen && <div aria-hidden className="h-[40vh]" />}

      {showSave && (
        <SaveModal
          text={text}
          translation={trReady ? translation ?? undefined : undefined}
          clickedWords={Array.from(new Set([...added, ...selected]))}
          sourceLang={sourceLang}
          targetLang={targetLang}
          editId={openText?.id ?? (savedRow?.content === text.trim() ? savedRow.id : undefined)}
          initialTitle={openText?.title ?? (savedRow?.content === text.trim() ? savedRow.title : undefined)}
          initialCollection={openText?.collection ?? ""}
          initialLevel={openText?.level ?? ""}
          onClose={() => setShowSave(false)}
          onSaved={(saved) => {
            if (openText && saved) setOpenText({ ...openText, ...saved });
            if (saved) setSavedRow((r) => (r && r.id === saved.id ? { ...r, title: saved.title } : r));
            setTextLevel(saved?.level ?? textLevel);
            setShowSave(false);
          }}
        />
      )}
    </div>
  );
}
