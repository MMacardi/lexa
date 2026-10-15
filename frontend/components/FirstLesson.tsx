"use client";

import { useMemo, useState } from "react";
import type { LessonWord } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { ExampleText } from "@/components/ExampleText";
import { Pinyin } from "@/components/Pinyin";
import { SpeakButton } from "@/components/SpeakButton";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// The lesson before sign-in (BACKLOG 1h "Learn before the wall"): five of the deck's
// words, a screen each — the word, its sound, its meaning and a sentence at the
// guest's level with the pinyin over it — then a minute's review. Duolingo's first
// lesson comes before the account for this reason: the account is for keeping
// something already learned. The words come from POST /api/public/hsk/lesson.

/** The words one at a time; `onDone` after the last. */
export function LessonCards({ words, onDone }: { words: LessonWord[]; onDone: () => void }) {
  const { t } = useI18n();
  const [i, setI] = useState(0);
  const w = words[i];
  const last = i === words.length - 1;
  return (
    <div>
      <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        {t("lesson.count", { n: i + 1, of: words.length })}
      </p>
      <div key={w.word} className="anim-fade-up">
        <div className="rounded-[18px] border border-black/[0.06] bg-surface p-5 text-center">
          <div className="font-zh text-[44px] font-medium leading-tight text-ink">{w.word}</div>
          <div className="mt-1 flex items-center justify-center gap-2">
            <Pinyin text={w.pinyin} className="text-[17px]" />
            <SpeakButton text={w.word} lang="zh" size="sm" />
          </div>
          {w.meaning && <p className="mt-2 text-[16px] font-semibold text-ink">{w.meaning}</p>}
        </div>
        {w.sentence && (
          <div className="mt-3 rounded-[16px] bg-sage-tint/50 px-4 py-3">
            <p className="font-zh text-[19px] text-ink">
              <ExampleText text={w.sentence.zh} word={w.word} lang="zh" pinyin />
              <SpeakButton text={w.sentence.zh} lang="zh" size="inline" className="ml-1" />
            </p>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{w.sentence.tr}</p>
          </div>
        )}
      </div>
      <Button className="mt-5 w-full sm:w-auto" onClick={() => (last ? onDone() : setI(i + 1))}>
        {last ? t("lesson.toQuiz") : t("lesson.next")}
        <ArrowRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * The minute's review: each word's meaning out of four — the other lesson words'
 * meanings, the ones just learned beside it. A right answer moves on by itself; a
 * miss shows the right one, waits for "Next" and comes back at the end. `onDone`
 * gets how many were right the first time.
 */
export function LessonQuiz({ words, onDone }: { words: LessonWord[]; onDone: (rightFirst: number) => void }) {
  const { t } = useI18n();
  const asked = useMemo(() => words.filter((w) => w.meaning), [words]);
  // Indexes into `asked`, the one on screen first; `turn` counts screens, so the
  // same word coming back gets its options shuffled anew.
  const [queue, setQueue] = useState(() => asked.map((_, i) => i));
  const [turn, setTurn] = useState(0);
  const [missed, setMissed] = useState<Set<number>>(new Set());
  const [picked, setPicked] = useState<string | null>(null);
  const cur = queue.length ? asked[queue[0]] : null;
  const options = useMemo(() => {
    if (!cur?.meaning) return [];
    const others = [...new Set(asked.map((w) => w.meaning!).filter((m) => m !== cur.meaning))];
    return shuffle([cur.meaning, ...shuffle(others).slice(0, 3)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, asked]);

  function advance(again: boolean) {
    const rest = again ? [...queue.slice(1), queue[0]] : queue.slice(1);
    setPicked(null);
    setTurn((n) => n + 1);
    // Only a right answer can empty the queue, and a miss is in `missed` by then.
    if (!rest.length) onDone(asked.length - missed.size);
    else setQueue(rest);
  }

  function answer(opt: string) {
    if (!cur || picked) return;
    setPicked(opt);
    if (opt === cur.meaning) window.setTimeout(() => advance(false), 650);
    else setMissed((s) => new Set(s).add(queue[0]));
  }

  if (!cur) return null;
  const done = asked.filter((_, i) => !queue.includes(i)).length;
  const wrong = picked !== null && picked !== cur.meaning;
  return (
    <div>
      {/* a dot a word, filled once it is answered right */}
      <div className="mb-3 flex gap-1.5" aria-label={t("lesson.left", { n: queue.length })}>
        {asked.map((_, i) => (
          <span key={i} className={cn("h-1.5 flex-1 rounded-full transition-colors", i < done ? "bg-sage" : "bg-black/[0.08]")} />
        ))}
      </div>
      <div key={turn} className="anim-fade-up rounded-[18px] border border-black/[0.06] bg-surface p-4 text-center sm:p-6">
        <p className="text-[15px] text-ink-soft">{t("lesson.quizQ")}</p>
        <div className="mt-1 font-zh text-[40px] font-medium text-ink">{cur.word}</div>
        <div className={cn("h-6 transition-opacity", picked ? "opacity-100" : "opacity-0")}>
          <Pinyin text={cur.pinyin} className="text-[15px]" />
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {options.map((opt) => {
            const right = opt === cur.meaning;
            return (
              <button
                key={opt}
                type="button"
                disabled={!!picked}
                onClick={() => answer(opt)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-[14px] border px-4 py-3 text-left text-[15px] font-medium transition-colors",
                  picked && right
                    ? "border-sage bg-sage-tint text-sage-deep"
                    : picked === opt
                      ? "border-warn bg-warn-bg text-warn-text"
                      : "border-black/[0.08] bg-surface text-ink hover:border-sage/60",
                )}
              >
                {opt}
                {picked && right && <Check className="h-4 w-4 shrink-0" />}
              </button>
            );
          })}
        </div>
        {wrong && (
          <div className="mt-4 space-y-3">
            <p className="text-[14px] text-ink-soft">{t("lesson.again")}</p>
            <Button onClick={() => advance(true)}>
              {t("lesson.next")}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
