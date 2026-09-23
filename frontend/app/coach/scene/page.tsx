"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isDue, type Word, type CoachSceneTurnPayload } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { getLevel, useTapAnyGloss } from "@/lib/learnPrefs";
import { langLabel } from "@/lib/langs";
import { buildWordMatcher, type WordMatcher } from "@/lib/wordMatch";
import { resolveMeaning } from "@/lib/resolveMeaning";
import { useTranscriptions } from "@/lib/transcribe";
import { useEnsureLevel } from "@/lib/useEnsureLevel";
import { SpeakButton } from "@/components/SpeakButton";
import { SceneReportCard, type SceneCorrection } from "@/components/SceneReportCard";
import { SceneHistory } from "@/components/SceneHistory";
import { WordMeaningPop, type WordPopTarget } from "@/components/WordMeaningPop";
import { TappableText, type WordEntry } from "@/components/TappableText";
import { PracticeBar } from "@/components/PracticeBar";
import { useMicInput } from "@/lib/useMicInput";
import { cn } from "@/lib/utils";
import { Clapperboard, ArrowLeft, Send, Mic, Square, Check, Minus, User, Sparkles, Flag, Loader2, RefreshCw, Info, X, ChevronDown, House, Package, Compass, KeyRound, Pill, CarTaxiFront, ReceiptText, PartyPopper, Luggage, Fingerprint, type LucideIcon } from "lucide-react";
import { Collapse } from "@/components/ui/Collapse";

type Turn = {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  // learner-message feedback, filled once the partner's turn returns
  grade?: "ok" | "minor" | "wrong";
  corrections?: SceneCorrection[];
};
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
  twist?: string; // hidden complication; only the model sees it
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
  { id: "market", img: "/scenes/market.webp", idea: "buying fruit and vegetables at an open-air market" },
  { id: "restaurant", img: "/scenes/restaurant.webp", idea: "ordering dinner at a restaurant and asking for the bill" },
  { id: "doctor", img: "/scenes/doctor.webp", idea: "describing symptoms at a doctor's appointment" },
  { id: "gym", img: "/scenes/gym.webp", idea: "asking a trainer for help at the gym" },
  { id: "airport", img: "/scenes/airport.webp", idea: "checking in and asking about a flight at the airport" },
  { id: "hairdresser", img: "/scenes/hairdresser.webp", idea: "asking for a haircut at the hairdresser's" },
];
// Behind "More scenes": no artwork yet, so they render as compact icon chips and the
// photo grid above stays one screen tall.
const EXTRA_PRESETS: { id: string; icon: LucideIcon; idea: string }[] = [
  { id: "neighbour", icon: House, idea: "asking a neighbour to water your plants while you are away" },
  { id: "delivery", icon: Package, idea: "calling a delivery service about a parcel that never arrived" },
  { id: "directions", icon: Compass, idea: "asking a stranger for directions after getting lost in a new city" },
  { id: "flat", icon: KeyRound, idea: "viewing a flat to rent and asking the landlord questions" },
  { id: "pharmacy", icon: Pill, idea: "asking a pharmacist for something for a cold" },
  { id: "taxi", icon: CarTaxiFront, idea: "taking a taxi and chatting with the driver on the way" },
  { id: "returns", icon: ReceiptText, idea: "returning a faulty purchase to a shop" },
  { id: "party", icon: PartyPopper, idea: "small talk with a stranger at a friend's party" },
  { id: "lostLuggage", icon: Luggage, idea: "reporting lost luggage at the airport desk" },
  { id: "detective", icon: Fingerprint, idea: "a detective questions you as the witness of a funny little mystery in your building" },
];
const ALL_PRESETS: { id: string; idea: string }[] = [...PRESETS, ...EXTRA_PRESETS];

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

export default function CoachScenePage() {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const tapAny = useTapAnyGloss();
  const ensureLevel = useEnsureLevel();
  const router = useRouter();
  const params = useSearchParams();

  // Server-side session row (history + resume). A ref, not state: saves are
  // fire-and-forget and nothing renders off the id itself.
  const sessionIdRef = useRef<string | null>(null);
  const lastResumeRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSaveRef = useRef<(() => void) | null>(null); // the debounced save, so it can be flushed early
  const createPendingRef = useRef<Promise<{ id: string }> | null>(null); // in-flight row create

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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Aborts an in-flight streamed reply (unmount, or sending while one is streaming).
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // ---- setup steering + in-conversation UI state ----
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [showMore, setShowMore] = useState(false); // extra presets (no artwork) behind a toggle
  const [recentThemes, setRecentThemes] = useState<string[]>(() => readRecent());
  const [showContext, setShowContext] = useState(false); // scene-context popover (#skipped briefing)
  const [pop, setPop] = useState<WordPopTarget | null>(null); // tapped-word meaning popover
  const [addingWord, setAddingWord] = useState<string | null>(null);
  const [addedWords, setAddedWords] = useState<Set<string>>(new Set());

  // ---- voice answer (auto: browser Web Speech where it works, else server STT) ----
  const mic = useMicInput({
    lang: pair?.source,
    getBase: () => input.trim(),
    onText: (full) => setInput(full),
    onError: (message) => show({ icon: "⚠️", title: message }),
  });

  const missionStrings = useMemo(() => (scene?.missionWords ?? []).map((w) => w.word), [scene]);
  const missionMatcher = useMemo(() => buildWordMatcher(missionStrings), [missionStrings]);
  // Highlighting covers mission words AND the scene's brand-new words.
  const allWordStrings = useMemo(
    () => [...(scene?.missionWords ?? []).map((w) => w.word), ...(scene?.newWords ?? []).map((w) => w.word)],
    [scene],
  );
  // Pinyin / romanization for the word chips — resolved on-device, empty for languages
  // we can't romanize locally or when the learner turned transcriptions off.
  const readings = useTranscriptions(allWordStrings, pair?.source ?? "");
  const matcher = useMemo(() => buildWordMatcher(allWordStrings), [allWordStrings]);
  const entries = useMemo(() => {
    const m = new Map<string, WordEntry>();
    for (const w of scene?.missionWords ?? []) m.set(w.word.trim().toLowerCase(), { meaning: w.meaning, isNew: false });
    for (const w of scene?.newWords ?? []) m.set(w.word.trim().toLowerCase(), { meaning: w.meaning, isNew: true });
    return m;
  }, [scene]);

  // Grow the composer with its text (typed, dictated or cleared after a send), up to max-h.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

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
  // Looked up in the whole pair, not the candidate pool: the pool is re-derived from the
  // deck (a card just graded is no longer due and drops out), and a resumed scene's
  // mission words may never have been in today's pool at all.
  async function gradeUsed(canonicalLower: string) {
    if (gradedRef.current.has(canonicalLower)) return;
    const card = deckByKey.get(canonicalLower);
    if (!card) return;
    gradedRef.current.add(canonicalLower);
    setReviewedCount((n) => n + 1);
    try {
      await api.reviewWord(card.id, 3, "scene");
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
    const preset = selectedPreset ? ALL_PRESETS.find((p) => p.id === selectedPreset) : null;
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
      // Persist for history/resume. Regenerating (from the briefing) refreshes the
      // same row; the first generate of a fresh scene creates one. Fire-and-forget:
      // play must never wait on (or die from) the save.
      // A regenerate that lands before the first create resolved reuses that row
      // instead of creating a second one.
      const sid = sessionIdRef.current ?? (await createPendingRef.current?.then((r) => r.id).catch(() => null)) ?? null;
      if (sid) {
        sessionIdRef.current = sid;
        api.saveSceneSession(sid, { telegramId: accountId, title: next.title, bible: next }).catch(() => {});
      } else {
        const creating = api.createSceneSession({
          telegramId: accountId,
          title: next.title,
          sceneKey: preset?.id,
          sourceLang: pair.source,
          targetLang: pair.target,
          bible: next,
        });
        createPendingRef.current = creating;
        creating
          .then((r) => {
            // Ignore a create that resolves after the learner already left this scene.
            if (createPendingRef.current !== creating) return;
            sessionIdRef.current = r.id;
            qc.invalidateQueries({ queryKey: ["scene-sessions"] });
          })
          .catch(() => {});
      }
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
    flushSave(); // the last turn / "done" status must reach the row before we let go of it
    sessionIdRef.current = null;
    createPendingRef.current = null;
    lastResumeRef.current = null;
    if (params.get("session")) router.replace("/coach/scene");
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

  // Resume from history: ?session=<id> rehydrates the whole play state — the
  // engine is stateless, so the row (bible + turns + used + corrections) IS everything.
  const resumeId = params.get("session");
  useEffect(() => {
    if (!resumeId || !accountId || resumeId === lastResumeRef.current) return;
    lastResumeRef.current = resumeId;
    (async () => {
      try {
        const s = await api.sceneSession(resumeId, accountId);
        const b = s.bible as Scene;
        sessionIdRef.current = s.id;
        setScene({ ...b, missionWords: b.missionWords ?? [], newWords: b.newWords ?? [] });
        // Older rows could hold a half-streamed placeholder; replaying an empty message
        // would fail every later turn, so keep only settled, non-empty turns.
        const saved = ((s.turns ?? []) as Turn[])
          .filter((x) => x.content?.trim())
          .map(({ streaming: _s, ...x }) => x);
        setTurns(saved.length ? saved : b.opening ? [{ role: "assistant", content: b.opening }] : []);
        setUsed(new Set(s.used ?? []));
        gradedRef.current = new Set(s.used ?? []); // already-graded words must not double-count in FSRS
        setCorrections((s.corrections ?? []) as SceneCorrection[]);
        setReviewedCount(s.reviewedCount ?? 0);
        setAddedWords(new Set(s.addedWords ?? []));
        if (s.sourceLang && s.targetLang) setPair({ source: s.sourceLang, target: s.targetLang });
        setDone(s.status === "done");
        setStarted(true);
        setInput("");
        setPop(null);
        setShowContext(false);
      } catch {
        show({ icon: "⚠️", title: t("scene.loadFailed") });
        router.replace("/coach/scene");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId, accountId]);

  // Save after every change, debounced to coalesce rapid updates (streaming deltas).
  // A pending save is flushed — not dropped — when the learner leaves the scene or the
  // page, so the last turn and the "done" status always land. A 404 silently drops the
  // link (row deleted elsewhere); play continues exactly as before.
  function flushSave() {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const run = pendingSaveRef.current;
    pendingSaveRef.current = null;
    run?.();
  }
  useEffect(() => {
    const id = sessionIdRef.current;
    if (!id || !started || !scene) return;
    // Streaming placeholders are transient; persist only settled turns.
    const settled = turns.filter((x) => !x.streaming);
    const run = () => {
      pendingSaveRef.current = null;
      api
        .saveSceneSession(id, {
          telegramId: accountId,
          turns: settled,
          corrections,
          used: [...used],
          addedWords: [...addedWords],
          reviewedCount,
          ...(done ? { status: "done" as const } : {}),
        })
        .then(() => qc.invalidateQueries({ queryKey: ["scene-sessions"] }))
        .catch((e) => {
          if (String((e as Error)?.message ?? "").includes("not found")) sessionIdRef.current = null;
        });
    };
    pendingSaveRef.current = run;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(run, 600);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, used, corrections, reviewedCount, addedWords, done, started, scene, accountId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => flushSave(), []);

  async function sendTurn(history: Turn[], opts: { userText?: string; wrap?: boolean } = {}) {
    if (!pair || !scene) return;
    setBusy(true);
    const payload: CoachSceneTurnPayload = {
      // The engine only reads the last 16 messages, and the endpoint rejects more than 24,
      // so a long scene used to die with a 400 — send just the window it uses.
      messages: history
        .filter((m) => m.content.trim())
        .slice(-16)
        .map((m) => ({ role: m.role, content: m.content })),
      scene: {
        title: scene.title,
        setting: scene.setting,
        character: scene.character,
        characterName: scene.characterName,
        learnerRole: scene.learnerRole,
        goal: scene.goal,
        twist: scene.twist || undefined,
        missionWords: scene.missionWords,
        newWords: scene.newWords,
      },
      sourceLang: pair.source,
      targetLang: pair.target,
      level: getLevel(pair.source) ?? undefined,
      wrap: opts.wrap,
      telegramId: accountId,
    };
    // Streaming placeholder; onDelta fills it live, final replaces it.
    setTurns((cur) => [...cur, { role: "assistant", content: "", streaming: true }]);
    let acc = "";
    const ac = new AbortController();
    abortRef.current = ac;
    const patchStream = () =>
      setTurns((cur) => {
        if (cur.length === 0) return cur;
        const last = cur[cur.length - 1];
        if (!last.streaming) return cur;
        return [...cur.slice(0, -1), { ...last, content: acc }];
      });
    try {
      const res = await api.coachSceneTurnStream(payload, {
        onDelta: (t) => {
          acc += t;
          patchStream();
        },
        signal: ac.signal,
      });
      const reply: Turn = { role: "assistant", content: res.say };
      setTurns((cur) => {
        const last = cur[cur.length - 1];
        if (last?.streaming) return [...cur.slice(0, -1), reply];
        return [...cur, reply];
      });

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
        setCorrections((c) => {
          const seen = new Set(c.map((x) => `${x.original}→${x.corrected}`));
          const fresh = res.corrections.filter((x) => !seen.has(`${x.original}→${x.corrected}`));
          return [...c, ...fresh].slice(0, 12);
        });
      }
      // Inline per-message feedback: grade the learner's own bubble from this turn's
      // corrections (no extra LLM call — they already come back with the reply).
      if (opts.userText) {
        const cs = res.corrections ?? [];
        const grade: Turn["grade"] = cs.length === 0 ? "ok" : cs.some((c) => c.severity === "wrong") ? "wrong" : "minor";
        setTurns((cur) => {
          for (let i = cur.length - 1; i >= 0; i--) {
            if (cur[i].role === "user") {
              const next = [...cur];
              next[i] = { ...next[i], grade, corrections: cs };
              return next;
            }
          }
          return cur;
        });
      }

      if (res.sceneDone || opts.wrap) {
        setDone(true);
        // Fold what happened into Onomika's long-term memory of this learner.
        // The endpoint takes at most 30 non-empty messages; a long scene used to be rejected silently.
        const recap = [...history, reply]
          .filter((m) => m.content.trim())
          .slice(-30)
          .map((m) => ({ role: m.role, content: m.content }));
        api.coachRemember({ telegramId: accountId, sourceLang: pair.source, messages: recap }).catch(() => {});
      }
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      if (acc.trim()) {
        // Keep whatever streamed; skip structured extras for this turn.
        setTurns((cur) => {
          const last = cur[cur.length - 1];
          if (last?.streaming) return [...cur.slice(0, -1), { role: "assistant", content: acc }];
          return cur;
        });
      } else {
        setTurns((cur) => (cur[cur.length - 1]?.streaming ? cur.slice(0, -1) : cur));
        if (!aborted) show({ icon: "⚠️", title: errText(e, t) });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  async function sendText(text: string) {
    const v = text.trim();
    if (!v || busy || done || !scene || !started) return;
    mic.cancel();
    const next: Turn[] = [...turns, { role: "user", content: v }];
    setTurns(next);
    setInput("");
    await sendTurn(next, { userText: v });
  }

  async function endScene() {
    if (busy || done || !scene || !started) return;
    // Nothing said yet: there is nothing to sign off or report on — just step back out,
    // without spending a model call on a goodbye.
    if (!turns.some((x) => x.role === "user")) {
      reset();
      return;
    }
    await sendTurn(turns, { wrap: true });
  }

  const srcFontCls = pair && (pair.source === "zh" || pair.source === "zh-Hant" || pair.source === "ja") ? "font-zh" : "";
  // Without a single card there is no language pair to practise in — that is the only
  // real blocker now; an empty candidate pool is fine, the scene runs on new words.
  const hasWords = deck.length > 0;

  return (
    <div className="anim-fade-up mx-auto flex h-[calc(100dvh-176px)] max-w-[720px] flex-col md:h-[calc(100dvh-140px)]">
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
                <button
                  type="button"
                  onClick={() => setShowMore((v) => !v)}
                  aria-expanded={showMore}
                  className="mt-3 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-semibold text-ink-muted transition-colors hover:bg-black/[0.04] hover:text-ink"
                >
                  <ChevronDown className={cn("h-4 w-4 transition-transform", showMore && "rotate-180")} />
                  {showMore ? t("scene.fewerScenes") : t("scene.moreScenes")}
                </button>
                <Collapse open={showMore} className="flex flex-wrap justify-center gap-1.5 pt-2">
                    {EXTRA_PRESETS.map((p) => {
                      const on = selectedPreset === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setSelectedPreset(on ? null : p.id)}
                          aria-pressed={on}
                          className={cn(
                            "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors",
                            on ? "border-sage bg-sage text-white" : "border-black/[0.1] bg-surface text-ink-muted hover:border-sage/50",
                          )}
                        >
                          <p.icon className="size-3.5" strokeWidth={2.25} aria-hidden />
                          {t(`scene.preset.${p.id}`)}
                        </button>
                      );
                    })}
                </Collapse>
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

          {/* past scenes — resume an unfinished one or re-read a finished one */}
          <SceneHistory onOpen={(id) => router.push(`/coach/scene?session=${id}`)} />
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
                    {readings.get(w.word) && <span className="ml-1.5 text-[12px] font-medium text-ink-faint">{readings.get(w.word)}</span>}
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
                    {readings.get(w.word) && <span className="ml-1.5 text-[12px] font-medium opacity-60">{readings.get(w.word)}</span>}
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
                    {readings.get(w.word) && <span className="text-[11px] font-medium opacity-65">{readings.get(w.word)}</span>}
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
            {busy && turns[turns.length - 1]?.streaming && !turns[turns.length - 1]?.content && (
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
              {mic.phase !== "idle" && (
                <div className="mb-2 flex items-center gap-2.5 rounded-[14px] border border-warn/30 bg-warn-bg/60 px-3.5 py-2.5">
                  {mic.phase === "recording" && (
                    <span className="relative flex h-2.5 w-2.5 shrink-0">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-warn-text opacity-60" />
                      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-warn-text" />
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[14px] text-ink">
                    {mic.phase === "transcribing" ? (
                      <span className="text-ink-faint">{t("mic.checking")}</span>
                    ) : mic.interim ? (
                      mic.interim
                    ) : (
                      <span className="text-ink-faint">{t("coach.practiceRec")}</span>
                    )}
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
                {/* Stays enabled while the partner replies: disabling it dropped focus (and the
                    phone keyboard) every turn. sendText ignores a send while busy, so the
                    learner can already draft the next line. */}
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    // isComposing: Enter that confirms a pinyin/kana IME candidate must not send
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      sendText(input);
                    }
                  }}
                  rows={1}
                  maxLength={1000}
                  placeholder={t("scene.input")}
                  className="max-h-32 min-h-[46px] flex-1 resize-none rounded-[16px] border border-black/[0.08] bg-surface px-4 py-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
                />
                <button
                  type="button"
                  onClick={mic.toggle}
                  disabled={busy || mic.phase === "transcribing"}
                  aria-label={t("coach.practiceMic")}
                  className={cn(
                    "flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[16px] border transition-colors disabled:opacity-40",
                    mic.phase === "recording" ? "border-warn/50 bg-warn-bg text-warn-text" : "border-black/[0.08] bg-surface text-ink-muted hover:border-sage/50 hover:text-sage-deep",
                  )}
                >
                  {mic.phase === "recording" ? (
                    <Square className="h-4 w-4 fill-current" />
                  ) : mic.phase === "transcribing" ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Mic className="h-5 w-5" />
                  )}
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
  const { t } = useI18n();
  const [fbOpen, setFbOpen] = useState(false);
  if (turn.role === "user") {
    const grade = turn.grade;
    const gradeLabel = grade === "ok" ? t("scene.fbOk") : grade === "minor" ? t("scene.fbMinor") : t("scene.fbWrong");
    return (
      <div className="anim-msg flex flex-col items-end gap-1">
        <div className="flex items-end justify-end gap-2.5">
          {grade && (
            <button
              type="button"
              onClick={() => setFbOpen((v) => !v)}
              aria-label={gradeLabel}
              title={gradeLabel}
              className={cn(
                "mb-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/[0.05] transition-colors hover:bg-black/[0.1]",
                grade === "ok" ? "text-sage" : grade === "minor" ? "text-amber-500" : "text-warn",
              )}
            >
              {grade === "ok" ? (
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              ) : grade === "minor" ? (
                <Minus className="h-3.5 w-3.5" strokeWidth={3} />
              ) : (
                <X className="h-3.5 w-3.5" strokeWidth={3} />
              )}
            </button>
          )}
          <div className="max-w-[78%] rounded-[16px] rounded-br-md bg-sage px-3.5 py-2.5 text-[15px] leading-relaxed text-white">
            {turn.content}
          </div>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-taupe/30 text-ink-muted">
            <User className="h-[17px] w-[17px]" />
          </span>
        </div>
        {grade && fbOpen && (
          <div className="anim-pop max-w-[78%] rounded-[12px] border border-black/[0.06] bg-surface px-3 py-2 text-[12px] leading-relaxed shadow-sm">
            {grade === "ok" ? (
              <span className="inline-flex items-center gap-1 font-semibold text-sage-deep">
                <Check className="h-3 w-3" strokeWidth={3} /> {t("scene.fbOk")}
              </span>
            ) : (
              <ul className="space-y-1">
                {(turn.corrections ?? []).map((c, i) => (
                  <li key={i}>
                    {c.original && <span className="text-ink-faint line-through">{c.original}</span>}
                    {c.original && <span className="mx-1.5 text-ink-faint">→</span>}
                    <span className="font-semibold text-sage-deep">{c.corrected}</span>
                    {c.note && <span className="ml-2 text-ink-soft">{c.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  }
  if (turn.streaming) {
    if (!turn.content) return null;
    return (
      <div className="anim-msg flex items-end justify-start gap-2.5">
        <SceneAvatar />
        <div className="max-w-[82%]">
          {characterName && (
            <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{characterName}</div>
          )}
          <div className="whitespace-pre-wrap rounded-[16px] rounded-bl-md border border-black/[0.06] bg-paper px-3.5 py-2.5 text-[15px] leading-relaxed text-ink">
            {turn.content}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="anim-msg flex items-end justify-start gap-2.5">
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
          <SpeakButton text={turn.content} lang={speakLang} size="sm" className="hover-reveal" />
        </div>
      </div>
    </div>
  );
}
