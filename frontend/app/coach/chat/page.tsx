"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
import { useTranscriptions } from "@/lib/transcribe";
import { useEnsureLevel } from "@/lib/useEnsureLevel";
import { SpeakButton } from "@/components/SpeakButton";
import { WordMeaningPop, type WordPopTarget } from "@/components/WordMeaningPop";
import { TappableText, type WordEntry } from "@/components/TappableText";
import { PracticeBar } from "@/components/PracticeBar";
import { useMicInput } from "@/lib/useMicInput";
import { cn } from "@/lib/utils";
import { MessageCircle, ArrowLeft, Send, Mic, Square, Sparkles, Check, User, Flame, Star, Flag, Loader2 } from "lucide-react";

type Turn = { role: "user" | "assistant"; content: string; streaming?: boolean };
type PairKey = { source: string; target: string };

const LIFETIME_KEY = "lexa.chatPoints";
const levelFor = (pts: number) => Math.floor(pts / 100) + 1;

export default function CoachChatPage() {
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

  const pairs = useMemo(() => {
    const m = new Map<string, PairKey>();
    for (const w of deck) m.set(`${w.sourceLang}|${w.targetLang}`, { source: w.sourceLang, target: w.targetLang });
    return [...m.values()];
  }, [deck]);

  const [pair, setPair] = useState<PairKey | null>(null);
  const [topic, setTopic] = useState("");
  useEffect(() => {
    if (pair || deck.length === 0) return;
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
  }, [deck, pair]);

  // Coach memory is per SOURCE LANGUAGE — read the goal for the pair actually selected.
  const { data: profile } = useQuery({
    queryKey: ["coach-profile", accountId, pair?.source],
    queryFn: () => api.coachProfile(accountId, pair!.source),
    enabled: !!accountId && !!pair,
  });

  // Prefill the topic with the learner's saved goal — a natural thing to chat about.
  useEffect(() => {
    const g = profile?.goal?.trim();
    if (g) setTopic((cur) => cur || g);
  }, [profile?.goal]);

  // Candidate words for the conversation: weak → due → the rest, capped. These are
  // CANDIDATES, not a checklist — the model weaves in only the ones that fit what you
  // are actually talking about, and may use none at all.
  const poolWords = useMemo(() => {
    if (!pair) return [] as Word[];
    const pool = deck.filter((w) => w.sourceLang === pair.source && w.targetLang === pair.target);
    const weak = pool.filter((w) => (w.lapses ?? 0) >= 2);
    const due = pool.filter(isDue);
    return [...new Map([...weak, ...due, ...pool].map((w) => [w.id, w])).values()].slice(0, 24);
  }, [deck, pair]);

  const poolStrings = useMemo(() => poolWords.map((w) => w.word), [poolWords]);
  const wordPayload = useMemo(() => poolWords.map((w) => ({ word: w.word, meaning: w.meaningZh ?? "" })), [poolWords]);

  // Brand-new words Onomika slips into the chat (not yet in the deck) accumulate here.
  const [newWords, setNewWords] = useState<{ word: string; meaning: string }[]>([]);
  // Highlighting covers the learner's words-in-play AND any new words introduced.
  const allStrings = useMemo(() => [...poolStrings, ...newWords.map((n) => n.word)], [poolStrings, newWords]);
  const matcher = useMemo(() => buildWordMatcher(allStrings), [allStrings]);
  const entries = useMemo(() => {
    const m = new Map<string, WordEntry>();
    // New words first, then owned words override → an owned word never shows as "new".
    for (const n of newWords) m.set(n.word.trim().toLowerCase(), { meaning: n.meaning, isNew: true });
    for (const w of poolWords) m.set(w.word.trim().toLowerCase(), { meaning: w.meaningZh ?? "", isNew: false });
    return m;
  }, [poolWords, newWords]);

  // Words that have actually come up in THIS conversation: seeded by Onomika, used by
  // the learner, or introduced as new. The chip strip is live, not a pre-dealt board.
  const [liveWords, setLiveWords] = useState<{ word: string; meaning: string; state: "seeded" | "used" | "new" }[]>([]);
  // Pinyin / romanization for those chips — empty for languages we can't romanize locally.
  const readings = useTranscriptions(
    liveWords.map((w) => w.word),
    pair?.source ?? "",
  );

  // Every word the learner owns in this pair, keyed for the tap-any-word lookup: an
  // owned word that isn't a candidate still resolves locally, with no model call.
  const deckByKey = useMemo(() => {
    const m = new Map<string, Word>();
    if (!pair) return m;
    for (const w of deck) {
      if (w.sourceLang === pair.source && w.targetLang === pair.target) m.set(w.word.trim().toLowerCase(), w);
    }
    return m;
  }, [deck, pair]);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [used, setUsed] = useState<Set<string>>(new Set());
  // Tapped-word meaning popover + one-tap "add to my words" state.
  const [pop, setPop] = useState<WordPopTarget | null>(null);
  const [addingWord, setAddingWord] = useState<string | null>(null);
  const [addedWords, setAddedWords] = useState<Set<string>>(new Set());
  // Gamification: session points + combo, plus a persistent lifetime total → level.
  const [points, setPoints] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [lifetime, setLifetime] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    try {
      return Number(localStorage.getItem(LIFETIME_KEY) ?? 0) || 0;
    } catch {
      return 0;
    }
  });
  const scrollRef = useRef<HTMLDivElement>(null);

  // Aborts an in-flight streamed reply (unmount, or sending while one is streaming).
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy, finished]);

  function addLifetime(delta: number) {
    setLifetime((cur) => {
      const next = cur + delta;
      try {
        localStorage.setItem(LIFETIME_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Merge words into the live strip. A word already there never duplicates; it only
  // upgrades seeded → used once the learner deploys it themselves.
  function pushLive(next: { word: string; meaning: string; state: "seeded" | "used" | "new" }[]) {
    const items = next.filter((n) => n.word.trim());
    if (items.length === 0) return;
    setLiveWords((cur) => {
      const byKey = new Map(cur.map((c) => [c.word.trim().toLowerCase(), c]));
      for (const it of items) {
        const k = it.word.trim().toLowerCase();
        const prev = byKey.get(k);
        byKey.set(
          k,
          prev
            ? { ...prev, state: prev.state === "new" ? "new" : it.state === "used" ? "used" : prev.state }
            : it,
        );
      }
      return [...byKey.values()];
    });
  }

  async function sendTurn(history: Turn[], opts: { userTurn: boolean; wrap?: boolean } = { userTurn: true }) {
    if (!pair) return;
    setBusy(true);
    // Live placeholder bubble that the streamed deltas type into.
    setTurns((cur) => [...cur, { role: "assistant", content: "", streaming: true }]);
    let acc = ""; // text streamed so far — kept as the bubble if the stream breaks mid-way
    const ac = new AbortController();
    abortRef.current = ac;
    // Patch the placeholder only while it is still the last, still-streaming turn (guards
    // against a reset/unmount racing an in-flight delta).
    const patchStream = () => {
      setTurns((cur) => {
        if (!cur.length) return cur;
        const last = cur[cur.length - 1];
        if (last.role !== "assistant" || !last.streaming) return cur;
        return [...cur.slice(0, -1), { ...last, content: acc }];
      });
    };
    try {
      const res = await api.coachChatStream(
        {
          messages: history.map((m) => ({ role: m.role, content: m.content })),
          words: wordPayload,
          sourceLang: pair.source,
          targetLang: pair.target,
          level: getLevel(pair.source) ?? undefined,
          topic: topic.trim() || undefined,
          wrap: opts.wrap,
          telegramId: accountId,
        },
        {
          onDelta: (t) => {
            acc += t;
            patchStream();
          },
          signal: ac.signal,
        },
      );
      // Finalize the bubble with the validated text (highlighting snaps on here), then run
      // the structured extras exactly once.
      setTurns((cur) => {
        if (cur.length && cur[cur.length - 1].role === "assistant" && cur[cur.length - 1].streaming) {
          return [...cur.slice(0, -1), { role: "assistant", content: res.say }];
        }
        return [...cur, { role: "assistant", content: res.say }];
      });

      // Onomika may slip in a brand-new word — collect it so it highlights amber and
      // can be added to the deck in a tap.
      if (res.newWords?.length) {
        setNewWords((cur) => {
          const seen = new Set(cur.map((n) => n.word.trim().toLowerCase()));
          const fresh = res.newWords.filter((n) => n.word && !seen.has(n.word.trim().toLowerCase()));
          return fresh.length ? [...cur, ...fresh] : cur;
        });
        pushLive(res.newWords.map((n) => ({ word: n.word, meaning: n.meaning, state: "new" as const })));
      }
      // Whatever Onomika wove into THIS reply joins the strip too — the chips appear
      // as words actually come up, rather than being dealt before the chat starts.
      if (res.seeded?.length) {
        pushLive(
          res.seeded.map((w) => ({ word: w, meaning: entries.get(w.trim().toLowerCase())?.meaning ?? "", state: "seeded" as const })),
        );
      }

      if (opts.userTurn) {
        const usedNow = (res.used ?? []).map((w) => w.toLowerCase());
        const fresh = usedNow.filter((w) => !used.has(w));
        if (usedNow.length > 0) {
          const nextCombo = combo + 1;
          setCombo(nextCombo);
          setBestCombo((b) => Math.max(b, nextCombo));
          if (fresh.length > 0) {
            setUsed((s) => new Set([...s, ...fresh]));
            const gained = fresh.length * 10 * nextCombo;
            setPoints((p) => p + gained);
            addLifetime(gained);
            const first = (res.used ?? []).find((w) => fresh.includes(w.toLowerCase())) ?? "";
            show({ icon: "🎯", title: t("chat.scored", { word: first, pts: String(gained) }) });
            pushLive(
              (res.used ?? []).map((w) => ({
                word: w,
                meaning: entries.get(w.trim().toLowerCase())?.meaning ?? "",
                state: "used" as const,
              })),
            );
            // Retention: a word the learner actually deployed in conversation is a
            // successful recall — grade it Good so chat moves the SRS, not just points.
            const graded = fresh
              .map((w) => poolWords.find((p) => p.word.trim().toLowerCase() === w))
              .filter((c): c is Word => !!c);
            if (graded.length > 0) {
              await Promise.allSettled(graded.map((c) => api.reviewWord(c.id, 3, "chat")));
              qc.invalidateQueries({ queryKey: ["words"] });
              qc.invalidateQueries({ queryKey: ["stats"] });
            }
          }
        } else {
          setCombo(0);
        }
      }

      if (opts.wrap) setFinished(true);
    } catch (e) {
      const aborted = (e as Error)?.name === "AbortError";
      if (acc.trim()) {
        // Streamed visible text but never got a validated final: keep what we have as the
        // bubble, skip the structured extras (no SRS/points for a half-turn), no toast.
        setTurns((cur) =>
          cur.length && cur[cur.length - 1].streaming
            ? [...cur.slice(0, -1), { role: "assistant", content: acc }]
            : cur,
        );
      } else {
        // Nothing streamed: drop the empty placeholder; surface the error unless aborted.
        setTurns((cur) => (cur.length && cur[cur.length - 1].streaming ? cur.slice(0, -1) : cur));
        if (!aborted) show({ icon: "⚠️", title: errText(e, t) });
      }
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  async function start() {
    if (!pair || busy) return;
    // Difficulty is never random: if no level is set for this language yet, ask once.
    const { ok } = await ensureLevel(pair.source);
    if (!ok) return;
    setStarted(true);
    setFinished(false);
    setTurns([]);
    setUsed(new Set());
    setNewWords([]);
    setLiveWords([]);
    setPop(null);
    setAddedWords(new Set());
    setPoints(0);
    setCombo(0);
    setBestCombo(0);
    await sendTurn([], { userTurn: false });
  }

  async function sendText(text: string) {
    const v = text.trim();
    if (!v || busy || finished) return;
    mic.cancel();
    const next: Turn[] = [...turns, { role: "user", content: v }];
    setTurns(next);
    setInput("");
    await sendTurn(next, { userTurn: true });
  }

  async function finish() {
    if (busy || finished || turns.length === 0) return;
    await sendTurn(turns, { userTurn: false, wrap: true });
  }

  // Save a word Onomika introduced (or one you tapped and glossed) → a card, instantly:
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

  // Open the meaning popover for a tapped highlight (a candidate or a new word) —
  // the meaning is already in hand, so this never waits on a request.
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

  // Tap ANY other word in a bubble: the Reader's instant-gloss mechanic. A word the
  // learner already owns resolves from the deck (no request, nothing to add); anything
  // else opens in a loading state and fills from the gloss cache or one cheap call.
  async function openGlossPop(token: string, sentence: string, el: HTMLElement) {
    if (!pair) return;
    const key = token.trim().toLowerCase();
    const owned = deckByKey.get(key);
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

  // ---- voice answer (auto: browser Web Speech where it works, else server STT) ----
  const mic = useMicInput({
    lang: pair?.source,
    getBase: () => input.trim(),
    onText: (full) => setInput(full),
    onError: (message) => show({ icon: "⚠️", title: message }),
  });

  const srcFontCls = pair && (pair.source === "zh" || pair.source === "zh-Hant" || pair.source === "ja") ? "font-zh" : "";
  const level = levelFor(lifetime);

  return (
    <div className="anim-fade-up mx-auto flex h-[calc(100dvh-176px)] max-w-[720px] flex-col md:h-[calc(100dvh-140px)]">
      <div className="mb-3">
        <Link href="/coach" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> {t("coach.title")}
        </Link>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 font-serif text-[26px] font-medium tracking-[-0.01em] text-ink">
            <MessageCircle className="h-6 w-6 text-sage-deep" /> {t("chat.title")}
          </h1>
          {started && (points > 0 || combo >= 2) && (
            <div className="flex shrink-0 items-center gap-1.5">
              {points > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-sage px-2.5 py-1 text-[13px] font-semibold text-white">
                  <Star className="h-3.5 w-3.5 fill-current" /> {points}
                </span>
              )}
              {combo >= 2 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-warn-bg px-2.5 py-1 text-[13px] font-semibold text-warn-text">
                  <Flame className="h-3.5 w-3.5" /> x{combo}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {!started ? (
        <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto rounded-[22px] border border-black/[0.06] bg-surface p-7 text-center">
          <h2 className="font-serif text-[22px] font-semibold text-ink">{t("chat.heroTitle")}</h2>
          <p className="mt-2 max-w-[460px] text-[14px] leading-relaxed text-ink-soft">{t("chat.heroSub")}</p>
          {lifetime > 0 && (
            <div className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-sage/30 bg-sage-tint/40 px-3 py-1 text-[12px] font-semibold text-sage-deep">
              <Star className="h-3.5 w-3.5 fill-current" /> {t("chat.level", { n: String(level) })} · {lifetime} {t("chat.pts")}
            </div>
          )}

          {deck.length === 0 ? (
            <p className="mt-6 rounded-[12px] border border-dashed border-black/[0.12] bg-paper/50 px-4 py-3 text-[13px] text-ink-soft">
              {t("coach.practiceNoWords")}
            </p>
          ) : (
            <>
              {pairs.length > 1 && (
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

              {/* how hard Onomika talks, and whether every word is tappable */}
              <div className="mt-5">
                <PracticeBar lang={pair?.source ?? "en"} />
              </div>

              {/* what to chat about — prefilled from your goal, but free to change */}
              <div className="mt-5 w-full max-w-[440px] text-left">
                <div className="mb-2 text-center text-[12px] font-semibold uppercase tracking-wide text-ink-faint">{t("chat.topicLabel")}</div>
                <input
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder={t("chat.topicPh")}
                  maxLength={120}
                  className="h-11 w-full rounded-[12px] border border-black/[0.08] bg-surface px-3.5 text-center text-[14px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
                />
              </div>

              {poolWords.length > 0 && (
                <p className="mt-5 max-w-[420px] text-[13px] leading-relaxed text-ink-faint">
                  {t("chat.poolHint", { n: String(poolWords.length) })}
                </p>
              )}
              <button
                type="button"
                onClick={start}
                className="mt-5 inline-flex items-center gap-2 rounded-full bg-sage px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sage-deep"
              >
                <Sparkles className="h-4 w-4" /> {t("chat.start")}
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {/* difficulty + tap-any-word stay reachable mid-conversation */}
          <div className="mb-2 flex justify-end">
            <PracticeBar lang={pair?.source ?? "en"} />
          </div>

          {/* words in play — chips appear as they actually come up, not dealt up front */}
          {liveWords.length > 0 && (
            <div className="mb-3 flex gap-1.5 overflow-x-auto rounded-[16px] border border-black/[0.06] bg-surface px-3 py-2.5">
              {liveWords.map((w) => (
                <button
                  key={w.word}
                  type="button"
                  onClick={(e) => openWordPop(w.word, "", e.currentTarget)}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[13px] font-semibold transition-colors",
                    w.state === "used"
                      ? "border-sage bg-sage text-white"
                      : w.state === "new"
                        ? "border-warn/30 bg-warn-bg text-warn-text"
                        : "border-black/[0.08] bg-paper text-ink-muted hover:border-sage/40",
                    srcFontCls,
                  )}
                >
                  {w.state === "used" && <Check className="h-3 w-3" strokeWidth={3} />}
                  {w.word}
                  {readings.get(w.word) && <span className="text-[11px] font-medium opacity-65">{readings.get(w.word)}</span>}
                </button>
              ))}
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
              />
            ))}
            {busy && turns[turns.length - 1]?.streaming && !turns[turns.length - 1]?.content && (
              <div className="flex items-center gap-2.5">
                <ChatAvatar />
                <div className="flex items-center gap-1.5 rounded-[16px] rounded-bl-md border border-black/[0.06] bg-paper px-3.5 py-3">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint" />
                </div>
              </div>
            )}
            {finished && (
              <div className="mt-2 rounded-[16px] border border-sage/30 bg-sage-tint/40 p-4 text-center">
                <div className="font-serif text-[18px] font-semibold text-ink">{t("chat.recapTitle")}</div>
                <div className="mt-2 flex flex-wrap justify-center gap-2 text-[13px]">
                  {used.size > 0 && (
                    <span className="rounded-full bg-surface px-3 py-1 font-semibold text-sage-deep">
                      {t("chat.recapUsedN", { n: String(used.size) })}
                    </span>
                  )}
                  <span className="rounded-full bg-surface px-3 py-1 font-semibold text-sage-deep">
                    {t("chat.recapPts", { n: String(points) })}
                  </span>
                  {bestCombo >= 2 && (
                    <span className="rounded-full bg-surface px-3 py-1 font-semibold text-warn-text">
                      {t("chat.recapCombo", { n: String(bestCombo) })}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={start}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-sage/50 bg-surface px-4 py-2 text-sm font-semibold text-sage-deep transition-colors hover:bg-sage-tint"
                >
                  <Sparkles className="h-4 w-4" /> {t("chat.again")}
                </button>
              </div>
            )}
          </div>

          {!finished && (
            <div className="mt-3">
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy || turns.length === 0}
                  onClick={finish}
                  className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] px-3 py-1.5 text-[13px] font-semibold text-ink-muted transition-colors hover:border-sage/50 disabled:opacity-40"
                >
                  <Flag className="h-3.5 w-3.5" /> {t("chat.finish")}
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
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      sendText(input);
                    }
                  }}
                  rows={1}
                  placeholder={t("chat.input")}
                  disabled={busy}
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

function ChatAvatar() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-full bg-sage text-white">
      <MessageCircle className="h-[18px] w-[18px]" />
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
}: {
  turn: Turn;
  matcher: WordMatcher;
  used: Set<string>;
  entries: Map<string, WordEntry>;
  tapAny: boolean;
  onKnown: (canonical: string, sentence: string, el: HTMLElement) => void;
  onUnknown: (token: string, sentence: string, el: HTMLElement) => void;
  speakLang: string;
}) {
  if (turn.role === "user") {
    return (
      <div className="anim-msg flex items-end justify-end gap-2.5">
        <div className="max-w-[78%] rounded-[16px] rounded-br-md bg-sage px-3.5 py-2.5 text-[15px] leading-relaxed text-white">
          {turn.content}
        </div>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-taupe/30 text-ink-muted">
          <User className="h-[17px] w-[17px]" />
        </span>
      </div>
    );
  }
  // While streaming, render plain text — no tap-to-gloss on half-tokens and no speak
  // button yet; highlighting snaps on at the final. An empty placeholder renders nothing
  // (the typing dots cover the waiting state).
  if (turn.streaming) {
    if (!turn.content) return null;
    return (
      <div className="anim-msg flex items-end justify-start gap-2.5">
        <ChatAvatar />
        <div className="max-w-[82%]">
          <div className="whitespace-pre-wrap rounded-[16px] rounded-bl-md border border-black/[0.06] bg-paper px-3.5 py-2.5 text-[15px] leading-relaxed text-ink">
            {turn.content}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="anim-msg flex items-end justify-start gap-2.5">
      <ChatAvatar />
      <div className="max-w-[82%]">
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
