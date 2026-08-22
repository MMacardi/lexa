"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api, isDue, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { AddWordForm } from "@/components/AddWordForm";
import { StatsPanel } from "@/components/StatsPanel";
import { DailyGoalCard } from "@/components/DailyGoalCard";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, PartyPopper } from "lucide-react";

// Highlight the target word (and simple inflections) inside a news sentence.
function Highlight({ text, word }: { text: string; word: string }) {
  const root = word.trim().toLowerCase();
  const stem = root.length > 5 ? root.slice(0, root.length - 2) : root;
  const idx = text.toLowerCase().indexOf(stem);
  if (stem.length < 3 || idx === -1) return <>{text}</>;
  let end = idx + stem.length;
  while (end < text.length && /[a-zA-Z]/.test(text[end])) end++;
  return (
    <>
      {text.slice(0, idx)}
      <span className="rounded bg-news-hl px-1 text-sage-deep">{text.slice(idx, end)}</span>
      {text.slice(end)}
    </>
  );
}

function Stat({ value, label, accent }: { value: React.ReactNode; label: string; accent?: boolean }) {
  return (
    <div className="rounded-[18px] border border-black/[0.06] bg-surface p-[18px]">
      <div
        className={`font-serif text-[30px] font-bold leading-none ${accent ? "text-sage" : "text-ink"}`}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[13px] font-medium text-ink-soft">{label}</div>
    </div>
  );
}

export default function TodayPage() {
  const { accountId } = useAccount();
  const { t, locale } = useI18n();
  const { data: words, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
  });

  const dateLocale = locale === "ru" ? "ru-RU" : locale === "zh" ? "zh-CN" : "en-US";
  const dateStr = new Date()
    .toLocaleDateString(dateLocale, { weekday: "long", month: "long", day: "numeric" })
    .replace(",", " ·");

  if (isLoading)
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-80" />
        <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-[18px]" />
          ))}
        </div>
        <Skeleton className="h-48 rounded-[24px]" />
      </div>
    );

  if (isError)
    return <ErrorState message={errText(error, t)} onRetry={() => refetch()} />;

  const list = words ?? [];
  const collected = list.length;
  const due = list.filter(isDue).length;
  const mastered = list.filter((w) => w.reviewCount >= 5).length;
  const learning = collected - mastered;

  if (collected === 0)
    return (
      <div className="anim-fade-up space-y-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
            {dateStr}
          </div>
          <h1 className="mt-3 font-serif text-[32px] font-medium leading-[1.08] tracking-[-0.01em] text-ink sm:text-[40px]">
            {t("today.emptyTitle")}
          </h1>
          <p className="mt-2 text-ink-soft">{t("today.emptyText")}</p>
        </div>
        <AddWordForm />
      </div>
    );

  const wotd: Word = list[new Date().getDate() % collected] ?? list[0];
  const dueList = list.filter(isDue).slice(0, 6);

  return (
    <div className="space-y-8">
      {/* header */}
      <div className="anim-fade-up flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
            {dateStr}
          </div>
          <h1 className="mt-3 font-serif text-[32px] font-medium leading-[1.08] tracking-[-0.01em] text-ink sm:text-[40px]">
            {t("today.greeting")}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/reader"
            className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-surface px-5 py-3.5 text-[15px] font-semibold text-ink-muted transition-colors hover:border-sage hover:text-sage-deep"
          >
            <BookOpen className="h-4 w-4" /> {t("nav.reader")}
          </Link>
          {due > 0 && (
            <Link
              href="/review"
              className="inline-flex items-center gap-2 rounded-full bg-sage px-6 py-3.5 text-[15px] font-semibold text-white transition-all hover:bg-sage-deep active:scale-[0.98]"
            >
              {t("today.startReview")}
            </Link>
          )}
        </div>
      </div>

      {/* stats */}
      <div
        className="anim-fade-up grid grid-cols-2 gap-3.5 sm:grid-cols-4"
        style={{ animationDelay: "60ms" }}
      >
        <Stat value={due} label={t("today.dueForReview")} />
        <Stat value={collected} label={t("today.wordsCollected")} accent />
        <Stat value={learning} label={t("today.stillLearning")} />
        <Stat value={mastered} label={t("today.mastered")} />
      </div>

      {/* due panel + word of the day */}
      <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
        <Link
          href="/review"
          className="anim-fade-up group flex flex-col rounded-[24px] bg-onyx p-7 transition-transform hover:-translate-y-0.5"
          style={{ animationDelay: "120ms" }}
        >
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-taupe-dim">
            {t("today.duePanel")}
          </div>
          <div className="mt-3 flex items-baseline gap-2.5">
            <span className="font-serif text-[52px] font-semibold leading-none text-white">
              {due}
            </span>
            <span className="text-[17px] font-medium text-taupe">{t("today.wordsReady")}</span>
          </div>
          <p className="mt-3 max-w-[340px] text-[15px] leading-relaxed text-[#d8cfc1]">
            {t("today.dueBlurb")}
          </p>
          <span className="mt-auto pt-6">
            <span className="inline-flex items-center gap-2 rounded-full bg-sage px-5 py-3 text-[15px] font-semibold text-white">
              {t("today.openFlashcards")}
            </span>
          </span>
        </Link>

        <div
          className="anim-fade-up rounded-[24px] border border-black/[0.06] bg-surface p-6"
          style={{ animationDelay: "160ms" }}
        >
          <div className="flex items-baseline justify-between">
            <h3 className="font-serif text-[20px] font-medium italic text-ink">{t("today.wotd")}</h3>
            {wotd.examples[0] && (
              <span className="text-[13px] font-medium text-ink-faint">
                {wotd.examples[0].sourceName}
              </span>
            )}
          </div>
          <div className="mt-4 flex items-baseline gap-2.5">
            <Link
              href={`/word/${wotd.id}`}
              className="font-serif text-[34px] font-semibold text-ink hover:text-sage-deep"
            >
              {wotd.word}
            </Link>
            {wotd.phonetic && <span className="text-[15px] text-ink-faint">{wotd.phonetic}</span>}
          </div>
          {wotd.meaningZh && (
            <div className={`mt-1.5 text-[18px] font-medium text-sage ${wotd.targetLang === "zh" || wotd.targetLang === "zh-Hant" ? "font-zh" : ""}`}>
              {wotd.meaningZh}
            </div>
          )}
          {wotd.examples[0] && (
            <p className="mt-4 font-serif text-[16px] leading-relaxed text-quote">
              “<Highlight text={wotd.examples[0].sentenceEn} word={wotd.word} />”
            </p>
          )}
        </div>
      </div>

      <DailyGoalCard />

      <StatsPanel />

      {/* due today */}
      <div>
        <div className="mb-4 flex items-center gap-3">
          <h3 className="font-serif text-[21px] font-medium italic text-ink-soft">
            {t("today.dueToday")}
          </h3>
          <span className="h-px flex-1 bg-black/[0.08]" />
          {dueList.length > 0 && (
            <Link href="/review" className="text-sm font-semibold text-sage hover:text-sage-deep">
              {t("today.reviewAll")}
            </Link>
          )}
        </div>
        {dueList.length === 0 ? (
          <div className="anim-fade-up rounded-[18px] border border-black/[0.06] bg-surface p-6 text-center">
            <PartyPopper className="mx-auto h-7 w-7 text-sage" />
            <p className="mt-1.5 font-serif text-[18px] font-medium text-ink">{t("today.allCaughtUp")}</p>
            <p className="mt-1 text-sm text-ink-soft">{t("today.allCaughtUpHint")}</p>
          </div>
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {dueList.map((w, i) => (
              <Link
                key={w.id}
                href={`/word/${w.id}`}
                className="anim-fade-up flex min-h-[110px] flex-col rounded-[18px] border border-black/[0.06] bg-surface p-[18px] transition-shadow hover:shadow-[0_10px_30px_rgba(46,42,38,0.08)]"
                style={{ animationDelay: `${180 + i * 50}ms` }}
              >
                <div className="flex items-baseline gap-2.5">
                  <span className="font-serif text-[22px] font-semibold text-ink">{w.word}</span>
                  {w.meaningZh && (
                    <span className={`text-sm text-sage ${w.targetLang === "zh" || w.targetLang === "zh-Hant" ? "font-zh" : ""}`}>
                      {w.meaningZh}
                    </span>
                  )}
                </div>
                {/* status pinned to the card bottom, independent of the meaning length */}
                <div className="mt-auto pt-2 text-xs font-medium text-ink-faint">
                  {w.reviewCount === 0 ? t("today.neverReviewed") : t("today.reviewsDone", { n: w.reviewCount })}
                  {w.partOfSpeech ? ` · ${w.partOfSpeech}` : ""}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
