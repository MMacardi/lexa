"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface Question {
  word: Word;
  prompt: string;
  options: string[];
  correct: string;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildQuiz(words: Word[]): Question[] {
  const eligible = words.filter((w) => w.meaningZh);
  return shuffle(eligible)
    .slice(0, 8)
    .map((w) => {
      const distractors = shuffle(words.filter((x) => x.id !== w.id))
        .slice(0, 3)
        .map((x) => x.word);
      return {
        word: w,
        prompt: w.meaningZh as string,
        options: shuffle([w.word, ...distractors]),
        correct: w.word,
      };
    });
}

export default function QuizPage() {
  const { accountId } = useAccount();
  const qc = useQueryClient();
  const { data: allWords, isLoading } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
  });

  const [quiz, setQuiz] = useState<Question[] | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [score, setScore] = useState(0);

  useEffect(() => {
    if (quiz === null && allWords && allWords.length >= 4) setQuiz(buildQuiz(allWords));
  }, [allWords, quiz]);

  const review = useMutation({
    mutationFn: (id: string) => api.reviewWord(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["words"] }),
  });

  if (isLoading)
    return (
      <div className="mx-auto max-w-[620px] space-y-4">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-40 rounded-[24px]" />
      </div>
    );

  if (!allWords || allWords.length < 4)
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

  if (!quiz)
    return <Skeleton className="mx-auto h-40 max-w-[620px] rounded-[24px]" />;

  const total = quiz.length;

  if (index >= total)
    return (
      <div className="anim-pop mx-auto flex max-w-[480px] flex-col items-center rounded-[24px] border border-black/[0.06] bg-surface p-10 text-center">
        <div className="text-4xl">🎯</div>
        <h2 className="mt-4 font-serif text-[32px] font-medium text-ink">Recall check done</h2>
        <p className="mt-2 text-ink-soft">
          You got <span className="font-semibold text-sage-deep">{score}</span> of {total} right.
        </p>
        <Button
          variant="dark"
          className="mt-7"
          onClick={() => {
            setQuiz(buildQuiz(allWords));
            setIndex(0);
            setSelected(null);
            setScore(0);
          }}
        >
          Try again
        </Button>
      </div>
    );

  const q = quiz[index];
  const answered = selected !== null;
  const correct = answered && selected === q.correct;

  function choose(opt: string) {
    if (selected !== null) return;
    setSelected(opt);
    if (opt === q.correct) {
      setScore((s) => s + 1);
      review.mutate(q.word.id);
    }
  }

  function next() {
    setSelected(null);
    setIndex((i) => i + 1);
  }

  return (
    <div className="mx-auto max-w-[620px]">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-[28px] font-medium text-ink">Recall check</h2>
        <div className="flex items-center gap-1.5">
          {quiz.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === index ? "w-5 bg-sage" : i < index ? "w-1.5 bg-sage" : "w-1.5 bg-dot-empty",
              )}
            />
          ))}
          <span className="ml-2 text-[13px] font-semibold text-ink-faint">
            {index + 1} / {total}
          </span>
        </div>
      </div>

      <div
        key={index}
        className="anim-pop mt-5 rounded-[24px] border border-black/[0.06] bg-surface p-9 text-center"
      >
        <div className="text-sm font-medium text-ink-soft">Which English word means</div>
        <div className="mt-2.5 font-zh text-[48px] font-bold leading-tight text-sage-deep">
          {q.prompt}
        </div>
      </div>

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
              style = "border-black/[0.05] bg-[#faf8f4] text-[#b3aa9a]";
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
                !answered && "hover:border-sage hover:bg-sage-tint/40 active:scale-[0.99]",
              )}
            >
              <span>{opt}</span>
              <span className="text-xl font-bold">{mark}</span>
            </button>
          );
        })}
      </div>

      {answered && (
        <div className="anim-fade-up mt-4">
          <div className="rounded-[18px] bg-sage-tint p-5">
            <p
              className={cn(
                "text-base font-semibold",
                correct ? "text-sage-deep" : "text-warn-text",
              )}
            >
              {correct ? "Exactly right." : `Not quite — the answer is “${q.correct}”.`}
            </p>
            {q.word.examples[0] && (
              <p className="mt-2.5 font-serif text-[17px] leading-relaxed text-[#544e45]">
                “{q.word.examples[0].sentenceEn}”
                <span className="mt-1 block font-zh text-sm not-italic text-ink-soft">
                  {q.word.examples[0].sentenceZh}
                </span>
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
