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
import { cn } from "@/lib/utils";
import { Compass, ArrowLeft, Loader2, Check, Minus, X as XIcon, Send, RotateCcw } from "lucide-react";

type Grade = "none" | "correct" | "partial" | "wrong";
type Turn = { role: "user" | "assistant"; content: string; grade?: Grade; gradedWord?: string };

// grade → FSRS rating (1 Again, 2 Hard, 3 Good, 4 Easy) fed back into the SRS.
const GRADE_RATING: Record<Exclude<Grade, "none">, number> = { correct: 3, partial: 2, wrong: 1 };

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
  const deck = words ?? [];

  // Pick the words to drill: weak spots first, then due, then anything — all from a
  // single language pair (the drill runs in one pair) so the coach stays coherent.
  const drill = useMemo(() => {
    if (deck.length === 0) return { words: [] as Word[], source: "en", target: "zh" };
    const weak = deck.filter((w) => (w.lapses ?? 0) >= 2);
    const due = deck.filter(isDue);
    const ordered = [...new Map([...weak, ...due, ...deck].map((w) => [w.id, w])).values()];
    const pair = `${ordered[0].sourceLang}|${ordered[0].targetLang}`;
    const same = ordered.filter((w) => `${w.sourceLang}|${w.targetLang}` === pair).slice(0, 8);
    return { words: same, source: ordered[0].sourceLang, target: ordered[0].targetLang };
  }, [deck]);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [done, setDone] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Tally of per-word grades (the SRS gets the rating too).
  const [scores, setScores] = useState<Record<string, Grade>>({});

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  const wordPayload = useMemo(
    () => drill.words.map((w) => ({ word: w.word, meaning: w.meaningZh ?? "" })),
    [drill.words],
  );

  // Send one turn to the coach; thread = prior turns + the optional new user line.
  async function sendTurn(history: Turn[]) {
    setBusy(true);
    try {
      const res = await api.coachDrill({
        messages: history.map((m) => ({ role: m.role, content: m.content })),
        words: wordPayload,
        sourceLang: drill.source,
        targetLang: drill.target,
        level: getLevel(drill.source) ?? undefined,
      });
      setTurns((cur) => [
        ...cur,
        { role: "assistant", content: res.say, grade: res.grade, gradedWord: res.gradedWord },
      ]);
      if (res.done) setDone(true);
      // Feed the grade back into the SRS + tally it.
      if (res.grade !== "none" && res.gradedWord) {
        const key = res.gradedWord.trim().toLowerCase();
        const card = drill.words.find((w) => w.word.trim().toLowerCase() === key);
        setScores((s) => ({ ...s, [key]: res.grade }));
        if (card) {
          try {
            await api.reviewWord(card.id, GRADE_RATING[res.grade as Exclude<Grade, "none">]);
            qc.invalidateQueries({ queryKey: ["words"] });
            qc.invalidateQueries({ queryKey: ["stats"] });
          } catch {
            /* grading the SRS is best-effort; the drill continues regardless */
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
    if (drill.words.length === 0 || busy) return;
    setStarted(true);
    setTurns([]);
    setScores({});
    setDone(false);
    await sendTurn([]); // empty thread → the coach opens + asks the first word
  }

  async function send() {
    const text = input.trim();
    if (!text || busy || done) return;
    const next: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(next);
    setInput("");
    await sendTurn(next);
  }

  const gradedCount = Object.keys(scores).length;
  const correct = Object.values(scores).filter((g) => g === "correct").length;

  return (
    <div className="anim-fade-up mx-auto flex h-[calc(100dvh-140px)] max-w-[720px] flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <Link href="/coach" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover:text-ink">
            <ArrowLeft className="h-4 w-4" /> {t("coach.title")}
          </Link>
          <h1 className="mt-1 flex items-center gap-2 font-serif text-[26px] font-medium tracking-[-0.01em] text-ink">
            <Compass className="h-6 w-6 text-sage-deep" /> {t("coach.practiceTitle")}
          </h1>
        </div>
        {started && gradedCount > 0 && (
          <div className="shrink-0 rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-[13px] font-semibold text-ink-muted">
            {correct}/{gradedCount} ✓
          </div>
        )}
      </div>

      {!started ? (
        <div className="flex flex-1 flex-col items-center justify-center rounded-[22px] border border-black/[0.06] bg-surface p-8 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-sage-tint text-sage-deep">
            <Compass className="h-7 w-7" />
          </span>
          <h2 className="mt-4 font-serif text-[22px] font-semibold text-ink">{t("coach.practiceHeroTitle")}</h2>
          <p className="mt-2 max-w-[420px] text-[14px] leading-relaxed text-ink-soft">{t("coach.practiceHeroSub")}</p>
          {drill.words.length === 0 ? (
            <p className="mt-6 rounded-[12px] border border-dashed border-black/[0.12] bg-paper/50 px-4 py-3 text-[13px] text-ink-soft">
              {t("coach.practiceNoWords")}
            </p>
          ) : (
            <>
              <div className="mt-5 flex flex-wrap justify-center gap-1.5">
                {drill.words.map((w) => (
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
          )}
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto rounded-[22px] border border-black/[0.06] bg-surface p-4 sm:p-5">
            {turns.map((turn, i) => (
              <Bubble key={i} turn={turn} t={t} />
            ))}
            {busy && (
              <div className="flex items-center gap-2 text-[13px] text-ink-faint">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("coach.practiceThinking")}
              </div>
            )}
            {done && (
              <div className="mt-4 rounded-[16px] border border-sage/30 bg-sage-tint/40 p-4 text-center">
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
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
              className="mt-3 flex items-end gap-2"
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={1}
                placeholder={t("coach.practiceInput")}
                disabled={busy}
                className="max-h-32 min-h-[46px] flex-1 resize-none rounded-[16px] border border-black/[0.08] bg-surface px-4 py-3 text-[15px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[16px] bg-sage text-white transition-colors hover:bg-sage-deep disabled:opacity-40"
              >
                <Send className="h-5 w-5" />
              </button>
            </form>
          )}
        </>
      )}
    </div>
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
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-[16px] rounded-br-md bg-sage px-3.5 py-2.5 text-[15px] leading-relaxed text-white">
          {turn.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex justify-start">
      <div className="max-w-[85%]">
        {turn.grade && turn.grade !== "none" && <GradeBadge grade={turn.grade} t={t} />}
        <div className="whitespace-pre-wrap rounded-[16px] rounded-bl-md border border-black/[0.06] bg-paper px-3.5 py-2.5 text-[15px] leading-relaxed text-ink">
          {turn.content}
        </div>
      </div>
    </div>
  );
}
