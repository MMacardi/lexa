"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api, isDue, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { FirstRun } from "@/components/FirstRun";
import { StatsPanel } from "@/components/StatsPanel";
import { DailyGoalCard } from "@/components/DailyGoalCard";
import { HskTrack } from "@/components/HskTrack";
import { CoachPicks } from "@/components/CoachPicks";
import { InstallApp } from "@/components/InstallApp";
import { HskReadiness } from "@/components/HskReadiness";
import { Disclosure } from "@/components/ui/Disclosure";
import { useNewPerDay } from "@/lib/learnPrefs";
import { ErrorState } from "@/components/ErrorState";
import { FOCUS } from "@/lib/focus";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, PartyPopper, ArrowRight, BarChart3 } from "lucide-react";

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
  const { accountId, profile } = useAccount();
  const { t, locale } = useI18n();
  const newPerDay = useNewPerDay();
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
  const mastered = list.filter((w) => w.reviewCount >= 5).length;
  const learning = collected - mastered;

  if (collected === 0)
    return (
      <div className="anim-fade-up space-y-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
            {dateStr}
          </div>
        </div>
        <FirstRun />
      </div>
    );

  const wotd: Word = list[new Date().getDate() % collected] ?? list[0];
  const dueList = list.filter(isDue).slice(0, 6);

  // The one due number: what "Start review" will actually hold — reviews that are
  // due plus today's share of new cards, the way the review page builds its deck.
  // Three counts used to sit side by side ("2 due" in the briefing, 3 on a tile,
  // the session somewhere else) and disagree.
  const reviewedDue = list.filter((w) => w.reviewCount > 0 && isDue(w)).length;
  const newDue = list.filter((w) => w.reviewCount === 0 && isDue(w)).length;
  const session = reviewedDue + Math.min(newDue, newPerDay);
  const minutes = Math.max(1, Math.round((session * 8) / 60));
  const weakIds = list.filter((w) => (w.lapses ?? 0) >= 2).map((w) => w.id);
  const onTrack = profile?.hskTarget != null;
  const practiseWeak = () => {
    try {
      sessionStorage.setItem("lexa.coachFocusIds", JSON.stringify(weakIds.slice(0, 8)));
    } catch {
      /* no storage: the drill picks its own words */
    }
  };

  // Today in one or two phone screens (BACKLOG "Today, shorter"): the review, the
  // day's new words, the goal — the loop. Everything that's a look back rather
  // than a step (the stat tiles, the word of the day, the readiness table, the
  // list of due words) folds away under "More on your progress".
  return (
    <div className="space-y-6">
      {/* header */}
      <div className="anim-fade-up flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">{dateStr}</div>
          <h1 className="mt-3 font-serif text-[30px] font-medium leading-[1.08] tracking-[-0.01em] text-ink sm:text-[40px]">
            {t("today.greeting")}
          </h1>
        </div>
        <Link
          href="/reader"
          className="inline-flex shrink-0 items-center gap-2 rounded-full border border-black/[0.08] bg-surface px-4 py-2.5 text-[14px] font-semibold text-ink-muted transition-colors hover:border-sage hover:text-sage-deep"
        >
          <BookOpen className="h-4 w-4" /> {t("nav.reader")}
        </Link>
      </div>

      {/* the review: one number, one button */}
      {session > 0 ? (
        <div className="anim-fade-up rounded-[24px] bg-onyx p-6 sm:p-7">
          <Link href="/review?go=1" className="group block">
            <div className="text-xs font-semibold uppercase tracking-[0.12em] text-taupe-dim">{t("today.duePanel")}</div>
            <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <span className="font-serif text-[52px] font-semibold leading-none text-[#f4f1ec]">{session}</span>
              <span className="text-[17px] font-medium text-taupe">{t("today.sessionReady", { m: minutes })}</span>
            </div>
            <span className="mt-5 inline-flex items-center gap-2 rounded-full bg-sage px-5 py-2.5 text-[15px] font-semibold text-white transition-colors group-hover:bg-sage-deep">
              {t("today.startReview")} <ArrowRight className="h-4 w-4" />
            </span>
          </Link>
          {weakIds.length > 0 && (
            <Link
              href="/coach/practice"
              onClick={practiseWeak}
              className="mt-4 block border-t border-white/10 pt-3 text-[13px] text-taupe transition-colors hover:text-white"
            >
              {t("today.weakAfter", { n: weakIds.length })} →
            </Link>
          )}
        </div>
      ) : (
        <div className="anim-fade-up flex items-center gap-4 rounded-[24px] border border-sage/25 bg-gradient-to-br from-sage-tint/55 via-surface to-surface p-5">
          <PartyPopper className="h-7 w-7 shrink-0 text-sage" />
          <div className="min-w-0 flex-1">
            <p className="font-serif text-[20px] font-medium text-ink">{t("today.allCaughtUp")}</p>
            <p className="mt-0.5 text-[14px] text-ink-soft">
              {weakIds.length > 0
                ? t("coach.briefWeak", { n: weakIds.length })
                : onTrack
                  ? t("today.caughtUpDaily")
                  : t("today.allCaughtUpHint")}
            </p>
          </div>
          {weakIds.length > 0 && (
            <Link
              href="/coach/practice"
              onClick={practiseWeak}
              className="shrink-0 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white hover:bg-sage-deep"
            >
              {t("coach.briefWeakCta")}
            </Link>
          )}
        </div>
      )}

      {/* install to the home screen: only where it applies, once dismissed never again */}
      <InstallApp />

      {/* today's new words (HSK + topic), or the way onto the HSK track */}
      <HskTrack withReadiness={false} />

      {/* Mika's picks aim at the same thing as Today's words; on the HSK track that
          card already brings the level and the topic, so the picks live on the Coach. */}
      {!onTrack && <CoachPicks compact />}

      <DailyGoalCard />

      {/* the look back, folded */}
      <Disclosure
        summary={
          <span className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-sage" />
            {t("today.more")}
            <span className="font-medium text-ink-faint">{t("today.moreSummary", { n: collected, m: mastered })}</span>
          </span>
        }
      >
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-2.5">
            <Stat value={collected} label={t("today.wordsCollected")} accent />
            <Stat value={learning} label={t("today.stillLearning")} />
            <Stat value={mastered} label={t("today.mastered")} />
          </div>

          <div>
            <h3 className="font-serif text-[18px] font-medium italic text-ink-soft">{t("today.wotd")}</h3>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <Link href={`/word/${wotd.id}`} className="break-words font-serif text-[28px] font-semibold text-ink hover:text-sage-deep">
                {wotd.word}
              </Link>
              {wotd.phonetic && <span className="text-[15px] text-ink-faint">{wotd.phonetic}</span>}
            </div>
            {wotd.meaningZh && (
              <div className={`mt-1 text-[17px] font-medium text-sage ${wotd.targetLang === "zh" || wotd.targetLang === "zh-Hant" ? "font-zh" : ""}`}>
                {wotd.meaningZh}
              </div>
            )}
            {wotd.examples[0] && (
              <p className="mt-3 font-serif text-[15px] leading-relaxed text-quote">
                “<Highlight text={wotd.examples[0].sentenceEn} word={wotd.word} />”
              </p>
            )}
          </div>

          {onTrack && <HskReadiness />}

          {/* the charts: a browsing surface, not a step of the loop (F7) */}
          {!FOCUS && <StatsPanel />}

          {dueList.length > 0 && (
            <div>
              <div className="mb-3 flex items-center gap-3">
                <h3 className="font-serif text-[18px] font-medium italic text-ink-soft">{t("today.dueToday")}</h3>
                <span className="h-px flex-1 bg-black/[0.08]" />
                <Link href="/review?go=1" className="text-sm font-semibold text-sage hover:text-sage-deep">
                  {t("today.reviewAll")}
                </Link>
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {dueList.map((w) => (
                  <Link
                    key={w.id}
                    href={`/word/${w.id}`}
                    className="flex flex-col rounded-[16px] border border-black/[0.06] bg-paper/60 px-4 py-3 transition-shadow hover:shadow-[0_10px_30px_rgba(46,42,38,0.08)]"
                  >
                    <div className="flex flex-wrap items-baseline gap-x-2.5">
                      <span className="break-words font-serif text-[19px] font-semibold text-ink">{w.word}</span>
                      {w.meaningZh && (
                        <span className={`text-sm text-sage ${w.targetLang === "zh" || w.targetLang === "zh-Hant" ? "font-zh" : ""}`}>
                          {w.meaningZh}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-xs font-medium text-ink-faint">
                      {w.reviewCount === 0 ? t("today.neverReviewed") : t("today.reviewsDone", { n: w.reviewCount })}
                      {w.partOfSpeech ? ` · ${w.partOfSpeech}` : ""}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </Disclosure>
    </div>
  );
}
