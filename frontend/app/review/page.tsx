"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, isDue, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export default function FlashcardsPage() {
  const qc = useQueryClient();
  const { accountId } = useAccount();
  const { data: allWords, isLoading } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
  });

  const [deck, setDeck] = useState<Word[] | null>(null);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [known, setKnown] = useState(0);
  const [learning, setLearning] = useState(0);

  const startX = useRef(0);
  const draggedRef = useRef(false);

  useEffect(() => {
    if (deck === null && allWords) setDeck(allWords.filter(isDue));
  }, [allWords, deck]);

  const review = useMutation({
    mutationFn: (id: string) => api.reviewWord(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["words"] }),
  });

  function rebuild(words: Word[]) {
    setDeck(words);
    setIndex(0);
    setFlipped(false);
    setKnown(0);
    setLearning(0);
    setDragX(0);
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

  if (isLoading || deck === null)
    return (
      <div className="mx-auto max-w-[560px] space-y-5">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-[360px] rounded-[30px]" />
      </div>
    );

  if (!allWords || allWords.length === 0)
    return (
      <p className="text-sm text-ink-soft">
        No words to review yet.{" "}
        <Link href="/words" className="font-semibold text-sage hover:text-sage-deep">
          Add some first.
        </Link>
      </p>
    );

  if (deck.length === 0)
    return (
      <div className="anim-pop mx-auto max-w-[480px] rounded-[24px] border border-black/[0.06] bg-surface p-10 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-sage-tint text-3xl">
          ☕
        </div>
        <h2 className="mt-5 font-serif text-[28px] font-medium text-ink">All caught up</h2>
        <p className="mt-2 text-ink-soft">Nothing is due for review right now.</p>
        <Button variant="outline" className="mt-6" onClick={() => rebuild(allWords)}>
          Review all {allWords.length} anyway
        </Button>
      </div>
    );

  const total = deck.length;
  const done = index >= total;

  if (done)
    return (
      <div className="anim-pop mx-auto flex max-w-[480px] flex-col items-center rounded-[24px] border border-black/[0.06] bg-surface p-10 text-center">
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
        <Button variant="dark" className="mt-8" onClick={() => rebuild(allWords.filter(isDue))}>
          Review again
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
      {/* header */}
      <div className="w-full">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-[28px] font-medium text-ink">Quick review</h2>
          <span className="text-[15px] font-semibold text-ink-soft">
            {Math.min(index + 1, total)} / {total}
          </span>
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

      {/* card */}
      <div className="relative flex w-full items-center justify-center py-8">
        {/* swipe badges */}
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
          className="flip-scene w-full max-w-[560px] select-none"
          onPointerDown={onPointerDown}
          onClick={onFlip}
          style={{
            transform: `translateX(${dragX}px) rotate(${dragX * 0.035}deg)`,
            transition: dragging ? "none" : "transform 0.34s cubic-bezier(.22,.8,.26,1)",
            cursor: dragging ? "grabbing" : "grab",
            touchAction: "pan-y",
          }}
        >
          <div className={`flip-card h-[360px] w-full ${flipped ? "is-flipped" : ""}`}>
            {/* front */}
            <div className="flip-face flex flex-col items-center justify-center rounded-[30px] border border-black/[0.07] bg-surface p-10 text-center shadow-[0_30px_60px_rgba(46,42,38,0.13)]">
              {word.partOfSpeech && (
                <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-taupe-dim">
                  {word.partOfSpeech}
                </span>
              )}
              <div className="mt-4 font-serif text-[60px] font-medium leading-none tracking-[-0.025em] text-ink">
                {word.word}
              </div>
              {word.phonetic && <div className="mt-3.5 text-[20px] text-ink-faint">{word.phonetic}</div>}
              <div className="mt-7 text-sm font-medium text-[#cabfae]">Click to reveal · 中文</div>
            </div>
            {/* back */}
            <div className="flip-face flip-back flex flex-col justify-center rounded-[30px] border border-black/[0.07] bg-surface p-11 shadow-[0_30px_60px_rgba(46,42,38,0.13)]">
              <div className="font-serif text-[30px] font-medium text-ink">{word.word}</div>
              {word.meaningZh && (
                <div className="mt-2.5 font-zh text-[32px] font-bold text-sage-deep">
                  {word.meaningZh}
                </div>
              )}
              <div className="my-5 h-px bg-black/[0.07]" />
              {example && (
                <>
                  <p className="font-serif text-[20px] leading-relaxed text-[#544e45]">
                    {example.sentenceEn}
                  </p>
                  <p className="mt-2 font-zh text-[15px] text-ink-soft">{example.sentenceZh}</p>
                  <div className="mt-3.5 text-[13px] font-semibold tracking-[0.04em] text-ink-faint">
                    — {example.sourceName}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* actions */}
      <div className="flex gap-4">
        <Button variant="warn" size="lg" onClick={() => commit("learning", word)}>
          ✕ Still learning
        </Button>
        <Button size="lg" onClick={() => commit("known", word)}>
          ✓ I know it
        </Button>
      </div>
      <p className="mt-4 text-[13px] font-medium text-[#b3aa9a]">
        Drag the card left or right, or use the buttons.
      </p>
    </div>
  );
}
