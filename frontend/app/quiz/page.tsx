"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useFlip } from "@/lib/prefs";
import { langLabel, pairLabel } from "@/lib/langs";
import { getRecentPairs } from "@/lib/learnPrefs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Confetti } from "@/components/Confetti";
import { CollectionSelect } from "@/components/CollectionSelect";
import { EditWordModal } from "@/components/EditWordModal";
import { PairMultiSelect } from "@/components/PairMultiSelect";
import { QuickChip } from "@/components/ui/QuickChip";
import { HighlightWord } from "@/components/HighlightWord";
import { cn } from "@/lib/utils";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const targetFont = (lang: string) => (lang === "zh" || lang === "zh-Hant" ? "font-zh" : "");
const pairKey = (w: Word) => `${w.sourceLang}>${w.targetLang}`;

type QKind = "choice" | "type" | "cloze";
type QuizMode = "choice" | "type" | "cloze" | "mixed";

interface Question {
  word: Word;
  prompt: string;
  options: string[];
  correct: string;
  promptTarget: boolean;
  optionsTarget: boolean;
  kind: QKind;
  clozeTranslation?: string;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Is this word usable for fill-in-the-blank (its example contains the word)?
function isClozeEligible(w: Word): boolean {
  const ex = w.examples[0];
  return Boolean(ex?.sentenceEn && ex.sentenceEn.toLowerCase().includes(w.word.toLowerCase()));
}

function clozeEligible(pool: Word[]): Word[] {
  return pool.filter(isClozeEligible);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Build a single question of a given kind for a word.
// Pick up to 3 distractor words that won't be confusable with the target:
// different meaning, and not a synonym of it (nor it a synonym of them) — so a
// word→meaning question never has two arguably-correct options.
function distractors(w: Word, eligible: Word[]): Word[] {
  const tgtMeaning = norm(w.meaningZh ?? "");
  const tgtLc = w.word.trim().toLowerCase();
  const synSet = new Set([tgtLc, ...(w.synonyms ?? []).map((s) => s.trim().toLowerCase())]);
  const differentMeaning = eligible.filter((x) => x.id !== w.id && norm(x.meaningZh ?? "") !== tgtMeaning);
  const strict = differentMeaning.filter(
    (x) => !synSet.has(x.word.trim().toLowerCase()) && !(x.synonyms ?? []).some((s) => s.trim().toLowerCase() === tgtLc),
  );
  const picked = shuffle(strict).slice(0, 3);
  // Top up (still different meaning) if the strict pool was too small.
  if (picked.length < 3) {
    for (const x of shuffle(differentMeaning)) {
      if (picked.length >= 3) break;
      if (!picked.includes(x)) picked.push(x);
    }
  }
  return picked;
}

// Options with no duplicate labels (two words can share a meaning string).
function uniqueOptions(correct: string, distract: string[]): string[] {
  const seen = new Set([norm(correct)]);
  const out = [correct];
  for (const d of distract) {
    if (!seen.has(norm(d))) {
      seen.add(norm(d));
      out.push(d);
    }
  }
  return shuffle(out);
}

function makeQuestion(w: Word, eligible: Word[], flip: boolean, kind: QKind): Question {
  if (kind === "cloze") {
    const ex = w.examples[0];
    const blanked = ex.sentenceEn.replace(new RegExp(escapeRegExp(w.word), "i"), "＿＿＿");
    return {
      word: w,
      prompt: blanked,
      options: [],
      correct: w.word,
      promptTarget: true,
      optionsTarget: false,
      kind: "cloze",
      clozeTranslation: ex.sentenceZh,
    };
  }
  const others = distractors(w, eligible);
  if (flip) {
    return {
      word: w,
      prompt: w.meaningZh as string,
      options: kind === "choice" ? uniqueOptions(w.word, others.map((x) => x.word)) : [],
      correct: w.word,
      promptTarget: true,
      optionsTarget: false,
      kind,
    };
  }
  return {
    word: w,
    prompt: w.word,
    options: kind === "choice" ? uniqueOptions(w.meaningZh as string, others.map((x) => x.meaningZh as string)) : [],
    correct: w.meaningZh as string,
    promptTarget: false,
    optionsTarget: true,
    kind,
  };
}

// Pick a random format for a word in a mixed session (only formats it supports).
function pickKind(w: Word, eligible: Word[]): QKind {
  const opts: QKind[] = ["type"];
  if (eligible.length >= 4) opts.push("choice");
  if (isClozeEligible(w)) opts.push("cloze");
  return opts[Math.floor(Math.random() * opts.length)];
}

function buildSession(pool: Word[], flip: boolean, mode: QuizMode): Question[] {
  const eligible = pool.filter((w) => w.meaningZh);
  if (mode === "cloze") {
    return shuffle(clozeEligible(pool))
      .slice(0, 8)
      .map((w) => makeQuestion(w, eligible, flip, "cloze"));
  }
  return shuffle(eligible)
    .slice(0, 8)
    .map((w) => {
      let kind: QKind = mode === "mixed" ? pickKind(w, eligible) : mode;
      if (kind === "choice" && eligible.length < 4) kind = "type"; // not enough distractors
      if (kind === "cloze" && !isClozeEligible(w)) kind = "type";
      return makeQuestion(w, eligible, flip, kind);
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
  const [mode, setMode] = useState<QuizMode>("choice");
  const [quiz, setQuiz] = useState<Question[]>([]);
  const [editing, setEditing] = useState<Word | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [score, setScore] = useState(0);

  const words = allWords ?? [];
  const allPairs = Array.from(new Set(words.map(pairKey)));
  // Nothing selected by default — pick via the dropdown or the quick chips below.
  const sel = selPairs ?? [];

  const quickPairs = (() => {
    const recent = getRecentPairs().map((p) => `${p.s}>${p.t}`);
    const ordered = [...allPairs].sort((a, b) => {
      const ia = recent.indexOf(a);
      const ib = recent.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return ordered.slice(0, 5);
  })();
  const togglePair = (pk: string) =>
    setSelPairs(sel.includes(pk) ? sel.filter((x) => x !== pk) : [...sel, pk]);

  const review = useMutation({
    mutationFn: ({ id, grade }: { id: string; grade: number }) => api.reviewWord(id, grade),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  // Keyboard shortcuts: 1–4 pick an answer (choice mode), Enter/Space continues
  // once answered. Registered before early returns so hook order stays stable.
  useEffect(() => {
    if (!started) return;
    const q = quiz[index];
    if (!q) return;
    const answered = selected !== null;
    const onKey = (e: KeyboardEvent) => {
      if (answered && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        setSelected(null);
        setTyped("");
        setIndex((i) => i + 1);
        return;
      }
      if (!answered && q.kind === "choice" && /^[1-4]$/.test(e.key)) {
        const opt = q.options[Number(e.key) - 1];
        if (opt === undefined) return;
        e.preventDefault();
        setSelected(opt);
        const ok = opt === q.correct;
        if (ok) setScore((s) => s + 1);
        review.mutate({ id: q.word.id, grade: ok ? 3 : 1 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, quiz, index, selected, mode, review]);

  const inColl = (w: Word) =>
    selColl === "all" || (w.collections ?? []).some((c) => c.id === selColl);
  const pool = words.filter((w) => w.meaningZh && sel.includes(pairKey(w)) && inColl(w));

  // Preset the collection from a ?coll= deep link.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("coll");
    if (c) setSelColl(c);
  }, []);

  const clozePool = clozeEligible(pool);
  const canStart =
    mode === "cloze" ? clozePool.length >= 1 : mode === "mixed" ? pool.length >= 1 : pool.length >= 4;

  function start() {
    setQuiz(buildSession(pool, flip, mode));
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
              {(["choice", "type", "cloze", "mixed"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "rounded-full px-3 py-1 transition-colors",
                    mode === m ? "bg-sage text-white" : "text-ink-muted",
                  )}
                >
                  {m === "choice"
                    ? t("quiz.choice")
                    : m === "type"
                      ? t("quiz.type")
                      : m === "cloze"
                        ? t("quiz.cloze")
                        : t("quiz.mixed")}
                </button>
              ))}
            </div>
            {mode === "cloze" && <p className="mt-1.5 text-[12px] text-ink-faint">{t("quiz.clozeHint")}</p>}
            {mode === "mixed" && <p className="mt-1.5 text-[12px] text-ink-faint">{t("quiz.mixedHint")}</p>}
          </div>

          {collections && collections.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {t("review.collection")}
              </p>
              <CollectionSelect options={collections} value={selColl} onChange={setSelColl} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <QuickChip active={selColl === "all"} onClick={() => setSelColl("all")}>
                  {t("common.allWords")}
                </QuickChip>
                {collections.slice(0, 5).map((c) => (
                  <QuickChip key={c.id} active={selColl === c.id} onClick={() => setSelColl(c.id)}>
                    {c.name}
                  </QuickChip>
                ))}
              </div>
            </div>
          )}

          {allPairs.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {t("review.pairs")}
              </p>
              {allPairs.length > 1 && (
                <PairMultiSelect pairs={allPairs} selected={sel} onChange={setSelPairs} />
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {quickPairs.map((pk) => {
                  const [s, tg] = pk.split(">");
                  return (
                    <QuickChip key={pk} active={sel.includes(pk)} onClick={() => togglePair(pk)}>
                      {pairLabel(s, tg)}
                    </QuickChip>
                  );
                })}
              </div>
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
    const ok = opt === q.correct;
    if (ok) setScore((s) => s + 1);
    review.mutate({ id: q.word.id, grade: ok ? 3 : 1 }); // Good on right, Again on wrong
  }
  function submitTyped() {
    if (selected !== null || !typed.trim()) return;
    const ok = norm(typed) === norm(q.correct);
    setSelected(ok ? q.correct : typed.trim());
    if (ok) setScore((s) => s + 1);
    review.mutate({ id: q.word.id, grade: ok ? 3 : 1 });
  }
  function next() {
    setSelected(null);
    setTyped("");
    setIndex((i) => i + 1);
  }

  const promptHint =
    q.kind === "cloze"
      ? t("quiz.fillBlank")
      : flip
        ? t("quiz.whichWord", { lang: langLabel(q.word.sourceLang) })
        : t("quiz.pickMeaning", { lang: langLabel(q.word.targetLang) });

  return (
    <div className="mx-auto max-w-[620px]">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-serif text-[22px] font-medium text-ink sm:text-[28px]">{t("quiz.title")}</h2>
        <div className="flex items-center gap-2 sm:gap-3">
          <button
            onClick={() => setEditing(q.word)}
            className="rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
          >
            ✎ <span className="hidden sm:inline">{t("edit.editCard")}</span>
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
        {q.kind === "cloze" ? (
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

      {q.kind === "choice" ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {q.options.map((opt, i) => {
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
                  "flex items-center justify-between gap-3 rounded-[18px] border px-5 py-4 text-left text-[19px] font-semibold transition-all",
                  style,
                  q.optionsTarget && tFont,
                  !answered && "hover:border-sage hover:bg-sage-tint/40 active:scale-[0.99]",
                )}
              >
                <span className="flex min-w-0 items-start gap-3">
                  {!answered && (
                    <span className="mt-0.5 hidden h-6 w-6 shrink-0 items-center justify-center rounded-[7px] border border-black/[0.08] bg-black/[0.03] text-[12px] font-bold text-ink-faint sm:flex">
                      {i + 1}
                    </span>
                  )}
                  <span className="min-w-0 break-words leading-snug">{opt}</span>
                </span>
                <span className="shrink-0 text-xl font-bold">{mark}</span>
              </button>
            );
          })}
          {!answered && (
            <p className="col-span-full hidden text-center text-[12px] text-ink-faint sm:block">
              {t("quiz.hotkeysPick")}
            </p>
          )}
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
              <p className="mt-2.5 whitespace-pre-line font-serif text-[17px] leading-relaxed text-quote">
                “<HighlightWord text={q.word.examples[0].sentenceEn} word={q.word.word} />”
                {q.word.examples[0].sentenceZh && (
                  <span className={cn("mt-1 block whitespace-pre-line text-sm not-italic text-ink-soft", tFont)}>
                    {q.word.examples[0].sentenceZh}
                  </span>
                )}
              </p>
            )}
          </div>
          <Button variant="dark" className="mt-4 w-full" onClick={next}>
            {index + 1 >= total ? t("quiz.seeResults") : t("quiz.next")}
          </Button>
          <p className="mt-2 hidden text-center text-[12px] text-ink-faint sm:block">
            {t("quiz.hotkeysNext")}
          </p>
        </div>
      )}
    </div>
  );
}
