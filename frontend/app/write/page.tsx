"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, PenLine, X } from "lucide-react";
import { api, type HskVersion, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { fmtInterval, previewWriteMinutes } from "@/lib/fsrsPreview";
import { Pinyin } from "@/components/Pinyin";
import { SpeakButton } from "@/components/SpeakButton";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { QuickChip } from "@/components/ui/QuickChip";
import { Segmented } from "@/components/ui/Segmented";
import { CollectionSelect } from "@/components/CollectionSelect";
import { WritingTrainer, type WriteResult } from "@/components/WritingTrainer";
import { cn } from "@/lib/utils";

/*
 * Writing: Chinese words written from their meaning, card by card, on their own
 * schedule — FSRS on the word's writing fields (backend recordWriting), so a
 * word read well but not yet written keeps its reading interval. A word never
 * written is traced first, ungraded, and comes back at the end of the session to
 * be written from memory; that's the graded pass. The grade is suggested from
 * how it went (a hint → Again, a mistake → Hard, clean → Good) and the learner
 * can pick another. Again brings the word back at the end, as in Flashcards.
 */

const HAN = /\p{Script=Han}/u;
// Writing is slow (half a minute a word): fewer new words than Flashcards takes.
const NEW_PER_SESSION = 10;

const GRADES = [
  { g: 1, name: "again", tone: "bg-warn-bg text-warn-text" },
  { g: 2, name: "hard", tone: "border border-black/[0.1] bg-surface text-ink-muted" },
  { g: 3, name: "good", tone: "bg-sage text-white" },
  { g: 4, name: "easy", tone: "bg-sage-deep text-white" },
] as const;

type Item = { word: Word; trace: boolean };

const canWrite = (w: Word) => w.sourceLang === "zh" && HAN.test(w.word) && !!w.meaningZh;
const isNew = (w: Word) => w.writeStability == null;
const isDueToWrite = (w: Word) => !isNew(w) && (!w.writeDue || new Date(w.writeDue).getTime() <= Date.now());
const suggest = (r: WriteResult) => (r.hints ? 1 : r.mistakes ? 2 : 3);

// New words to write: the ones already read well first (writing a word you can
// read is the next step), then the lower HSK level, then the older card.
function newOrder(hsk: (w: Word) => number | null) {
  return (a: Word, b: Word) =>
    Number(b.reviewCount > 0) - Number(a.reviewCount > 0) ||
    (hsk(a) ?? 99) - (hsk(b) ?? 99) ||
    a.createdAt.localeCompare(b.createdAt);
}

export default function WritePage() {
  const { t } = useI18n();
  const { accountId, profile } = useAccount();
  const qc = useQueryClient();
  const { show } = useToast();
  const { data: allWords, isLoading } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
  });
  const { data: collections } = useQuery({
    queryKey: ["collections", accountId],
    queryFn: () => api.collections(accountId),
  });

  const [selColl, setSelColl] = useState("all");
  const [onlyDue, setOnlyDue] = useState(true);
  const [deck, setDeck] = useState<Item[] | null>(null);
  const [at, setAt] = useState(0);
  const [result, setResult] = useState<WriteResult | null>(null);
  // This session: words graded (once each), clean on the first graded try, Agains.
  const [tally, setTally] = useState({ graded: new Set<string>(), clean: 0, again: 0 });
  // On a phone the grades land under the square, below the fold: bring them up.
  const doneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (result) doneRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [result]);

  // ?coll=<id> / ?hsk=<level> preset the list, as in Quiz.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const c = q.get("coll");
    const h = q.get("hsk");
    if (c) setSelColl(c);
    else if (h) setSelColl(`hsk:${h}`);
  }, []);

  const words = (allWords ?? []).filter(canWrite);
  const hskVersion: HskVersion = profile?.hskVersion ?? "3.0";
  const hskOf = (w: Word) => w.hsk?.[hskVersion] ?? null;
  const hskLevels = Array.from(new Set(words.map(hskOf).filter((n): n is number => n != null))).sort((a, b) => a - b);
  const hskName = (n: number) => (n === 7 ? t("hsk.band79") : t("hsk.level", { n }));
  const inColl = (w: Word) =>
    selColl === "all" ||
    (selColl.startsWith("hsk:") ? hskOf(w) === Number(selColl.slice(4)) : (w.collections ?? []).some((c) => c.id === selColl));
  const pool = words.filter(inColl);
  const byDue = (a: Word, b: Word) => (a.writeDue ?? "").localeCompare(b.writeDue ?? "");
  const due = pool.filter(isDueToWrite).sort(byDue);
  const fresh = pool.filter(isNew).sort(newOrder(hskOf));
  const dueCount = due.length + Math.min(fresh.length, NEW_PER_SESSION);

  // Keys: Enter takes the suggested grade (or goes on after a trace), 1–4 grade.
  useEffect(() => {
    if (!deck || !result) return;
    const item = deck[at];
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (item.trace) traced();
        else grade(suggest(result));
      } else if (!item.trace && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        grade(Number(e.key));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // grade/traced are rebuilt every render; the deps re-bind per card and result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deck, at, result]);

  function start() {
    const items: Item[] = onlyDue
      ? [...due, ...fresh.slice(0, NEW_PER_SESSION)].map((w) => ({ word: w, trace: isNew(w) }))
      : [...due, ...pool.filter((w) => !isNew(w) && !isDueToWrite(w)).sort(byDue), ...fresh].map((w) => ({ word: w, trace: isNew(w) }));
    setDeck(items);
    setAt(0);
    setResult(null);
    setTally({ graded: new Set(), clean: 0, again: 0 });
  }

  function next() {
    setResult(null);
    setAt((i) => i + 1);
  }

  // A new word's trace is the first look, not a test: it comes back at the end
  // of the session to be written from memory.
  function traced() {
    const item = deck![at];
    setDeck((d) => [...d!, { word: item.word, trace: false }]);
    next();
  }

  function grade(g: number) {
    const item = deck![at];
    const w = item.word;
    if (g === 1) setDeck((d) => [...d!, { word: w, trace: false }]);
    setTally((s) => {
      const first = !s.graded.has(w.id);
      return {
        graded: new Set(s.graded).add(w.id),
        clean: s.clean + (first && result && !result.mistakes && !result.hints ? 1 : 0),
        again: s.again + (g === 1 ? 1 : 0),
      };
    });
    api
      .writeWord(w.id, g)
      .then((updated) =>
        qc.setQueryData<Word[]>(["words", accountId], (prev) => (prev ?? []).map((x) => (x.id === updated.id ? { ...x, ...updated } : x))),
      )
      .catch((e) => show({ icon: "⚠️", title: t("write.saveFailed"), subtitle: errText(e, t) }));
    next();
  }

  const header = (
    <div>
      <h1 className="font-serif text-[28px] font-medium text-ink sm:text-[32px]">{t("write.title")}</h1>
      <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{t("write.subtitle")}</p>
    </div>
  );

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[520px] space-y-5">
        {header}
        <Skeleton className="h-[320px] w-full rounded-[20px]" />
      </div>
    );
  }

  if (!words.length) {
    return (
      <div className="mx-auto max-w-[520px] space-y-5">
        {header}
        <div className="space-y-3 rounded-[20px] border border-black/[0.06] bg-surface p-6 text-center">
          <PenLine className="mx-auto h-6 w-6 text-ink-faint" />
          <p className="text-[15px] text-ink-soft">{t("write.empty")}</p>
          <Link href="/words" className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-sage-deep hover:underline">
            {t("write.toWords")} <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    );
  }

  // ---------------- Setup ----------------
  if (!deck) {
    const candidate = onlyDue ? dueCount : pool.length;
    return (
      <div className="mx-auto max-w-[520px] space-y-5">
        {header}
        <div className="space-y-5 rounded-[20px] border border-black/[0.06] bg-surface p-5">
          {/* 1. which words: due to write vs all of them */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("review.which")}</p>
            <Segmented
              grow
              size="lg"
              value={onlyDue ? "due" : "all"}
              onChange={(v) => setOnlyDue(v === "due")}
              options={([true, false] as const).map((d) => ({
                value: d ? "due" : "all",
                label: (
                  <>
                    {t(d ? "write.modeDue" : "review.modeAll")}
                    <span className="-ml-0.5 opacity-70">{d ? dueCount : pool.length}</span>
                  </>
                ),
              }))}
            />
            <p className="mt-2 text-[12px] leading-snug text-ink-faint">
              {onlyDue ? t("write.modeDueHint", { n: NEW_PER_SESSION }) : t("write.modeAllHint")}
            </p>
          </div>

          {/* 2. which list (optional): a collection or an HSK level */}
          {((collections && collections.length > 0) || hskLevels.length > 0) && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("review.collection")}</p>
              <div className="flex flex-wrap gap-1.5">
                <QuickChip active={selColl === "all"} onClick={() => setSelColl("all")}>
                  {t("common.allWords")}
                </QuickChip>
                {(collections ?? []).slice(0, 5).map((c) => (
                  <QuickChip key={c.id} active={selColl === c.id} onClick={() => setSelColl(c.id)}>
                    {c.name}
                  </QuickChip>
                ))}
                {hskLevels.map((n) => (
                  <QuickChip key={n} active={selColl === `hsk:${n}`} onClick={() => setSelColl(`hsk:${n}`)}>
                    {hskName(n)}
                  </QuickChip>
                ))}
              </div>
              {collections && collections.length > 5 && (
                <div className="mt-2">
                  <CollectionSelect options={collections} value={selColl} onChange={setSelColl} />
                </div>
              )}
            </div>
          )}
        </div>

        <Button className="w-full" disabled={candidate === 0} onClick={start}>
          {candidate === 0 ? t(onlyDue ? "write.nothingDue" : "review.nothing") : t("write.start", { n: candidate })}
        </Button>
        {onlyDue && dueCount === 0 && pool.length > 0 && (
          <button
            type="button"
            onClick={() => setOnlyDue(false)}
            className="-mt-2 w-full text-center text-[13px] font-semibold text-sage hover:text-sage-deep"
          >
            {t("write.allInstead", { n: pool.length })}
          </button>
        )}
      </div>
    );
  }

  // ---------------- Done ----------------
  if (at >= deck.length) {
    return (
      <div className="anim-pop mx-auto flex max-w-[480px] flex-col items-center rounded-[24px] border border-black/[0.06] bg-surface p-10 text-center">
        <Check className="h-9 w-9 text-sage" />
        <h2 className="mt-4 font-serif text-[28px] font-medium text-ink">{t("write.sessionDone", { n: tally.graded.size })}</h2>
        <p className="mt-2 text-ink-soft">{t("write.sessionScore", { clean: tally.clean, again: tally.again })}</p>
        <Button variant="dark" className="mt-7" onClick={() => setDeck(null)}>
          {t("review.backToSetup")}
        </Button>
      </div>
    );
  }

  // ---------------- Writing ----------------
  const item = deck[at];
  const w = item.word;
  // The live card (a word written earlier this session has a new schedule).
  const live = allWords?.find((x) => x.id === w.id) ?? w;
  const iv = previewWriteMinutes(live);
  const pick = result ? suggest(result) : 0;
  return (
    <div className="mx-auto max-w-[560px] space-y-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setDeck(null)}
          aria-label={t("review.backToSetup")}
          title={t("review.backToSetup")}
          className="rounded-full p-1.5 text-ink-faint transition-colors hover:bg-black/[0.04] hover:text-ink"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink/10">
          <div className="h-full rounded-full bg-sage transition-[width] duration-300" style={{ width: `${(at / deck.length) * 100}%` }} />
        </div>
        <span className="text-[13px] font-semibold tabular-nums text-ink-faint">
          {at + 1} / {deck.length}
        </span>
      </div>

      <div className="space-y-4 rounded-[20px] border border-black/[0.06] bg-surface p-4 sm:p-5">
        {/* What to write: the meaning and the sound, never the characters. */}
        <div className="space-y-1">
          {item.trace && (
            <span className="inline-block rounded-full bg-sage-tint px-2.5 py-0.5 text-[11px] font-semibold text-sage-deep">{t("write.newTrace")}</span>
          )}
          <p className="break-words text-[20px] font-semibold leading-snug text-ink">{w.meaningZh}</p>
          <div className="flex items-center gap-2">
            {w.phonetic && <Pinyin text={w.phonetic} className="text-[16px] text-ink-muted" />}
            <SpeakButton text={w.word} lang={w.sourceLang} size="sm" />
          </div>
        </div>
        <WritingTrainer key={at} word={w.word} fixedMode={item.trace ? "trace" : "memory"} onFinish={setResult} />

        {/* Once it's written: the word, and how it went — a grade, or on to the next.
            Its scroll margin keeps it clear of the phone's tab bar. */}
        {result && (
          <div ref={doneRef} className="anim-fade-in scroll-mb-28 space-y-3 border-t border-black/[0.06] pt-3 md:scroll-mb-6">
            <div className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1">
              <span className="font-zh text-[26px] text-ink">{w.word}</span>
              {w.phonetic && <Pinyin text={w.phonetic} className="text-[15px] text-ink-muted" />}
              <Link href={`/word/${w.id}`} className="text-[13px] font-semibold text-ink-muted underline-offset-2 hover:text-sage-deep hover:underline">
                {t("write.openWord")}
              </Link>
            </div>
            {item.trace ? (
              <Button className="w-full" onClick={traced}>
                {t("write.continue")} <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {GRADES.map(({ g, name, tone }) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => grade(g)}
                    aria-label={g === pick ? `${t(`review.${name}`)} — ${t("write.suggested")}` : t(`review.${name}`)}
                    className={cn(
                      "relative flex flex-col items-center rounded-2xl py-2.5 font-bold transition-transform active:scale-95",
                      tone,
                      // the grade the writing earned, picked by Enter
                      g === pick ? "ring-2 ring-ink/70 ring-offset-2 ring-offset-surface" : "opacity-75",
                    )}
                  >
                    <span className="absolute left-2 top-1.5 hidden text-[10px] font-semibold opacity-40 sm:block">{g}</span>
                    <span className="text-sm">{t(`review.${name}`)}</span>
                    <span className="text-[11px] font-medium opacity-80">{fmtInterval(iv[name], t)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
