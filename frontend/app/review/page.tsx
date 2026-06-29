"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, isDue, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useFlip } from "@/lib/prefs";
import { langLabel, pairLabel } from "@/lib/langs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SpeakButton } from "@/components/SpeakButton";
import { Confetti } from "@/components/Confetti";
import { cn } from "@/lib/utils";

const targetFont = (lang: string) => (lang === "zh" ? "font-zh" : "");
const pairKey = (w: Word) => `${w.sourceLang}>${w.targetLang}`;

export default function FlashcardsPage() {
  const qc = useQueryClient();
  const { accountId } = useAccount();
  const [flip, setFlip] = useFlip("vocab.flip.review");
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
  const [onlyDue, setOnlyDue] = useState(true);

  const inColl = (w: Word) =>
    selColl === "all" || (w.collections ?? []).some((c) => c.id === selColl);

  // Preset the collection from a ?coll= deep link (e.g. from the Collections page).
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("coll");
    if (c) setSelColl(c);
  }, []);

  const [deck, setDeck] = useState<Word[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [known, setKnown] = useState(0);
  const [learning, setLearning] = useState(0);

  const startX = useRef(0);
  const draggedRef = useRef(false);

  const words = allWords ?? [];
  const allPairs = Array.from(new Set(words.map(pairKey)));
  const sel = selPairs ?? allPairs;

  // Default selection = all pairs once the list loads.
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

  function buildDeck() {
    return words.filter(
      (w) => sel.includes(pairKey(w)) && inColl(w) && (onlyDue ? isDue(w) : true),
    );
  }

  function start() {
    setDeck(buildDeck());
    setIndex(0);
    setFlipped(false);
    setKnown(0);
    setLearning(0);
    setDragX(0);
    setStarted(true);
  }

  function togglePair(p: string) {
    const next = sel.includes(p) ? sel.filter((x) => x !== p) : [...sel, p];
    setSelPairs(next);
  }

  function commit(dir: "known" | "learning", word: Word) {
    setDragX(dir === "known" ? 640 : -640);
    setDragging(false);
    if (dir === "known") {
      review.mutate(word.id);
      setKnown((k) => k + 1);
    } else {
      setLearning((l) => l + 1);
    }
    setTimeout(() => {
      setDragX(0);
      setFlipped(false);
      setIndex((i) => i + 1);
    }, 260);
  }

  if (isLoading)
    return (
      <div className="mx-auto max-w-[560px] space-y-5">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-[320px] rounded-[30px]" />
      </div>
    );

  if (words.length === 0)
    return (
      <p className="text-sm text-ink-soft">
        No words to review yet.{" "}
        <Link href="/words" className="font-semibold text-sage hover:text-sage-deep">
          Add some first.
        </Link>
      </p>
    );

  // ---------------- Setup screen ----------------
  if (!started) {
    const candidate = words.filter(
      (w) => sel.includes(pairKey(w)) && inColl(w) && (onlyDue ? isDue(w) : true),
    );
    return (
      <div className="mx-auto max-w-[520px] space-y-6">
        <h2 className="font-serif text-[28px] font-medium text-ink">Quick review</h2>

        <div className="rounded-[20px] border border-black/[0.06] bg-surface p-5 space-y-4">
          {/* direction */}
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

          {/* collection */}
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

          {/* pairs */}
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

          {/* due toggle */}
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink-muted">
            <input
              type="checkbox"
              checked={onlyDue}
              onChange={(e) => setOnlyDue(e.target.checked)}
              className="h-4 w-4 accent-[#7c9885]"
            />
            Only words due for review
          </label>
        </div>

        <Button className="w-full" disabled={candidate.length === 0} onClick={start}>
          {candidate.length === 0
            ? "Nothing to train in this selection"
            : `Start — ${candidate.length} card${candidate.length === 1 ? "" : "s"} →`}
        </Button>
      </div>
    );
  }

  // ---------------- Training ----------------
  const total = deck.length;
  const done = index >= total;

  if (done)
    return (
      <div className="anim-pop mx-auto flex max-w-[480px] flex-col items-center rounded-[24px] border border-black/[0.06] bg-surface p-10 text-center">
        {known > 0 && <Confetti />}
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-sage-tint">
          <svg width="40" height="40" viewBox="0 0 34 34" fill="none">
            <path d="M9 17.5l5 5L25 11" stroke="#7c9885" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="mt-5 font-serif text-[32px] font-medium text-ink">Session complete</h2>
        <p className="mt-2 text-ink-soft">You reviewed {total} word{total === 1 ? "" : "s"}.</p>
        <div className="mt-6 flex gap-3.5">
          <div className="rounded-[18px] border border-black/[0.07] bg-paper px-7 py-4">
            <div className="font-serif text-[30px] font-bold text-sage">{known}</div>
            <div className="mt-0.5 text-[13px] font-medium text-ink-soft">known</div>
          </div>
          <div className="rounded-[18px] border border-black/[0.07] bg-paper px-7 py-4">
            <div className="font-serif text-[30px] font-bold text-warn">{learning}</div>
            <div className="mt-0.5 text-[13px] font-medium text-ink-soft">learning</div>
          </div>
        </div>
        <Button variant="dark" className="mt-8" onClick={() => setStarted(false)}>
          Back to setup
        </Button>
      </div>
    );

  const word = deck[index];
  const example = word.examples[0];
  const clamp = (v: number) => Math.max(0, Math.min(1, v));

  const onPointerDown = (e: React.PointerEvent) => {
    startX.current = e.clientX;
    draggedRef.current = false;
    setDragging(true);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX.current;
      if (Math.abs(dx) > 6) draggedRef.current = true;
      setDragX(dx);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      const dx = ev.clientX - startX.current;
      if (dx > 110) commit("known", word);
      else if (dx < -110) commit("learning", word);
      else {
        setDragX(0);
        setDragging(false);
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const onFlip = () => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    setFlipped((f) => !f);
  };

  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center">
      <div className="w-full">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-serif text-[28px] font-medium text-ink">Quick review</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setStarted(false)}
              className="rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
            >
              ⚙ Setup
            </button>
            <span className="text-[15px] font-semibold text-ink-soft">
              {Math.min(index + 1, total)} / {total}
            </span>
          </div>
        </div>
        <div className="mt-4 h-[7px] overflow-hidden rounded-full bg-track">
          <div
            className="h-full rounded-full bg-sage transition-[width] duration-300"
            style={{ width: `${(index / total) * 100}%` }}
          />
        </div>
        <div className="mt-3 flex justify-between text-sm font-semibold">
          <span className="flex items-center gap-2 text-warn-text">
            <span className="h-2.5 w-2.5 rounded-full bg-warn" /> Learning {learning}
          </span>
          <span className="flex items-center gap-2 text-sage-deep">
            Known {known} <span className="h-2.5 w-2.5 rounded-full bg-sage" />
          </span>
        </div>
      </div>

      <div className="relative flex w-full items-center justify-center py-8">
        <div
          className="pointer-events-none absolute left-1 top-12 z-10 -rotate-12 rounded-xl border-[3px] border-sage bg-paper/70 px-4 py-2 text-lg font-bold tracking-wider text-sage-deep"
          style={{ opacity: clamp(dragX / 110) }}
        >
          KNOW
        </div>
        <div
          className="pointer-events-none absolute right-1 top-12 z-10 rotate-12 rounded-xl border-[3px] border-warn bg-paper/70 px-4 py-2 text-lg font-bold tracking-wider text-warn-text"
          style={{ opacity: clamp(-dragX / 110) }}
        >
          LEARNING
        </div>

        <div
          className="w-full max-w-[560px] select-none"
          onPointerDown={onPointerDown}
          onClick={onFlip}
          style={{
            transform: `translateX(${dragX}px) rotate(${dragX * 0.035}deg)`,
            transition: dragging ? "none" : "transform 0.34s cubic-bezier(.22,.8,.26,1)",
            cursor: dragging ? "grabbing" : "grab",
            touchAction: "pan-y",
          }}
        >
          <div className="flip-scene">
            <div className={cn("flip-card", flipped && "is-flipped")}>
              {/* FRONT */}
              <div className="flip-face flex min-h-[320px] flex-col rounded-[30px] border border-black/[0.07] bg-surface p-8 shadow-[0_30px_60px_rgba(46,42,38,0.13)]">
                <div className="flex flex-1 flex-col items-center justify-center text-center">
                  {!flip ? (
                    <>
                      {word.partOfSpeech && (
                        <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-taupe-dim">
                          {word.partOfSpeech}
                        </span>
                      )}
                      <div className="mt-4 flex items-center gap-3">
                        <div className="font-serif text-[52px] font-medium leading-tight tracking-[-0.025em] text-ink">
                          {word.word}
                        </div>
                        <SpeakButton text={word.word} lang={word.sourceLang} />
                      </div>
                      {word.phonetic && <div className="mt-3 text-[20px] text-ink-faint">{word.phonetic}</div>}
                    </>
                  ) : (
                    <div className={cn("font-serif text-[38px] font-bold leading-tight text-sage-deep", targetFont(word.targetLang))}>
                      {word.meaningZh}
                    </div>
                  )}
                  <div className="mt-7 text-sm font-medium text-ink-faint">
                    Click to reveal · {langLabel(flip ? word.sourceLang : word.targetLang)}
                  </div>
                </div>
              </div>

              {/* BACK */}
              <div className="flip-face flip-back flex min-h-[320px] flex-col justify-center rounded-[30px] border border-black/[0.07] bg-surface p-8 shadow-[0_30px_60px_rgba(46,42,38,0.13)]">
                <div className="flex items-center gap-3">
                  <div className="font-serif text-[28px] font-medium text-ink">{word.word}</div>
                  <SpeakButton text={word.word} lang={word.sourceLang} size="sm" />
                </div>
                {word.meaningZh && (
                  <div className={cn("mt-2 text-[26px] font-bold text-sage-deep", targetFont(word.targetLang))}>
                    {word.meaningZh}
                  </div>
                )}
                {example && (
                  <>
                    <div className="my-4 h-px bg-black/[0.07]" />
                    <p className="font-serif text-[18px] leading-relaxed text-quote">
                      {example.sentenceEn}
                    </p>
                    {example.sentenceZh && (
                      <p className={cn("mt-2 text-[14px] text-ink-soft", targetFont(word.targetLang))}>
                        {example.sentenceZh}
                      </p>
                    )}
                    <div className="mt-3 text-[13px] font-semibold tracking-[0.04em] text-ink-faint">
                      — {example.sourceName}
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex gap-4">
        <Button variant="warn" size="lg" onClick={() => commit("learning", word)}>
          ✕ Still learning
        </Button>
        <Button size="lg" onClick={() => commit("known", word)}>
          ✓ I know it
        </Button>
      </div>
      <p className="mt-4 text-[13px] font-medium text-ink-faint">
        Drag the card left or right, or use the buttons.
      </p>
    </div>
  );
}
