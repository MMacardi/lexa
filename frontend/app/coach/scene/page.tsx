"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isDue, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { getLevel, useTapAnyGloss } from "@/lib/learnPrefs";
import { langLabel } from "@/lib/langs";
import { buildWordMatcher, type WordMatcher } from "@/lib/wordMatch";
import { resolveMeaning } from "@/lib/resolveMeaning";
import { useEnsureLevel } from "@/lib/useEnsureLevel";
import { SpeakButton } from "@/components/SpeakButton";
import { SceneReportCard, type SceneCorrection } from "@/components/SceneReportCard";
import { WordMeaningPop, type WordPopTarget } from "@/components/WordMeaningPop";
import { TappableText, type WordEntry } from "@/components/TappableText";
import { PracticeBar } from "@/components/PracticeBar";
import { cn } from "@/lib/utils";
import { Clapperboard, ArrowLeft, Send, Mic, Square, Check, User, Sparkles, Flag, Loader2, RefreshCw, Info, X } from "lucide-react";

type Turn = { role: "user" | "assistant"; content: string };
type PairKey = { source: string; target: string };
type Mission = { word: string; meaning: string };
type Scene = {
  title: string;
  setting: string;
  character: string;
  characterName: string;
  learnerRole: string;
  goal: string;
  briefing: string;
  missionWords: Mission[];
  newWords: Mission[];
  opening: string;
};

// Quick-start scene cards. The image lives in /public/scenes, the label is the
// scene.preset.<id> i18n key, and the `idea` is what we send the model on click.
const PRESETS: { id: string; img: string; idea: string }[] = [
  { id: "bakery", img: "/scenes/bakery.webp", idea: "ordering bread and pastries at a bakery" },
  { id: "cinema", img: "/scenes/cinema.webp", idea: "buying tickets at the cinema and asking about showtimes" },
  { id: "office", img: "/scenes/office.webp", idea: "talking with a coworker about a task at work" },
  { id: "cafe", img: "/scenes/cafe.webp", idea: "meeting a friend for coffee at a café" },
  { id: "travel", img: "/scenes/travel.webp", idea: "checking into a hotel while travelling" },
  { id: "interview", img: "/scenes/interview.webp", idea: "a job interview" },
];

// Recent scene themes, kept client-side so auto-generation stops repeating itself.
const RECENT_KEY = "lexa.sceneRecent";
function readRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}
function pushRecent(theme: string) {
  if (!theme.trim()) return;
  try {
    const next = [theme.trim(), ...readRecent().filter((x) => x !== theme.trim())].slice(0, 6);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

// Map our language code to a BCP-47 tag for the browser's speech recogniser.
function speechLang(src?: string): string {
  const map: Record<string, string> = {
    en: "en-US", ru: "ru-RU", zh: "zh-CN", "zh-Hant": "zh-TW", ja: "ja-JP", ko: "ko-KR",
    es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT", pt: "pt-PT", nl: "nl-NL",
    pl: "pl-PL", tr: "tr-TR", uk: "uk-UA", hi: "hi-IN", ar: "ar-SA",
  };
  return map[src ?? "en"] ?? src ?? "en-US";
}

export default function CoachScenePage() {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const tapAny = useTapAnyGloss();
  const ensureLevel = useEnsureLevel();

  const { data: words } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
    enabled: !!accountId,
  });
  const deck = useMemo(() => words ?? [], [words]);

  // A caller (a collection / "drill weak words") can hand us specific words to build a scene from.
  const [focusIds, setFocusIds] = useState<string[] | null>(null);
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("lexa.coachFocusIds");
      if (raw) {
        setFocusIds(JSON.parse(raw) as string[]);
        sessionStorage.removeItem("lexa.coachFocusIds");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const pairs = useMemo(() => {
    const m = new Map<string, PairKey>();
    for (const w of deck) m.set(`${w.sourceLang}|${w.targetLang}`, { source: w.sourceLang, target: w.targetLang });
    return [...m.values()];
  }, [deck]);

  const [pair, setPair] = useState<PairKey | null>(null);
  useEffect(() => {
    if (pair || deck.length === 0) return;
    if (focusIds && focusIds.length) {
      const first = deck.find((w) => focusIds.includes(w.id));
      if (first) {
        setPair({ source: first.sourceLang, target: first.targetLang });
        return;
      }
    }
    const counts = new Map<string, number>();
    deck.forEach((w) => {
      const k = `${w.sourceLang}|${w.targetLang}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    });
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    if (top) {
      const [source, target] = top.split("|");
      setPair({ source, target });
    }
  }, [deck, focusIds, pair]);

  // Candidate mission words: weak → due → the rest, capped. These are CANDIDATES, not a
  // checklist — the setup keeps only the ones that plausibly belong in the scene, and
  // keeping none is a perfectly good answer (a bakery scene has no use for "camouflage").
  const pairWords = useMemo(
    () => (pair ? deck.filter((w) => w.sourceLang === pair.source && w.targetLang === pair.target) : []),
    [deck, pair],
  );
  const focusSet = useMemo(() => (focusIds?.length ? new Set(focusIds) : null), [focusIds]);
  const poolWords = useMemo(() => {
    const base = focusSet ? pairWords.filter((w) => focusSet.has(w.id)) : pairWords;
    const weak = base.filter((w) => (w.lapses ?? 0) >= 2);
    const due = base.filter(isDue);
    return [...new Map([...weak, ...due, ...base].map((w) => [w.id, w])).values()].slice(0, 24);
  }, [pairWords, focusSet]);
  const weakCount = useMemo(() => poolWords.filter((w) => (w.lapses ?? 0) >= 2).length, [poolWords]);
  const dueCount = useMemo(() => poolWords.filter(isDue).length, [poolWords]);

  // Every word the learner owns in this pair, for the tap-any-word lookup: an owned word
  // that isn't a candidate still resolves locally, with no request.
  const deckByKey = useMemo(() => {
    const m = new Map<string, Word>();
    for (const w of pairWords) m.set(w.word.trim().toLowerCase(), w);
    return m;
  }, [pairWords]);

  const wordPayload = useMemo(() => poolWords.map((w) => ({ word: w.word, meaning: w.meaningZh ?? "" })), [poolWords]);

  // ---- scene session state ----
  const [scene, setScene] = useState<Scene | null>(null);
  const [generating, setGenerating] = useState(false);
  const [started, setStarted] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [used, setUsed] = useState<Set<string>>(new Set());
  const [corrections, setCorrections] = useState<SceneCorrection[]>([]);
  const [reviewedCount, setReviewedCount] = useState(0);
  const gradedRef = useRef<Set<string>>(new Set()); // mission words already graded Good this session
  const scrollRef = useRef<HTMLDivElement>(null);

  // ---- setup steering + in-conversation UI state ----
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [recentThemes, setRecentThemes] = useState<string[]>(() => readRecent());
  const [showContext, setShowContext] = useState(false); // scene-context popover (#skipped briefing)
  const [pop, setPop] = useState<WordPopTarget | null>(null); // tapped-word meaning popover
  const [addingWord, setAddingWord] = useState<string | null>(null);
  const [addedWords, setAddedWords] = useState<Set<string>>(new Set());

  // ---- voice answer via the browser's SpeechRecognition (free, on-device) ----
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const baseInputRef = useRef("");

  const missionStrings = useMemo(() => (scene?.missionWords ?? []).map((w) => w.word), [scene]);
  const missionMatcher = useMemo(() => buildWordMatcher(missionStrings), [missionStrings]);
  // Highlighting covers mission words AND the scene's brand-new words.
  const allWordStrings = useMemo(
    () => [...(scene?.missionWords ?? []).map((w) => w.word), ...(scene?.newWords ?? []).map((w) => w.word)],
    [scene],
  );
  const matcher = useMemo(() => buildWordMatcher(allWordStrings), [allWordStrings]);
  const entries = useMemo(() => {
    const m = new Map<string, WordEntry>();
    for (const w of scene?.missionWords ?? []) m.set(w.word.trim().toLowerCase(), { meaning: w.meaning, isNew: false });
    for (const w of scene?.newWords ?? []) m.set(w.word.trim().toLowerCase(), { meaning: w.meaning, isNew: true });
    return m;
  }, [scene]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy, done]);

  // Client backstop: catch inflected mission-word uses the model may under-report.
  function scanMessage(text: string): string[] {
    if (!missionMatcher.regex) return [];
    const hits: string[] = [];
    for (const p of text.split(missionMatcher.regex)) {
      const canon = p ? missionMatcher.canonical(p) : null;
      if (canon) hits.push(canon.trim().toLowerCase());
    }
    return hits;
  }

  // Grade a canonical mission word Good (3) into FSRS — once per session, best-effort.
  async function gradeUsed(canonicalLower: string) {
    if (gradedRef.current.has(canonicalLower)) return;
    const card = poolWords.find((w) => w.word.trim().toLowerCase() === canonicalLower);
    if (!card) return;
    gradedRef.current.add(canonicalLower);
    setReviewedCount((n) => n + 1);
    try {
      await api.reviewWord(card.id, 3);
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    } catch {
      /* SRS grading is best-effort */
    }
  }

  async function generate() {
    if (!pair || generating) return;
    // Difficulty is never random: if no level is set for this language yet, ask once.
    const { ok } = await ensureLevel(pair.source);
    if (!ok) return;
    setGenerating(true);
    const preset = selectedPreset ? PRESETS.find((p) => p.id === selectedPreset) : null;
    const effectiveIdea = preset ? preset.idea : undefined;
    try {
      const res = await api.coachSceneSetup({
        words: wordPayload,
        sourceLang: pair.source,
        targetLang: pair.target,
        level: getLevel(pair.source) ?? undefined,
        idea: effectiveIdea,
        // Only steer away from recent themes when the learner didn't ask for a specific
        // scene — an explicit pick/preset should always be honoured.
        avoid: effectiveIdea ? undefined : recentThemes,
        telegramId: accountId,
      });
      const next: Scene = { ...res, missionWords: res.missionWords ?? [], newWords: res.newWords ?? [] };
      setScene(next);
      if (next.title) {
        pushRecent(next.title);
        setRecentThemes(readRecent());
      }
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setGenerating(false);
    }
  }

  // Save a word the scene introduced (or one you tapped and glossed) → a card, instantly:
  // the meaning is already known, so no AI enrichment and no tokens.
  async function addNewWord(word: string, meaning: string, sentence?: string) {
    if (!pair || addingWord) return;
    setAddingWord(word);
    try {
      await api.batchAddWords({
        telegramId: accountId,
        sourceLang: pair.source,
        targetLang: pair.target,
        items: [{ word, meaning, sentence: sentence?.trim() || undefined }],
        source: "Onomika",
        enrich: false,
      });
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      setAddedWords((s) => new Set([...s, word.trim().toLowerCase()]));
      show({ icon: "🌱", title: t("pop.addedToast", { word }) });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setAddingWord(null);
    }
  }

  // Open the meaning popover for a tapped highlight (mission word or new word) — the
  // meaning is already in hand, so this never waits on a request.
  function openWordPop(canonical: string, sentence: string, el: HTMLElement) {
    if (!pair) return;
    const entry = entries.get(canonical.trim().toLowerCase());
    setPop({
      word: canonical,
      meaning: entry?.meaning ?? "",
      isNew: entry?.isNew ?? false,
      sentence,
      sourceLang: pair.source,
      targetLang: pair.target,
      anchor: el,
    });
  }

  // Tap ANY other word in a bubble: an owned word resolves from the deck (no request,
  // nothing to add); anything else opens in a loading state and fills from the gloss
  // cache or one cheap call.
  async function openGlossPop(token: string, sentence: string, el: HTMLElement) {
    if (!pair) return;
    const owned = deckByKey.get(token.trim().toLowerCase());
    if (owned) {
      setPop({
        word: owned.word,
        meaning: owned.meaningZh ?? "",
        transcription: owned.phonetic ?? "",
        isNew: false,
        sentence,
        sourceLang: pair.source,
        targetLang: pair.target,
        anchor: el,
      });
      return;
    }
    setPop({
      word: token,
      meaning: "",
      isNew: true,
      loading: true,
      sentence,
      sourceLang: pair.source,
      targetLang: pair.target,
      anchor: el,
    });
    try {
      const r = await resolveMeaning({ word: token, sentence, sourceLang: pair.source, targetLang: pair.target });
      // Only patch if this exact popover is still open — the learner may have moved on.
      setPop((cur) => (cur && cur.anchor === el ? { ...cur, meaning: r.meaning, transcription: r.transcription, loading: false } : cur));
    } catch {
      setPop((cur) => (cur && cur.anchor === el ? { ...cur, meaning: t("reader.translateFailed"), loading: false, isNew: false } : cur));
    }
  }

  function begin() {
    if (!scene) return;
    setTurns([{ role: "assistant", content: scene.opening }]);
    setUsed(new Set());
    setCorrections([]);
    setReviewedCount(0);
    gradedRef.current = new Set();
    setDone(false);
    setPop(null);
    setShowContext(false);
    setStarted(true);
  }

  function reset() {
    setScene(null);
    setStarted(false);
    setTurns([]);
    setUsed(new Set());
    setCorrections([]);
    setReviewedCount(0);
    gradedRef.current = new Set();
    setDone(false);
    setInput("");
    setPop(null);
    setShowContext(false);
    setAddedWords(new Set());
    setSelectedPreset(null);
  }

  async function sendTurn(history: Turn[], opts: { userText?: string; wrap?: boolean } = {}) {
    if (!pair || !scene) return;
    setBusy(true);
    try {
      const res = await api.coachSceneTurn({
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        scene: {
          title: scene.title,
          setting: scene.setting,
          character: scene.character,
          characterName: scene.characterName,
          learnerRole: scene.learnerRole,
          goal: scene.goal,
          missionWords: scene.missionWords,
          newWords: scene.newWords,
        },
        sourceLang: pair.source,
        targetLang: pair.target,
        level: getLevel(pair.source) ?? undefined,
        wrap: opts.wrap,
        telegramId: accountId,
      });
      const reply: Turn = { role: "assistant", content: res.say };
      setTurns((cur) => [...cur, reply]);

      if (opts.userText) {
        const hits = new Set<string>([
          ...(res.used ?? []).map((w) => w.trim().toLowerCase()),
          ...scanMessage(opts.userText),
        ]);
        const fresh = [...hits].filter((w) => !used.has(w));
        if (fresh.length > 0) {
          setUsed((s) => new Set([...s, ...fresh]));
          for (const w of fresh) void gradeUsed(w);
        }
      }
      if (res.corrections?.length) {
        setCorrections((c) => [...c, ...res.corrections].slice(0, 12));
      }

      if (res.sceneDone || opts.wrap) {
        setDone(true);
        // Fold what happened into Onomika's long-term memory of this learner.
        api.coachRemember({ telegramId: accountId, messages: [...history, reply] }).catch(() => {});
      }
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  async function sendText(text: string) {
    const v = text.trim();
    if (!v || busy || done || !scene || !started) return;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        /* ignore */
      }
    }
    setRecording(false);
    setInterim("");
    const next: Turn[] = [...turns, { role: "user", content: v }];
    setTurns(next);
    setInput("");
    await sendTurn(next, { userText: v });
  }

  async function endScene() {
    if (busy || done || !scene || !started) return;
    await sendTurn(turns, { wrap: true });
  }

  function toggleRecord() {
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SR = typeof window !== "undefined" ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
    if (!SR) {
      show({ icon: "⚠️", title: t("coach.practiceMicUnsupported") });
      return;
    }
    const rec = new SR();
    rec.lang = speechLang(pair?.source);
    rec.interimResults = true;
    rec.continuous = true;
    baseInputRef.current = input.trim();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let finalTxt = "";
      let interimTxt = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalTxt += r[0].transcript;
        else interimTxt += r[0].transcript;
      }
      setInterim(interimTxt);
      const base = baseInputRef.current;
      setInput([base, (finalTxt + interimTxt).trim()].filter(Boolean).join(" "));
    };
    rec.onerror = () => {
      setRecording(false);
      setInterim("");
      show({ icon: "⚠️", title: t("coach.practiceSttFail") });
    };
    rec.onend = () => {
      setRecording(false);
      setInterim("");
    };
    recognitionRef.current = rec;
    try {
      rec.start();
      setRecording(true);
    } catch {
      setRecording(false);
      show({ icon: "⚠️", title: t("coach.practiceMicUnsupported") });
    }
  }

  const srcFontCls = pair && (pair.source === "zh" || pair.source === "zh-Hant" || pair.source === "ja") ? "font-zh" : "";
  // Without a single card there is no language pair to practise in — that is the only
  // real blocker now; an empty candidate pool is fine, the scene runs on new words.
  const hasWords = deck.length > 0;

  return (
    <div className="anim-fade-up mx-auto flex h-[calc(100dvh-140px)] max-w-[720px] flex-col">
      <div className="mb-3">
        <Link href="/coach" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> {t("coach.title")}
        </Link>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 font-serif text-[26px] font-medium tracking-[-0.01em] text-ink">
            <Clapperboard className="h-6 w-6 text-sage-deep" /> {t("scene.heroTitle")}
          </h1>
          {started && !done && (
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowContext((v) => !v)}
                aria-pressed={showContext}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] font-semibold transition-colors",
                  showContext
                    ? "border-sage bg-sage-tint text-sage-deep"
                    : "border-black/[0.1] text-ink-muted hover:border-sage/50",
                )}
              >
                <Info className="h-3.5 w-3.5" /> {t("scene.contextBtn")}
              </button>
              {missionStrings.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sage-tint px-2.5 py-1 text-[13px] font-semibold text-sage-deep">
                  <Check className="h-3.5 w-3.5" /> {used.size}/{missionStrings.length}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ---------- 1. SETUP: pick pair/scope/idea, then generate the scene ---------- */}
      {!scene ? (
        <div className="flex flex-1 flex-col items-center overflow-y-auto rounded-[22px] border border-black/[0.06] bg-surface p-7 py-8 text-center">
          <p className="max-w-[460px] text-[14.5px] leading-relaxed text-ink-soft">{t("scene.heroSub")}</p>

          {!hasWords ? (
            <p className="mt-6 rounded-[12px] border border-dashed border-black/[0.12] bg-paper/50 px-4 py-3 text-[13px] text-ink-soft">
              {t("coach.practiceNoWords")}
            </p>
          ) : (
            <>
              {pairs.length > 1 && (!focusIds || focusIds.length === 0) && (
                <div className="mt-6 w-full max-w-[440px]">
                  <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">{t("coach.practicePairLabel")}</div>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {pairs.map((p) => {
                      const on = pair?.source === p.source && pair?.target === p.target;
                      return (
                        <button
                          key={`${p.source}|${p.target}`}
                          type="button"
                          onClick={() => setPair(p)}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors",
                            on ? "border-sage bg-sage text-white" : "border-black/[0.1] text-ink-muted hover:border-sage/50",
                          )}
                        >
                          {langLabel(p.source)} → {langLabel(p.target)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* A deep-link (from a collection or "drill weak words") is now visible and
                  clearable, since the picker that used to surface it is gone. */}
              {focusSet && poolWords.length > 0 && (
                <div className="mt-5 flex justify-center">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-sage/40 bg-sage-tint/50 py-1 pl-3 pr-1.5 text-[13px] font-semibold text-sage-deep">
                    <Sparkles className="h-3.5 w-3.5" />
                    {t("scene.practisingFocus", { n: String(poolWords.length) })}
                    <button
                      type="button"
                      onClick={() => setFocusIds(null)}
                      aria-label={t("common.cancel")}
                      className="rounded-full p-0.5 transition-colors hover:bg-black/[0.06]"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              )}

              {/* how hard the character talks, and whether every word is tappable */}
              <div className="mt-5">
                <PracticeBar lang={pair?.source ?? "en"} />
              </div>

              {/* quick-start scene presets — all visible at once, tap to select */}
              <div className="mt-5 w-full max-w-[540px]">
                <div className="mb-2 text-center text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
                  {t("scene.presetsLabel")}
                </div>
                <div className="grid grid-cols-2 gap-2.5 px-1 select-none sm:grid-cols-3">
                  {PRESETS.map((p) => {
                    const on = selectedPreset === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSelectedPreset(on ? null : p.id)}
                        aria-pressed={on}
                        className={cn(
                          "rounded-[16px] border bg-surface p-1.5 text-left shadow-sm transition-all duration-200 ease-out",
                          on
                            ? "border-sage ring-2 ring-sage/40 ring-offset-2 ring-offset-surface"
                            : "border-black/[0.08] hover:-translate-y-0.5 hover:shadow-md hover:border-sage/30",
                        )}
                        style={{ WebkitTapHighlightColor: "transparent", WebkitUserSelect: "none" }}
                      >
                        <div className="relative overflow-hidden rounded-[11px]">
                          <Image
                            src={p.img}
                            alt=""
                            width={300}
                            height={200}
                            draggable={false}
                            className="aspect-[3/2] w-full object-cover pointer-events-none select-none"
                          />
                        </div>
                        <div className="mt-1.5 px-0.5 text-[13px] font-semibold leading-tight text-ink">
                          {t(`scene.preset.${p.id}`)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {poolWords.length > 0 ? (
                <p className="mt-5 max-w-[420px] text-[13px] leading-relaxed text-ink-faint">
                  {t("scene.poolHint", { due: String(dueCount), weak: String(weakCount) })}
                </p>
              ) : (
                <p className="mt-5 max-w-[420px] text-[13px] leading-relaxed text-ink-faint">{t("scene.poolHintEmpty")}</p>
              )}
              <button
                type="button"
                onClick={generate}
                disabled={generating}
                className="mt-6 inline-flex items-center gap-2 rounded-full bg-sage px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sage-deep disabled:opacity-50"
              >
                {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
                {generating ? t("common.loading") : t("scene.generate")}
              </button>
            </>
          )}
        </div>
      ) : !started ? (
        /* ---------- 2. BRIEFING: the premise card the learner reads, then "Begin" ---------- */
        <div className="flex flex-1 flex-col overflow-y-auto rounded-[22px] border border-sage/25 bg-gradient-to-br from-sage-tint/50 via-surface to-surface p-6 sm:p-8">
          <div className="flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-sage-deep">
            <Clapperboard className="h-4 w-4" /> {t("scene.badge")}
          </div>
          <h2 className="mt-2 font-serif text-[26px] font-semibold leading-tight text-ink">{scene.title}</h2>
          <p className="mt-2 text-[14.5px] leading-relaxed text-ink-soft">{scene.setting}</p>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[16px] border border-black/[0.06] bg-surface/70 p-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("scene.character")}</div>
              <div className="mt-1 text-[14px] font-semibold text-ink">{scene.characterName || scene.character}</div>
              {scene.characterName && scene.character && scene.character !== scene.characterName && (
                <div className="mt-0.5 text-[13px] text-ink-soft">{scene.character}</div>
              )}
            </div>
            <div className="rounded-[16px] border border-black/[0.06] bg-surface/70 p-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("scene.yourRole")}</div>
              <div className="mt-1 text-[14px] text-ink">{scene.learnerRole}</div>
            </div>
          </div>

          <div className="mt-3 rounded-[16px] border border-black/[0.06] bg-surface/70 p-3.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("scene.goal")}</div>
            <div className="mt-1 text-[14px] leading-relaxed text-ink">{scene.goal}</div>
          </div>

          {scene.briefing && (
            <p className="mt-3 flex items-start gap-2 rounded-[14px] border border-sage/25 bg-sage-tint/40 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-soft">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-sage-deep" />
              <span>{scene.briefing}</span>
            </p>
          )}

          {scene.missionWords.length > 0 ? (
            <div className="mt-4">
              <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">{t("scene.missionWords")}</div>
              <div className="flex flex-wrap gap-1.5">
                {scene.missionWords.map((w) => (
                  <span key={w.word} className={cn("rounded-full border border-black/[0.08] bg-surface px-2.5 py-1 text-[13px] text-ink", srcFontCls)}>
                    {w.word}
                    {w.meaning && <span className="ml-1.5 text-ink-faint">{w.meaning}</span>}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 rounded-[14px] border border-black/[0.06] bg-surface/70 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-soft">
              {t("scene.noMission")}
            </p>
          )}

          {scene.newWords.length > 0 && (
            <div className="mt-4">
              <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-warn-text">
                <Sparkles className="h-3.5 w-3.5" /> {t("scene.newWordsLabel")}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {scene.newWords.map((w) => (
                  <span key={w.word} className={cn("rounded-full border border-warn/30 bg-warn-bg px-2.5 py-1 text-[13px] text-warn-text", srcFontCls)}>
                    {w.word}
                    {w.meaning && <span className="ml-1.5 opacity-75">{w.meaning}</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={begin}
              className="inline-flex items-center gap-2 rounded-full bg-sage px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sage-deep"
            >
              <Sparkles className="h-4 w-4" /> {t("scene.begin")}
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] bg-surface px-4 py-2.5 text-sm font-semibold text-ink-muted transition-colors hover:border-sage/50 disabled:opacity-50"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              {t("scene.regenerate")}
            </button>
          </div>
        </div>
      ) : (
        /* ---------- 3. CONVERSATION (+ report card when done) ---------- */
        <>
          {/* difficulty + tap-any-word stay reachable mid-scene */}
          <div className="mb-2 flex justify-end">
            <PracticeBar lang={pair?.source ?? "en"} />
          </div>

          {missionStrings.length > 0 && !done && (
            <div className="mb-3 flex gap-1.5 overflow-x-auto rounded-[16px] border border-black/[0.06] bg-surface px-3 py-2.5">
              {scene.missionWords.map((w) => {
                const hit = used.has(w.word.trim().toLowerCase());
                return (
                  <button
                    key={w.word}
                    type="button"
                    onClick={(e) => openWordPop(w.word, "", e.currentTarget)}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] font-semibold transition-colors",
                      hit ? "border-sage bg-sage text-white" : "border-black/[0.08] bg-paper text-ink-muted hover:border-sage/40",
                      srcFontCls,
                    )}
                  >
                    {hit && <Check className="h-3 w-3" strokeWidth={3} />}
                    {w.word}
                  </button>
                );
              })}
            </div>
          )}

          {showContext && !done && (
            <div className="anim-fade-up mb-3 rounded-[16px] border border-sage/25 bg-sage-tint/30 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="text-[12px] font-semibold uppercase tracking-wide text-sage-deep">{t("scene.contextTitle")}</div>
                <button
                  type="button"
                  onClick={() => setShowContext(false)}
                  aria-label={t("common.cancel")}
                  className="-mr-1 -mt-1 rounded-full p-1 text-ink-faint transition-colors hover:bg-black/[0.05] hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-1.5 font-serif text-[17px] font-semibold text-ink">{scene.title}</div>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{scene.setting}</p>
              <div className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
                <div className="rounded-[12px] bg-surface/70 px-3 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("scene.character")}</span>
                  <div className="mt-0.5 font-semibold text-ink">{scene.characterName || scene.character}</div>
                </div>
                <div className="rounded-[12px] bg-surface/70 px-3 py-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("scene.yourRole")}</span>
                  <div className="mt-0.5 text-ink">{scene.learnerRole}</div>
                </div>
              </div>
              <div className="mt-2 rounded-[12px] bg-surface/70 px-3 py-2 text-[13px]">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("scene.goal")}</span>
                <div className="mt-0.5 leading-relaxed text-ink">{scene.goal}</div>
              </div>
              {scene.missionWords.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {scene.missionWords.map((w) => (
                    <span key={w.word} className={cn("rounded-full border border-black/[0.08] bg-surface px-2 py-0.5 text-[12px] text-ink-muted", srcFontCls)}>
                      {w.word}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto rounded-[22px] border border-black/[0.06] bg-surface p-4 sm:p-5">
            {turns.map((turn, i) => (
              <Bubble
                key={i}
                turn={turn}
                matcher={matcher}
                used={used}
                entries={entries}
                tapAny={tapAny}
                onKnown={openWordPop}
                onUnknown={openGlossPop}
                speakLang={pair?.source ?? "en"}
                characterName={scene.characterName}
              />
            ))}
            {busy && (
              <div className="flex items-center gap-2.5">
                <SceneAvatar />
                <div className="flex items-center gap-1.5 rounded-[16px] rounded-bl-md border border-black/[0.06] bg-paper px-3.5 py-3">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint" />
                </div>
              </div>
            )}
            {done && (
              <SceneReportCard
                missionWords={scene.missionWords}
                used={used}
                corrections={corrections}
                reviewedCount={reviewedCount}
                onPlayAnother={reset}
              />
            )}
          </div>

          {!done && (
            <div className="mt-3">
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy || turns.length === 0}
                  onClick={endScene}
                  className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] px-3 py-1.5 text-[13px] font-semibold text-ink-muted transition-colors hover:border-sage/50 disabled:opacity-40"
                >
                  <Flag className="h-3.5 w-3.5" /> {t("scene.finish")}
                </button>
              </div>
              {recording && (
                <div className="mb-2 flex items-center gap-2.5 rounded-[14px] border border-warn/30 bg-warn-bg/60 px-3.5 py-2.5">
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn-text opacity-60" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-warn-text" />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                    {interim ? interim : <span className="text-ink-faint">{t("coach.practiceRec")}</span>}
                  </span>
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  sendText(input);
                }}
                className="flex items-end gap-2"
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendText(input);
                    }
                  }}
                  rows={1}
                  placeholder={t("scene.input")}
                  disabled={busy}
                  className="max-h-32 min-h-[46px] flex-1 resize-none rounded-[16px] border border-black/[0.08] bg-surface px-4 py-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
                />
                <button
                  type="button"
                  onClick={toggleRecord}
                  disabled={busy}
                  aria-label={t("coach.practiceMic")}
                  className={cn(
                    "flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[16px] border transition-colors disabled:opacity-40",
                    recording ? "border-warn/50 bg-warn-bg text-warn-text" : "border-black/[0.08] bg-surface text-ink-muted hover:border-sage/50 hover:text-sage-deep",
                  )}
                >
                  {recording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
                </button>
                <button
                  type="submit"
                  disabled={busy || !input.trim()}
                  className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[16px] bg-sage text-white transition-colors hover:bg-sage-deep disabled:opacity-40"
                >
                  <Send className="h-5 w-5" />
                </button>
              </form>
            </div>
          )}
        </>
      )}

      {pop && (
        <WordMeaningPop
          target={pop}
          adding={addingWord === pop.word}
          added={addedWords.has(pop.word.trim().toLowerCase())}
          onAdd={pop.isNew ? () => addNewWord(pop.word, pop.meaning ?? "", pop.sentence) : undefined}
          onClose={() => setPop(null)}
        />
      )}
    </div>
  );
}

function SceneAvatar() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-full bg-sage text-white">
      <Clapperboard className="h-[18px] w-[18px]" />
    </span>
  );
}

function Bubble({
  turn,
  matcher,
  used,
  entries,
  tapAny,
  onKnown,
  onUnknown,
  speakLang,
  characterName,
}: {
  turn: Turn;
  matcher: WordMatcher;
  used: Set<string>;
  entries: Map<string, WordEntry>;
  tapAny: boolean;
  onKnown: (canonical: string, sentence: string, el: HTMLElement) => void;
  onUnknown: (token: string, sentence: string, el: HTMLElement) => void;
  speakLang: string;
  characterName?: string;
}) {
  if (turn.role === "user") {
    return (
      <div className="flex items-end justify-end gap-2.5">
        <div className="max-w-[78%] rounded-[16px] rounded-br-md bg-sage px-3.5 py-2.5 text-[15px] leading-relaxed text-white">
          {turn.content}
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-taupe/30 text-ink-muted">
          <User className="h-[17px] w-[17px]" />
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-end justify-start gap-2.5">
      <SceneAvatar />
      <div className="max-w-[82%]">
        {characterName && (
          <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{characterName}</div>
        )}
        <div className="group flex items-end gap-1.5">
          <div className="whitespace-pre-wrap rounded-[16px] rounded-bl-md border border-black/[0.06] bg-paper px-3.5 py-2.5 text-[15px] leading-relaxed text-ink">
            <TappableText
              text={turn.content}
              lang={speakLang}
              matcher={matcher}
              used={used}
              entries={entries}
              tapAny={tapAny}
              onKnown={(canonical, el) => onKnown(canonical, turn.content, el)}
              onUnknown={(token, el) => onUnknown(token, turn.content, el)}
            />
          </div>
          <SpeakButton text={turn.content} lang={speakLang} size="sm" className="opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </div>
    </div>
  );
}
