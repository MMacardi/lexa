"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, isDue, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useFlip } from "@/lib/prefs";
import { langLabel } from "@/lib/langs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SpeakButton } from "@/components/SpeakButton";
import { Confetti } from "@/components/Confetti";
import { CollectionSelect } from "@/components/CollectionSelect";
import { EditWordModal } from "@/components/EditWordModal";
import { PairMultiSelect } from "@/components/PairMultiSelect";
import { cn } from "@/lib/utils";

const targetFont = (lang: string) => (lang === "zh" ? "font-zh" : "");
const pairKey = (w: Word) => `${w.sourceLang}>${w.targetLang}`;

export default function FlashcardsPage() {
  const qc = useQueryClient();
  const { accountId } = useAccount();
  const { t } = useI18n();
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
  const [editing, setEditing] = useState<Word | null>(null);

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
    mutationFn: ({ id, known }: { id: string; known: boolean }) => api.reviewWord(id, known),
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

  function commit(dir: "known" | "learning", word: Word) {
    setDragX(dir === "known" ? 640 : -640);
    setDragging(false);
    if (dir === "known") {
      review.mutate({ id: word.id, known: true });
      setKnown((k) => k + 1);
    } else {
      // "Still learning": reset its schedule and bring it back later this session.
      review.mutate({ id: word.id, known: false });
      setLearning((l) => l + 1);
      setDeck((d) => [...d, word]);
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
        {t("review.noWords")}{" "}
        <Link href="/words" className="font-semibold text-sage hover:text-sage-deep">
          {t("review.addFirst")}
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
        <h2 className="font-serif text-[28px] font-medium text-ink">{t("review.title")}</h2>

        <div className="rounded-[20px] border border-black/[0.06] bg-surface p-5 space-y-4">
          {/* direction */}
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

          {/* collection */}
          {collections && collections.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {t("review.collection")}
              </p>
              <CollectionSelect options={collections} value={selColl} onChange={setSelColl} />
            </div>
          )}

          {/* pairs */}
          {allPairs.length > 1 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {t("review.pairs")}
              </p>
              <PairMultiSelect pairs={allPairs} selected={sel} onChange={setSelPairs} />
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
            {t("review.onlyDue")}
          </label>
        </div>

        <Button className="w-full" disabled={candidate.length === 0} onClick={start}>
          {candidate.length === 0
            ? t("review.nothing")
            : candidate.length === 1
              ? t("review.startOne", { n: candidate.length })
              : t("review.start", { n: candidate.length })}
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
        <h2 className="mt-5 font-serif text-[32px] font-medium text-ink">{t("review.complete")}</h2>
        <p className="mt-2 text-ink-soft">{t("review.reviewed", { n: total })}</p>
        <div className="mt-6 flex gap-3.5">
          <div className="rounded-[18px] border border-black/[0.07] bg-paper px-7 py-4">
            <div className="font-serif text-[30px] font-bold text-sage">{known}</div>
            <div className="mt-0.5 text-[13px] font-medium text-ink-soft">{t("review.known")}</div>
          </div>
          <div className="rounded-[18px] border border-black/[0.07] bg-paper px-7 py-4">
            <div className="font-serif text-[30px] font-bold text-warn">{learning}</div>
            <div className="mt-0.5 text-[13px] font-medium text-ink-soft">{t("review.learningCount")}</div>
          </div>
        </div>
        <Button variant="dark" className="mt-8" onClick={() => setStarted(false)}>
          {t("review.backToSetup")}
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
          <h2 className="font-serif text-[28px] font-medium text-ink">{t("review.title")}</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setEditing(word)}
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
            <span className="h-2.5 w-2.5 rounded-full bg-warn" /> {t("review.learningLabel", { n: learning })}
          </span>
          <span className="flex items-center gap-2 text-sage-deep">
            {t("review.knownLabel", { n: known })} <span className="h-2.5 w-2.5 rounded-full bg-sage" />
          </span>
        </div>
      </div>

      <div className="relative flex w-full items-center justify-center py-8">
        <div
          className="pointer-events-none absolute left-1 top-12 z-10 -rotate-12 rounded-xl border-[3px] border-sage bg-paper/70 px-4 py-2 text-lg font-bold tracking-wider text-sage-deep"
          style={{ opacity: clamp(dragX / 110) }}
        >
          {t("review.knowBadge")}
        </div>
        <div
          className="pointer-events-none absolute right-1 top-12 z-10 rotate-12 rounded-xl border-[3px] border-warn bg-paper/70 px-4 py-2 text-lg font-bold tracking-wider text-warn-text"
          style={{ opacity: clamp(-dragX / 110) }}
        >
          {t("review.learningBadge")}
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
                    {t("review.clickReveal", { lang: langLabel(flip ? word.sourceLang : word.targetLang) })}
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
          {t("review.stillLearning")}
        </Button>
        <Button size="lg" onClick={() => commit("known", word)}>
          {t("review.iKnow")}
        </Button>
      </div>
      <p className="mt-4 text-[13px] font-medium text-ink-faint">
        {t("review.dragHint")}
      </p>

      {editing && (
        <EditWordModal
          word={editing}
          onClose={() => setEditing(null)}
          onUpdated={(u) => {
            setDeck((d) => d.map((w) => (w.id === u.id ? u : w)));
            setEditing(u);
          }}
        />
      )}
    </div>
  );
}
