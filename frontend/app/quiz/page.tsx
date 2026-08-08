"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useFlip } from "@/lib/prefs";
import { langLabel } from "@/lib/langs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Confetti } from "@/components/Confetti";
import { CollectionSelect } from "@/components/CollectionSelect";
import { EditWordModal } from "@/components/EditWordModal";
import { PairMultiSelect } from "@/components/PairMultiSelect";
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
  cloze?: boolean; // fill-the-blank in an example sentence
  clozeTranslation?: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Words whose example sentence literally contains the target word — usable for
// fill-in-the-blank (cloze) practice.
function clozeEligible(pool: Word[]): Word[] {
  return pool.filter((w) => {
    const ex = w.examples[0];
    return Boolean(ex?.sentenceEn && ex.sentenceEn.toLowerCase().includes(w.word.toLowerCase()));
  });
}

function buildCloze(pool: Word[]): Question[] {
  return shuffle(clozeEligible(pool))
    .slice(0, 8)
    .map((w) => {
      const ex = w.examples[0];
      const blanked = ex.sentenceEn.replace(new RegExp(escapeRegExp(w.word), "i"), "＿＿＿");
      return {
        word: w,
        prompt: blanked,
        options: [],
        correct: w.word,
        promptTarget: true,
        optionsTarget: false,
        cloze: true,
        clozeTranslation: ex.sentenceZh,
      };
    });
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
  const { t } = useI18n();
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
  const [mode, setMode] = useState<"choice" | "type" | "cloze">("choice");
  const [quiz, setQuiz] = useState<Question[]>([]);
  const [editing, setEditing] = useState<Word | null>(null);
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

  const clozePool = clozeEligible(pool);
  const canStart = mode === "cloze" ? clozePool.length >= 1 : pool.length >= 4;

  function start() {
    setQuiz(mode === "cloze" ? buildCloze(pool) : buildQuiz(pool, flip));
    setIndex(0);
    setSelected(null);
    setTyped("");
    setScore(0);
    setStarted(true);
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
        <h2 className="mt-4 font-serif text-[26px] font-medium text-ink">{t("quiz.notEnough")}</h2>
        <p className="mt-2 text-ink-soft">
          {t("quiz.notEnoughText")}{" "}
          <Link href="/words" className="font-semibold text-sage hover:text-sage-deep">
            {t("quiz.addMore")}
          </Link>
        </p>
      </div>
    );

  // ---------------- Setup ----------------
  if (!started) {
    return (
      <div className="mx-auto max-w-[520px] space-y-6">
        <h2 className="font-serif text-[28px] font-medium text-ink">{t("quiz.title")}</h2>
        <div className="rounded-[20px] border border-black/[0.06] bg-surface p-5 space-y-4">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("review.direction")}</p>
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
                  {v ? t("review.meaningToWord") : t("review.wordToMeaning")}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("quiz.answerMode")}</p>
            <div className="flex flex-wrap gap-1 rounded-full bg-black/[0.04] p-1 text-sm font-semibold w-fit">
              {(["choice", "type", "cloze"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded-full px-3 py-1 transition-colors",
                    mode === m ? "bg-sage text-white" : "text-ink-muted",
                  )}
                >
                  {m === "choice" ? t("quiz.choice") : m === "type" ? t("quiz.type") : t("quiz.cloze")}
                </button>
              ))}
            </div>
            {mode === "cloze" && (
              <p className="mt-1.5 text-[12px] text-ink-faint">{t("quiz.clozeHint")}</p>
            )}
          </div>

          {collections && collections.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {t("review.collection")}
              </p>
              <CollectionSelect options={collections} value={selColl} onChange={setSelColl} />
            </div>
          )}

          {allPairs.length > 1 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {t("review.pairs")}
              </p>
              <PairMultiSelect pairs={allPairs} selected={sel} onChange={setSelPairs} />
            </div>
          )}
        </div>
        <Button className="w-full" disabled={!canStart} onClick={start}>
          {!canStart
            ? mode === "cloze"
              ? t("quiz.needExamples")
              : t("quiz.needFour")
            : t("quiz.start", { n: Math.min(mode === "cloze" ? clozePool.length : pool.length, 8) })}
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
        <h2 className="mt-4 font-serif text-[32px] font-medium text-ink">{t("quiz.done")}</h2>
        <p className="mt-2 text-ink-soft">{t("quiz.score", { x: score, y: total })}</p>
        <Button variant="dark" className="mt-7" onClick={() => setStarted(false)}>
          {t("review.backToSetup")}
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

  const promptHint = q.cloze
    ? t("quiz.fillBlank")
    : flip
      ? t("quiz.whichWord", { lang: langLabel(q.word.sourceLang) })
      : t("quiz.pickMeaning", { lang: langLabel(q.word.targetLang) });

  return (
    <div className="mx-auto max-w-[620px]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-[28px] font-medium text-ink">{t("quiz.title")}</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setEditing(q.word)}
            className="rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
          >
            ✎ {t("edit.editCard")}
          </button>
          <button
            onClick={() => setStarted(false)}
            className="rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
          >
            {t("review.setup")}
          </button>
          <span className="text-[13px] font-semibold text-ink-faint">
            {index + 1} / {total}
          </span>
        </div>
      </div>

      {editing && (
        <EditWordModal
          word={editing}
          onClose={() => setEditing(null)}
          onUpdated={(u) => {
            setQuiz((qs) => qs.map((item) => (item.word.id === u.id ? { ...item, word: u } : item)));
            setEditing(u);
          }}
        />
      )}

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
        {q.cloze ? (
          <>
            <div className={cn("mt-3 font-serif text-[24px] leading-relaxed text-ink", tFont)}>{q.prompt}</div>
            {q.clozeTranslation && (
              <div className="mt-2 text-[14px] text-ink-faint">{q.clozeTranslation}</div>
            )}
          </>
        ) : (
          <div
            className={cn(
              "mt-2.5 font-bold leading-tight text-sage-deep",
              q.promptTarget ? cn("text-[44px]", tFont) : "font-serif text-[40px] text-ink",
            )}
          >
            {q.prompt}
          </div>
        )}
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
            placeholder={t("quiz.typeAnswer", { lang: langLabel(q.optionsTarget ? q.word.targetLang : q.word.sourceLang) })}
            className={cn(
              "h-14 flex-1 text-[18px]",
              q.optionsTarget && tFont,
              answered && (correct ? "border-sage" : "border-warn"),
            )}
          />
          {!answered && (
            <Button type="submit" size="lg" disabled={!typed.trim()} className="shrink-0">
              {t("quiz.check")}
            </Button>
          )}
        </form>
      )}

      {answered && (
        <div className="anim-fade-up mt-4">
          <div className="rounded-[18px] bg-sage-tint p-5">
            <p className={cn("text-base font-semibold", correct ? "text-sage-deep" : "text-warn-text")}>
              {correct ? t("quiz.right") : t("quiz.wrong", { answer: q.correct })}
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
            {index + 1 >= total ? t("quiz.seeResults") : t("quiz.next")}
          </Button>
        </div>
      )}
    </div>
  );
}
