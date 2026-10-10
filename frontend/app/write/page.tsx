"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, PenLine } from "lucide-react";
import { api, isDue, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { Pinyin } from "@/components/Pinyin";
import { SpeakButton } from "@/components/SpeakButton";
import { Skeleton } from "@/components/ui/skeleton";
import { WritingTrainer, type WriteResult } from "@/components/WritingTrainer";
import { cn } from "@/lib/utils";

const HAN = /\p{Script=Han}/u;
const ROUND = 10;

// The order words come up in: the ones due for review first (the oldest due
// first), then the newest. Each round takes the next ten, wrapping round.
function ordered(words: Word[]): Word[] {
  const zh = words.filter((w) => w.sourceLang === "zh" && HAN.test(w.word));
  const due = zh.filter(isDue).sort((a, b) => (a.nextReviewAt ?? "").localeCompare(b.nextReviewAt ?? ""));
  const rest = zh.filter((w) => !isDue(w)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return [...due, ...rest];
}

/**
 * The writing drill: the learner's Chinese words one at a time, the meaning
 * and pinyin shown, the characters written on the trainer (from memory by
 * default, traced if they'd rather). Practice only: the review schedule is
 * left alone.
 */
export default function WritePage() {
  const { t } = useI18n();
  const { accountId } = useAccount();
  const { data, isLoading } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
  });
  // Fixed when the round starts, so a refetch (a card added elsewhere) doesn't
  // reshuffle the words under the learner's pen.
  const [round, setRound] = useState(0);
  const [queue, setQueue] = useState<Word[] | null>(null);
  const [at, setAt] = useState(0);
  // Each word's last attempt, by its place in the round.
  const [results, setResults] = useState<Record<number, WriteResult>>({});
  const clean = Object.values(results).filter((r) => !r.mistakes && !r.hints).length;

  useEffect(() => {
    if (!data || queue) return;
    const all = ordered(data);
    const start = all.length ? (round * ROUND) % all.length : 0;
    setQueue([...all, ...all].slice(start, start + Math.min(ROUND, all.length)));
  }, [data, queue, round]);

  const header = (
    <div>
      <h1 className="font-serif text-[28px] font-medium text-ink sm:text-[32px]">{t("write.title")}</h1>
      <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{t("write.subtitle")}</p>
    </div>
  );

  if (isLoading || !queue) {
    return (
      <div className="mx-auto max-w-[560px] space-y-5">
        {header}
        <Skeleton className="h-[480px] w-full rounded-[20px]" />
      </div>
    );
  }

  if (!queue.length) {
    return (
      <div className="mx-auto max-w-[560px] space-y-5">
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

  const newRound = () => {
    setRound((r) => r + 1);
    setQueue(null);
    setAt(0);
    setResults({});
  };

  // The round's end: how many came out clean, and another round.
  if (at >= queue.length) {
    return (
      <div className="mx-auto max-w-[560px] space-y-5">
        {header}
        <div className="anim-fade-up space-y-4 rounded-[20px] border border-black/[0.06] bg-surface p-6 text-center">
          <Check className="mx-auto h-7 w-7 text-sage-deep" />
          <p className="font-serif text-[20px] text-ink">{t("write.roundDone", { clean, n: queue.length })}</p>
          <button
            type="button"
            onClick={newRound}
            className="inline-flex items-center gap-1.5 rounded-full bg-sage px-4 py-2 text-[14px] font-semibold text-white transition-colors hover:bg-sage-deep"
          >
            {t("write.newRound")}
          </button>
        </div>
      </div>
    );
  }

  const w = queue[at];
  const last = at + 1 === queue.length;
  const result = results[at];
  return (
    <div className="mx-auto max-w-[560px] space-y-5">
      {header}
      <div className="space-y-4 rounded-[20px] border border-black/[0.06] bg-surface p-4 sm:p-5">
        {/* What to write: the meaning and the sound, never the characters. */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="break-words text-[20px] font-semibold leading-snug text-ink">{w.meaningZh || "—"}</p>
            <div className="flex items-center gap-2">
              {w.phonetic && <Pinyin text={w.phonetic} className="text-[16px] text-ink-muted" />}
              <SpeakButton text={w.word} lang={w.sourceLang} size="sm" />
            </div>
          </div>
          <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink-faint">
            {at + 1} / {queue.length}
          </span>
        </div>
        <WritingTrainer
          key={`${round}-${at}`}
          word={w.word}
          storeKey="drill"
          defaultMode="memory"
          onFinish={(r) => setResults((rs) => ({ ...rs, [at]: r }))}
        >
          <button
            type="button"
            onClick={() => setAt(at + 1)}
            className="inline-flex items-center gap-1.5 rounded-full bg-sage px-3.5 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-sage-deep"
          >
            {last ? t("write.finish") : t("write.next")} <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </WritingTrainer>
        {/* Once it's written, the word itself, and a way to its card. */}
        <div className={cn("flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px]", !result && "invisible")} aria-hidden={!result}>
          <span className="font-zh text-[22px] text-ink">{w.word}</span>
          <Link href={`/word/${w.id}`} className="font-semibold text-ink-muted underline-offset-2 hover:text-sage-deep hover:underline">
            {t("write.openWord")}
          </Link>
        </div>
      </div>
      <p className="text-center text-[12px] text-ink-faint">{t("write.practiceOnly")}</p>
    </div>
  );
}
