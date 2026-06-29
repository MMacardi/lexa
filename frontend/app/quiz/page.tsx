"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useFlip } from "@/lib/prefs";
import { langLabel, pairLabel } from "@/lib/langs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Confetti } from "@/components/Confetti";
import { cn } from "@/lib/utils";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const targetFont = (lang: string) => (lang === "zh" ? "font-zh" : "");
const pairKey = (w: Word) => `${w.sourceLang}>${w.targetLang}`;

interface Question {
  word: Word;
  prompt: string;
  options: string[];
  correct: string;
  promptTarget: boolean;
  optionsTarget: boolean;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQuiz(pool: Word[], flip: boolean): Question[] {
  const eligible = pool.filter((w) => w.meaningZh);
  return shuffle(eligible)
    .slice(0, 8)
    .map((w) => {
      const others = shuffle(eligible.filter((x) => x.id !== w.id)).slice(0, 3);
      if (flip) {
        return {
          word: w,
          prompt: w.meaningZh as string,
          options: shuffle([w.word, ...others.map((x) => x.word)]),
          correct: w.word,
          promptTarget: true,
          optionsTarget: false,
        };
      }
      return {
        word: w,
        prompt: w.word,
        options: shuffle([w.meaningZh as string, ...others.map((x) => x.meaningZh as string)]),
        correct: w.meaningZh as string,
        promptTarget: false,
        optionsTarget: true,
      };
    });
}

export default function QuizPage() {
  const { accountId } = useAccount();
  const qc = useQueryClient();
  const [flip, setFlip] = useFlip("vocab.flip.quiz");
  const { data: allWords, isLoading } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
  });

  const { data: collections } = useQuery({
    queryKey: ["collections", accountId],
    queryFn: () => api.collections(accountId),
  });

  const [started, setStarted] = useState(false);
  const [selPairs, setSelPairs] = useState<string[] | null>(null);
  const [selColl, setSelColl] = useState<string>("all");
  const [mode, setMode] = useState<"choice" | "type">("choice");
  const [quiz, setQuiz] = useState<Question[]>([]);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [score, setScore] = useState(0);

  const words = allWords ?? [];
  const allPairs = Array.from(new Set(words.map(pairKey)));
  const sel = selPairs ?? allPairs;

  useEffect(() => {
    if (selPairs === null && allWords) setSelPairs(allPairs);
  }, [allWords, selPairs, allPairs]);

  const review = useMutation({
    mutationFn: (id: string) => api.reviewWord(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  const inColl = (w: Word) =>
    selColl === "all" || (w.collections ?? []).some((c) => c.id === selColl);
  const pool = words.filter((w) => w.meaningZh && sel.includes(pairKey(w)) && inColl(w));

  // Preset the collection from a ?coll= deep link.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("coll");
    if (c) setSelColl(c);
  }, []);

  function start() {
    setQuiz(buildQuiz(pool, flip));
    setIndex(0);
    setSelected(null);
    setTyped("");
    setScore(0);
    setStarted(true);
  }
  function togglePair(p: string) {
    setSelPairs(sel.includes(p) ? sel.filter((x) => x !== p) : [...sel, p]);
  }

  if (isLoading)
    return (
      <div className="mx-auto max-w-[620px] space-y-4">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-40 rounded-[24px]" />
      </div>
    );

  if (words.length < 4)
    return (
      <div className="mx-auto max-w-[480px] rounded-[24px] border border-black/[0.06] bg-surface p-10 text-center">
        <div className="text-3xl">📚</div>
        <h2 className="mt-4 font-serif text-[26px] font-medium text-ink">Not enough words yet</h2>
        <p className="mt-2 text-ink-soft">
          You need at least 4 words for a recall check.{" "}
          <Link href="/words" className="font-semibold text-sage hover:text-sage-deep">
            Add more →
          </Link>
        </p>
      </div>
    );

  // ---------------- Setup ----------------
  if (!started) {
    return (
      <div className="mx-auto max-w-[520px] space-y-6">
        <h2 className="font-serif text-[28px] font-medium text-ink">Recall check</h2>
        <div className="rounded-[20px] border border-black/[0.06] bg-surface p-5 space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Direction</p>
            <div className="flex gap-1 rounded-full bg-black/[0.04] p-1 text-sm font-semibold w-fit">
              {[false, true].map((v) => (
                <button
                  key={String(v)}
                  onClick={() => setFlip(v)}
                  className={cn(
                    "rounded-full px-3 py-1 transition-colors",
                    flip === v ? "bg-sage text-white" : "text-ink-muted",
                  )}
                >
                  {v ? "Meaning → Word" : "Word → Meaning"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">Answer mode</p>
            <div className="flex gap-1 rounded-full bg-black/[0.04] p-1 text-sm font-semibold w-fit">
              {(["choice", "type"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded-full px-3 py-1 transition-colors",
                    mode === m ? "bg-sage text-white" : "text-ink-muted",
                  )}
                >
                  {m === "choice" ? "Multiple choice" : "Type it"}
                </button>
              ))}
            </div>
          </div>

          {collections && collections.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Collection
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setSelColl("all")}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                    selColl === "all"
                      ? "bg-sage text-white"
                      : "border border-black/[0.07] bg-surface text-ink-muted hover:bg-black/[0.03]",
                  )}
                >
                  All words
                </button>
                {collections.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSelColl(c.id)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                      selColl === c.id
                        ? "bg-sage text-white"
                        : "border border-black/[0.07] bg-surface text-ink-muted hover:bg-black/[0.03]",
                    )}
                  >
                    {c.name} <span className="opacity-70">{c.count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {allPairs.length > 1 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                Language pairs
              </p>
              <div className="flex flex-wrap gap-2">
                {allPairs.map((p) => {
                  const [s, t] = p.split(">");
                  const on = sel.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => togglePair(p)}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                        on
                          ? "bg-sage text-white"
                          : "border border-black/[0.07] bg-surface text-ink-muted hover:bg-black/[0.03]",
                      )}
                    >
                      {on ? "✓ " : ""}
                      {pairLabel(s, t)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <Button className="w-full" disabled={pool.length < 4} onClick={start}>
          {pool.length < 4
            ? "Need at least 4 words in this selection"
            : `Start — ${Math.min(pool.length, 8)} questions →`}
        </Button>
      </div>
    );
  }

  const total = quiz.length;

  if (index >= total)
    return (
      <div className="anim-pop mx-auto flex max-w-[480px] flex-col items-center rounded-[24px] border border-black/[0.06] bg-surface p-10 text-center">
        {score / total >= 0.6 && <Confetti />}
        <div className="text-4xl">🎯</div>
        <h2 className="mt-4 font-serif text-[32px] font-medium text-ink">Recall check done</h2>
        <p className="mt-2 text-ink-soft">
          You got <span className="font-semibold text-sage-deep">{score}</span> of {total} right.
        </p>
        <Button variant="dark" className="mt-7" onClick={() => setStarted(false)}>
          Back to setup
        </Button>
      </div>
    );

  const q = quiz[index];
  const answered = selected !== null;
  const correct = answered && selected === q.correct;
  const tFont = targetFont(q.word.targetLang);

  function choose(opt: string) {
    if (selected !== null) return;
    setSelected(opt);
    if (opt === q.correct) {
      setScore((s) => s + 1);
      review.mutate(q.word.id);
    }
  }
  function submitTyped() {
    if (selected !== null || !typed.trim()) return;
    const ok = norm(typed) === norm(q.correct);
    setSelected(ok ? q.correct : typed.trim());
    if (ok) {
      setScore((s) => s + 1);
      review.mutate(q.word.id);
    }
  }
  function next() {
    setSelected(null);
    setTyped("");
    setIndex((i) => i + 1);
  }

  const promptHint = flip
    ? `Which ${langLabel(q.word.sourceLang)} word means:`
    : `Pick the ${langLabel(q.word.targetLang)} meaning of:`;

  return (
    <div className="mx-auto max-w-[620px]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-[28px] font-medium text-ink">Recall check</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setStarted(false)}
            className="rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
          >
            ⚙ Setup
          </button>
          <span className="text-[13px] font-semibold text-ink-faint">
            {index + 1} / {total}
          </span>
        </div>
      </div>

      <div className="mt-4 h-[7px] overflow-hidden rounded-full bg-track">
        <div
          className="h-full rounded-full bg-sage transition-[width] duration-300"
          style={{ width: `${(index / total) * 100}%` }}
        />
      </div>

      <div
        key={index}
        className="anim-pop mt-5 rounded-[24px] border border-black/[0.06] bg-surface p-9 text-center"
      >
        <div className="text-sm font-medium text-ink-soft">{promptHint}</div>
        <div
          className={cn(
            "mt-2.5 font-bold leading-tight text-sage-deep",
            q.promptTarget ? cn("text-[44px]", tFont) : "font-serif text-[40px] text-ink",
          )}
        >
          {q.prompt}
        </div>
      </div>

      {mode === "choice" ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {q.options.map((opt) => {
            const isCorrect = opt === q.correct;
            const isChosen = opt === selected;
            let style = "border-black/[0.08] bg-surface text-ink";
            let mark = "";
            if (answered) {
              if (isCorrect) {
                style = "border-sage bg-sage-tint text-sage-deep";
                mark = "✓";
              } else if (isChosen) {
                style = "border-warn bg-warn-bg text-warn-text";
                mark = "✗";
              } else {
                style = "border-black/[0.05] bg-paper text-ink-faint";
              }
            }
            return (
              <button
                key={opt}
                onClick={() => choose(opt)}
                disabled={answered}
                className={cn(
                  "flex items-center justify-between rounded-[18px] border px-6 py-5 text-[20px] font-semibold transition-all",
                  style,
                  q.optionsTarget && tFont,
                  !answered && "hover:border-sage hover:bg-sage-tint/40 active:scale-[0.99]",
                )}
              >
                <span>{opt}</span>
                <span className="text-xl font-bold">{mark}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submitTyped();
          }}
        >
          <Input
            autoFocus
            value={typed}
            disabled={answered}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={`Type the ${langLabel(q.optionsTarget ? q.word.targetLang : q.word.sourceLang)} answer…`}
            className={cn(
              "h-14 flex-1 text-[18px]",
              q.optionsTarget && tFont,
              answered && (correct ? "border-sage" : "border-warn"),
            )}
          />
          {!answered && (
            <Button type="submit" size="lg" disabled={!typed.trim()} className="shrink-0">
              Check
            </Button>
          )}
        </form>
      )}

      {answered && (
        <div className="anim-fade-up mt-4">
          <div className="rounded-[18px] bg-sage-tint p-5">
            <p className={cn("text-base font-semibold", correct ? "text-sage-deep" : "text-warn-text")}>
              {correct ? "Exactly right." : `Not quite — the answer is “${q.correct}”.`}
            </p>
            {q.word.examples[0] && (
              <p className="mt-2.5 font-serif text-[17px] leading-relaxed text-quote">
                “{q.word.examples[0].sentenceEn}”
                {q.word.examples[0].sentenceZh && (
                  <span className={cn("mt-1 block text-sm not-italic text-ink-soft", tFont)}>
                    {q.word.examples[0].sentenceZh}
                  </span>
                )}
              </p>
            )}
          </div>
          <Button variant="dark" className="mt-4 w-full" onClick={next}>
            {index + 1 >= total ? "See results" : "Next question →"}
          </Button>
        </div>
      )}
    </div>
  );
}
