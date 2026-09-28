"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api, isDue } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { langLabel } from "@/lib/langs";
import { CoachPicks, readPair } from "@/components/CoachPicks";
import { cn } from "@/lib/utils";
import { Compass, MessageCircle, Clapperboard, ArrowRight } from "lucide-react";

const srcFont = (l: string) => (l === "zh" || l === "zh-Hant" || l === "ja" ? "font-zh" : "");

export default function CoachPage() {
  const { accountId, profile: account } = useAccount();
  const { t } = useI18n();
  const router = useRouter();

  const { data: words } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
    enabled: !!accountId,
  });
  const deck = useMemo(() => words ?? [], [words]);
  // Stats used by the living greeting (no AI, no tokens).
  const due = deck.filter(isDue).length;
  const weak = deck.filter((w) => (w.lapses ?? 0) >= 2).length;
  const weakTop = deck
    .filter((w) => (w.lapses ?? 0) >= 2)
    .sort((a, b) => (b.lapses ?? 0) - (a.lapses ?? 0))
    .slice(0, 4);

  // Same focus-ids contract as the Home briefing card: stash the slipping words so
  // /coach/practice drills exactly them.
  const focusWeak = () => {
    const ids = deck
      .filter((w) => (w.lapses ?? 0) >= 2)
      .map((w) => w.id)
      .slice(0, 8);
    sessionStorage.setItem("lexa.coachFocusIds", JSON.stringify(ids));
    router.push("/coach/practice");
  };

  // The pair "Words for you" works in (it owns the picker); the goal below is read
  // for the same language.
  const [pair] = useState(() => readPair());

  // Coach memory: the learner's goal powers a "get to know you" prompt + tailored picks.
  // Scoped to the selected source language so an English goal never leaks into Chinese.
  const { data: profile } = useQuery({
    queryKey: ["coach-profile", accountId, pair.source],
    queryFn: () => api.coachProfile(accountId, pair.source),
    enabled: !!accountId,
  });

  // An HSK learner's goal is a level, and the readiness mark says how far off it
  // is — the concrete fact a goal remark should carry (same cache as the mark).
  const hskTarget = pair.source === "zh" || pair.source === "zh-Hant" ? (account?.hskTarget ?? null) : null;
  const { data: readiness } = useQuery({
    queryKey: ["hskReadiness", accountId],
    queryFn: () => api.hskReadiness(),
    enabled: !!accountId && hskTarget != null,
  });

  // Stats power the "living" greeting: streak, whether you trained today, yesterday's activity.
  const { data: stats } = useQuery({
    queryKey: ["stats", accountId],
    queryFn: () => api.stats(accountId),
    enabled: !!accountId,
  });
  // This week's pulse for the recap card — pure arithmetic over stats.days, no tokens.
  const weekDays = (stats?.days ?? []).slice(-7);
  const weekAdded = weekDays.reduce((s, d) => s + d.added, 0);
  const weekReviewed = weekDays.reduce((s, d) => s + d.reviews, 0);
  const weekMax = Math.max(1, ...weekDays.map((d) => d.reviews));
  // Best streak BEFORE this session, frozen — so a new record is celebrated all day
  // and quietly retired tomorrow. Persisted below when the current streak beats it.
  const [bestStreak] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    try {
      return Number(localStorage.getItem("lexa.bestStreak") ?? 0) || 0;
    } catch {
      return 0;
    }
  });
  useEffect(() => {
    const s = stats?.streak ?? 0;
    if (s > bestStreak) {
      try {
        localStorage.setItem("lexa.bestStreak", String(s));
      } catch {
        /* ignore */
      }
    }
  }, [stats?.streak, bestStreak]);


  // A living one-liner from the coach: a time-of-day greeting plus a remark drawn
  // from your streak, today's/yesterday's activity, due & weak words, and goal.
  // Rotates through the day (morning/afternoon/evening) so it feels alive. No tokens.
  const coachLine = useMemo(() => {
    const hour = new Date().getHours();
    const greeting =
      hour < 5 ? t("coach.gLate") : hour < 12 ? t("coach.gMorning") : hour < 18 ? t("coach.gDay") : t("coach.gEve");

    const goal = profile?.goal?.trim();
    const streak = stats?.streak ?? 0;
    const trainedToday = (stats?.trainedToday ?? 0) > 0;
    const lifetimeReviews = stats?.reviews ?? 0;
    const yStr = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const days = stats?.days ?? [];
    const practicedYesterday = days.some((d) => d.date === yStr && d.reviews > 0);
    // Days since your last review (0 if you trained today) — powers "welcome back".
    let gap = 0;
    for (let i = days.length - 1; i >= 0; i--) {
      if (days[i].reviews > 0) break;
      gap++;
    }
    // A word you actually reviewed yesterday and still found hard — the freshest, most
    // specific thing the coach can bring up ("yesterday you stumbled on X").
    const yWord = deck
      .filter((w) => w.lastReview && new Date(w.lastReview).toISOString().slice(0, 10) === yStr)
      .sort((a, b) => (b.difficulty ?? 0) - (a.difficulty ?? 0) || (b.lapses ?? 0) - (a.lapses ?? 0))[0];
    const yWordHard = yWord && ((yWord.lapses ?? 0) >= 1 || (yWord.difficulty ?? 0) >= 6) ? yWord : undefined;

    // Seed changes each 6-hour block, so the line refreshes across a single day.
    const seed = Math.floor(Date.now() / 86_400_000) * 4 + Math.floor(hour / 6);

    // A brand-new personal-best streak trumps everything — celebrate it all day.
    if (streak >= 2 && streak > bestStreak) return `${greeting} ${t("coach.sayRecord", { n: streak })}`;
    // Never practised yet, but there are words to practise — a warm first-time nudge.
    if (lifetimeReviews === 0 && deck.length > 0) return `${greeting} ${t("coach.sayFirst")}`;

    // Situational remarks, most-personal first; we rotate among whichever apply.
    const opts: string[] = [];
    if (trainedToday) opts.push(t("coach.sayDoneToday"));
    if (streak >= 3) opts.push(t("coach.sayStreak", { n: streak }));
    // Back after a real absence (had history, quiet for a while) — welcome them gently.
    if (!trainedToday && gap >= 5 && lifetimeReviews > 0) opts.push(t("coach.sayBreak", { n: gap }));
    if (!trainedToday && practicedYesterday) opts.push(t("coach.sayKeepPace"));
    if (!trainedToday && !practicedYesterday && gap < 5 && streak === 0) opts.push(t("coach.sayComeback"));
    // Yesterday's specific slip beats a generic weak-word mention.
    if (yWordHard) opts.push(t("coach.sayStumbleY", { word: yWordHard.word }));
    // Name the single word that keeps tripping you up — concrete beats a count.
    if (weakTop[0]) opts.push(t("coach.sayStumble", { word: weakTop[0].word }));
    if (weak > 1) opts.push(t("coach.sayWeak", { n: weak }));
    if (due >= 15) opts.push(t("coach.sayDue", { n: due }));
    // The goal as facts and a next step, never the learner's own words quoted
    // back ("I remember — your goal is “HSK 4 (in 1-3 months), Study in China”"
    // read like a form echoing its input).
    if (hskTarget) {
      const level = hskTarget === 7 ? "7–9" : String(hskTarget);
      opts.push(t("coach.sayGoalHsk", { level }));
      if (readiness?.total) opts.push(t("coach.sayReadiness", { known: readiness.recognise, total: readiness.total, level }));
    } else if (goal) {
      opts.push(t("coach.sayGoal"));
      opts.push(t("coach.sayGoalPush")); // a second, goal-flavoured nudge
    } else {
      opts.push(t("coach.sayAskGoal", { lang: langLabel(pair.source) }));
    }
    opts.push(t("coach.sayWarm"));
    // A rare "thought of the day" — one micro-tip joins the rotation, so it surfaces
    // occasionally and feels like a real remark rather than noise.
    const tips = [t("coach.tip1"), t("coach.tip2"), t("coach.tip3"), t("coach.tip4"), t("coach.tip5")];
    opts.push(tips[seed % tips.length]);

    const remark = opts[seed % opts.length];
    return `${greeting} ${remark}`;
  }, [weak, due, weakTop, deck, profile?.goal, pair.source, stats, bestStreak, hskTarget, readiness, t]);

  return (
    <div className="anim-fade-up mx-auto max-w-[760px] space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-serif text-[30px] font-medium tracking-[-0.01em] text-ink">
          <Compass className="h-7 w-7 text-sage-deep" /> {t("coach.title")}
        </h1>
        {/* Living greeting — a friendly, context-aware line instead of a static subtitle */}
        <div className="mt-2 flex items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sage text-white">
            <Compass className="h-[17px] w-[17px]" />
          </span>
          <div className="min-w-0">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-sage-deep">{t("coach.name")}</div>
            <p className="rounded-[16px] rounded-tl-[4px] border border-sage/20 bg-sage-tint px-3.5 py-2 text-[14px] leading-relaxed text-ink shadow-sm">
              {coachLine}
            </p>
          </div>
        </div>
      </div>

      {/* Words for you — first: it is what this page is for, and at the bottom it sat
          under the recap and both practice cards, a phone-length scroll away */}
      <CoachPicks />

      {/* This week — a token-free recap: activity bars + the words slipping right now */}
      {stats && ((weekAdded + weekReviewed > 0) || weakTop.length > 0) && (
        <section className="rounded-[20px] border border-black/[0.07] bg-surface p-4 sm:p-5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-sage-deep">{t("coach.weekTitle")}</div>
          <p className="mt-1.5 text-[13px] leading-snug text-ink-soft">
            {t("coach.weekLine", {
              added: String(weekAdded),
              reviewed: String(weekReviewed),
              mastered: String(stats.mastered ?? 0),
            })}
          </p>
          <div className="mt-3.5 flex items-end gap-1.5">
            {weekDays.map((d, i) => (
              <div key={d.date} className="min-w-0 flex-1" title={`${d.date} · ${d.reviews}`}>
                <div
                  className={cn(
                    "w-full rounded-full",
                    d.reviews ? (i === weekDays.length - 1 ? "bg-sage-deep" : "bg-sage") : "bg-sage/15",
                  )}
                  style={{ height: d.reviews ? 8 + Math.round((24 * d.reviews) / weekMax) : 4 }}
                />
              </div>
            ))}
          </div>
          {weakTop.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/[0.06] pt-3.5">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-warn-text">
                  {t("coach.weekWatch")}
                </span>
                {weakTop.map((w) => (
                  <span
                    key={w.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-warn/30 bg-warn-bg/60 px-2.5 py-1 text-[13px] font-semibold text-ink"
                  >
                    <span className={srcFont(pair.source)}>{w.word}</span>
                    <span className="text-[11px] font-bold text-warn-text">
                      {t("coach.weakLapses", { n: String(w.lapses ?? 0) })}
                    </span>
                  </span>
                ))}
              </div>
              <button
                onClick={focusWeak}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sage-deep"
              >
                {t("coach.weekDrill")} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </section>
      )}

      {/* Practice options — scene and chat as equal, side-by-side cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Link
          href="/coach/scene"
          className="group flex h-full flex-col rounded-[20px] border border-sage/25 bg-surface p-5 transition-shadow hover:shadow-[0_14px_36px_rgba(46,42,38,0.09)]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sage text-white">
            <Clapperboard className="h-5 w-5" />
          </span>
          <h2 className="mt-3 font-serif text-[19px] font-semibold text-ink">{t("scene.heroTitle")}</h2>
          <p className="mt-1 flex-1 text-[13px] leading-snug text-ink-soft">{t("scene.card")}</p>
          <span className="mt-4 inline-flex items-center gap-1.5 self-start rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition-colors group-hover:bg-sage-deep">
            <Clapperboard className="h-4 w-4" /> {t("scene.begin")}
          </span>
        </Link>

        <Link
          href="/coach/chat"
          className="group flex h-full flex-col rounded-[20px] border border-black/[0.07] bg-surface p-5 transition-shadow hover:shadow-[0_14px_36px_rgba(46,42,38,0.09)]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-sage-tint text-sage-deep">
            <MessageCircle className="h-5 w-5" />
          </span>
          <h2 className="mt-3 font-serif text-[19px] font-semibold text-ink">{t("chat.title")}</h2>
          <p className="mt-1 flex-1 text-[13px] leading-snug text-ink-soft">{t("chat.card")}</p>
          <span className="mt-4 inline-flex items-center gap-1.5 self-start rounded-full border border-sage/50 bg-sage-tint/40 px-4 py-2 text-sm font-semibold text-sage-deep transition-colors hover:bg-sage-tint">
            <MessageCircle className="h-4 w-4" /> {t("chat.start")}
          </span>
        </Link>
      </div>

    </div>
  );
}
