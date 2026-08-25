"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isDue, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { getLevel } from "@/lib/learnPrefs";
import { langLabel } from "@/lib/langs";
import { SpeakButton } from "@/components/SpeakButton";
import { cn } from "@/lib/utils";
import { Compass, ArrowLeft, Loader2, Check, Minus, X as XIcon, Send, RotateCcw, Mic, Square, Lightbulb, SkipForward, User } from "lucide-react";

type Grade = "none" | "correct" | "partial" | "wrong";
type Turn = { role: "user" | "assistant"; content: string; grade?: Grade };
type PairKey = { source: string; target: string };

const GRADE_RATING: Record<Exclude<Grade, "none">, number> = { correct: 3, partial: 2, wrong: 1 };

// Render the coach's light markdown (*word* / **word**) as clean highlights so the
// target word reads as a chip instead of literal asterisks.
function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong>;
        if (/^\*[^*\n]+\*$/.test(p))
          return (
            <span key={i} className="rounded-md bg-sage-tint px-1.5 py-0.5 font-semibold text-sage-deep">
              {p.slice(1, -1)}
            </span>
          );
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

export default function CoachPracticePage() {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();

  const { data: words } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
    enabled: !!accountId,
  });
  const deck = useMemo(() => words ?? [], [words]);

  // A caller (a collection / imported deck) can hand us specific words to drill.
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

  // Language pairs present in the deck, for the picker.
  const pairs = useMemo(() => {
    const m = new Map<string, PairKey>();
    for (const w of deck) m.set(`${w.sourceLang}|${w.targetLang}`, { source: w.sourceLang, target: w.targetLang });
    return [...m.values()];
  }, [deck]);

  const [pair, setPair] = useState<PairKey | null>(null);
  // Default the pair: the focus words' pair, else the deck's most common one.
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

  // The words to drill for the chosen pair: weak → due → any, capped at 8.
  const drill = useMemo(() => {
    if (!pair) return [] as Word[];
    let pool = deck.filter((w) => w.sourceLang === pair.source && w.targetLang === pair.target);
    if (focusIds && focusIds.length) {
      const set = new Set(focusIds);
      pool = pool.filter((w) => set.has(w.id));
    }
    const weak = pool.filter((w) => (w.lapses ?? 0) >= 2);
    const due = pool.filter(isDue);
    return [...new Map([...weak, ...due, ...pool].map((w) => [w.id, w])).values()].slice(0, 8);
  }, [deck, pair, focusIds]);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const [scores, setScores] = useState<Record<string, Grade>>({});
  const [idleHint, setIdleHint] = useState(false);
  const [currentWord, setCurrentWord] = useState(""); // the word being drilled now
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  // After the coach speaks and it's the learner's turn, nudge a hint if they stall.
  useEffect(() => {
    setIdleHint(false);
    if (busy || done || turns.length === 0) return;
    if (turns[turns.length - 1].role !== "assistant") return;
    const timer = setTimeout(() => setIdleHint(true), 13000);
    return () => clearTimeout(timer);
  }, [turns, busy, done]);

  const wordPayload = useMemo(() => drill.map((w) => ({ word: w.word, meaning: w.meaningZh ?? "" })), [drill]);

  async function sendTurn(history: Turn[]) {
    if (!pair) return;
    setBusy(true);
    try {
      const res = await api.coachDrill({
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        words: wordPayload,
        sourceLang: pair.source,
        targetLang: pair.target,
        level: getLevel(pair.source) ?? undefined,
      });
      setTurns((cur) => [...cur, { role: "assistant", content: res.say, grade: res.grade }]);
      if (res.drillWord) setCurrentWord(res.drillWord);
      if (res.done) setDone(true);
      if (res.grade !== "none" && res.gradedWord) {
        const key = res.gradedWord.trim().toLowerCase();
        const card = drill.find((w) => w.word.trim().toLowerCase() === key);
        setScores((s) => ({ ...s, [key]: res.grade }));
        if (card) {
          try {
            await api.reviewWord(card.id, GRADE_RATING[res.grade as Exclude<Grade, "none">]);
            qc.invalidateQueries({ queryKey: ["words"] });
            qc.invalidateQueries({ queryKey: ["stats"] });
          } catch {
            /* SRS grading is best-effort */
          }
        }
      }
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (drill.length === 0 || busy) return;
    setStarted(true);
    setTurns([]);
    setScores({});
    setDone(false);
    setCurrentWord("");
    await sendTurn([]);
  }

  async function sendText(text: string) {
    const v = text.trim();
    if (!v || busy || done) return;
    const next: Turn[] = [...turns, { role: "user", content: v }];
    setTurns(next);
    setInput("");
    await sendTurn(next);
  }

  // ---- voice answer (record → transcribe → fill the box) ----
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function toggleRecord() {
    if (recording) {
      recorderRef.current?.stop();
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      show({ icon: "⚠️", title: t("coach.practiceMicUnsupported") });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size) chunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((tr) => tr.stop());
        setRecording(false);
        await transcribeBlob(new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" }));
      };
      recorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch {
      show({ icon: "⚠️", title: t("coach.practiceMicUnsupported") });
    }
  }

  async function transcribeBlob(blob: Blob) {
    setTranscribing(true);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      const fmt = (blob.type.split("/")[1] || "webm").split(";")[0];
      const { text } = await api.stt({ audio: b64, format: fmt, sourceLang: pair?.source });
      if (text.trim()) setInput((cur) => (cur.trim() ? cur + " " + text.trim() : text.trim()));
      else show({ icon: "⚠️", title: t("coach.practiceSttFail") });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setTranscribing(false);
    }
  }

  const gradedCount = Object.keys(scores).length;
  const correct = Object.values(scores).filter((g) => g === "correct").length;
  const currentCard = drill.find((w) => w.word.trim().toLowerCase() === currentWord.trim().toLowerCase());
  const srcFontCls = pair && (pair.source === "zh" || pair.source === "zh-Hant" || pair.source === "ja") ? "font-zh" : "";

  return (
    <div className="anim-fade-up mx-auto flex h-[calc(100dvh-140px)] max-w-[720px] flex-col">
      <div className="mb-3">
        <Link href="/coach" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
          <ArrowLeft className="h-4 w-4" /> {t("coach.title")}
        </Link>
        <div className="mt-1 flex items-center justify-between gap-3">
          <h1 className="flex items-center gap-2 font-serif text-[26px] font-medium tracking-[-0.01em] text-ink">
            <Compass className="h-6 w-6 text-sage-deep" /> {t("coach.practiceTitle")}
          </h1>
          {started && drill.length > 0 && (
            <div className="shrink-0 text-[13px] font-semibold text-ink-muted">
              {t("coach.practiceProgress", { n: Math.min(gradedCount + 1, drill.length), total: drill.length })}
            </div>
          )}
        </div>
        {started && drill.length > 0 && (
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
            <div className="h-full rounded-full bg-sage transition-all" style={{ width: `${(gradedCount / drill.length) * 100}%` }} />
          </div>
        )}
      </div>

      {!started ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-[22px] border border-black/[0.06] bg-surface p-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sage text-white">
            <Compass className="h-7 w-7" />
          </span>
          <h2 className="mt-4 font-serif text-[22px] font-semibold text-ink">{t("coach.practiceHeroTitle")}</h2>
          <p className="mt-2 max-w-[440px] text-[14px] leading-relaxed text-ink-soft">{t("coach.practiceHeroSub")}</p>

          {deck.length === 0 ? (
            <p className="mt-6 rounded-[12px] border border-dashed border-black/[0.12] bg-paper/50 px-4 py-3 text-[13px] text-ink-soft">
              {t("coach.practiceNoWords")}
            </p>
          ) : (
            <>
              {/* which language pair to practise */}
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

              {drill.length > 0 ? (
                <>
                  <div className="mt-5 flex flex-wrap justify-center gap-1.5">
                    {drill.map((w) => (
                      <span key={w.id} className="rounded-full border border-black/[0.06] bg-paper px-2.5 py-0.5 text-[13px] text-ink-muted">
                        {w.word}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={start}
                    className="mt-6 inline-flex items-center gap-2 rounded-full bg-sage px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sage-deep"
                  >
                    <Compass className="h-4 w-4" /> {t("coach.practiceStart")}
                  </button>
                </>
              ) : (
                <p className="mt-6 rounded-[12px] border border-dashed border-black/[0.12] bg-paper/50 px-4 py-3 text-[13px] text-ink-soft">
                  {t("coach.practiceNoWords")}
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {/* the word being drilled — big, animated, tappable to hear it */}
          {currentWord && !done && (
            <div
              key={currentWord}
              className="anim-pop mb-3 flex items-center justify-center gap-3 rounded-[18px] border border-sage/25 bg-gradient-to-br from-sage-tint/50 via-surface to-surface px-5 py-3.5"
            >
              <div className="text-center">
                <div className={cn("font-serif text-[28px] font-semibold leading-none text-ink", srcFontCls)}>{currentWord}</div>
                {currentCard?.meaningZh && <div className="mt-1.5 text-[13px] font-medium text-sage-deep">{currentCard.meaningZh}</div>}
              </div>
              <SpeakButton text={currentWord} lang={pair?.source ?? "en"} />
            </div>
          )}

          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto rounded-[22px] border border-black/[0.06] bg-surface p-4 sm:p-5">
            {turns.map((turn, i) => (
              <Bubble key={i} turn={turn} t={t} />
            ))}
            {busy && (
              <div className="flex items-center gap-2.5">
                <CoachAvatar />
                <div className="flex items-center gap-1.5 rounded-[16px] rounded-bl-md border border-black/[0.06] bg-paper px-3.5 py-3">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.2s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.1s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint" />
                </div>
              </div>
            )}
            {done && (
              <div className="mt-2 rounded-[16px] border border-sage/30 bg-sage-tint/40 p-4 text-center">
                <div className="font-serif text-[18px] font-semibold text-ink">{t("coach.practiceDone")}</div>
                <div className="mt-1 text-[13px] text-ink-soft">{t("coach.practiceScore", { correct, total: gradedCount })}</div>
                <button
                  type="button"
                  onClick={start}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-sage/50 bg-surface px-4 py-2 text-sm font-semibold text-sage-deep transition-colors hover:bg-sage-tint"
                >
                  <RotateCcw className="h-4 w-4" /> {t("coach.practiceAgain")}
                </button>
              </div>
            )}
          </div>

          {!done && (
            <div className="mt-3">
              {/* quick actions + idle hint */}
              <div className="mb-2 flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => sendText(t("coach.practiceHintMsg"))}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition-colors disabled:opacity-40",
                    idleHint ? "border-sage bg-sage-tint text-sage-deep" : "border-black/[0.1] text-ink-muted hover:border-sage/50",
                  )}
                >
                  <Lightbulb className="h-3.5 w-3.5" /> {t("coach.practiceHintChip")}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => sendText(t("coach.practiceSkipMsg"))}
                  className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] px-3 py-1.5 text-[13px] font-semibold text-ink-muted transition-colors hover:border-sage/50 disabled:opacity-40"
                >
                  <SkipForward className="h-3.5 w-3.5" /> {t("coach.practiceSkipChip")}
                </button>
                {idleHint && <span className="text-[12px] text-ink-faint">{t("coach.practiceIdle")}</span>}
              </div>

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
                  placeholder={transcribing ? t("coach.practiceTranscribing") : recording ? t("coach.practiceRec") : t("coach.practiceInput")}
                  disabled={busy}
                  className="max-h-32 min-h-[46px] flex-1 resize-none rounded-[16px] border border-black/[0.08] bg-surface px-4 py-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
                />
                <button
                  type="button"
                  onClick={toggleRecord}
                  disabled={busy || transcribing}
                  aria-label={t("coach.practiceMic")}
                  title={t("coach.practiceMic")}
                  className={cn(
                    "flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[16px] border transition-colors disabled:opacity-40",
                    recording ? "border-warn/50 bg-warn-bg text-warn-text" : "border-black/[0.08] bg-surface text-ink-muted hover:border-sage/50 hover:text-sage-deep",
                  )}
                >
                  {transcribing ? <Loader2 className="h-5 w-5 animate-spin" /> : recording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
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
    </div>
  );
}

function CoachAvatar() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-full bg-sage text-white">
      <Compass className="h-[18px] w-[18px]" />
    </span>
  );
}

function GradeBadge({ grade, t }: { grade: Grade; t: (k: string) => string }) {
  if (grade === "none") return null;
  const map = {
    correct: { Icon: Check, cls: "border-sage/40 bg-sage-tint text-sage-deep", label: t("coach.gradeCorrect") },
    partial: { Icon: Minus, cls: "border-warn/40 bg-warn-bg text-warn-text", label: t("coach.gradePartial") },
    wrong: { Icon: XIcon, cls: "border-warn/40 bg-warn-bg text-warn-text", label: t("coach.gradeWrong") },
  }[grade];
  return (
    <span className={cn("mb-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold", map.cls)}>
      <map.Icon className="h-3 w-3" strokeWidth={3} /> {map.label}
    </span>
  );
}

function Bubble({ turn, t }: { turn: Turn; t: (k: string) => string }) {
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
      <CoachAvatar />
      <div className="max-w-[82%]">
        {turn.grade && turn.grade !== "none" && <GradeBadge grade={turn.grade} t={t} />}
        <div className="whitespace-pre-wrap rounded-[16px] rounded-bl-md border border-black/[0.06] bg-paper px-3.5 py-2.5 text-[15px] leading-relaxed text-ink">
          <Rich text={turn.content} />
        </div>
      </div>
    </div>
  );
}
