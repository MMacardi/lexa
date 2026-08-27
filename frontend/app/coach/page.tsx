"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, isDue } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { getLevel, getExampleStyle, useNewPerDay, setNewPerDay, NEW_PER_DAY_OPTIONS } from "@/lib/learnPrefs";
import { isAiSupported, langLabel } from "@/lib/langs";
import { LangSelect } from "@/components/LangSelect";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Compass, RefreshCw, Check, Loader2, Plus, RotateCcw, Dumbbell, Sprout, CalendarDays } from "lucide-react";

type Pick = { word: string; meaning: string; reason: string };

function readPair(): { source: string; target: string } {
  if (typeof window === "undefined") return { source: "en", target: "zh" };
  try {
    const p = JSON.parse(localStorage.getItem("lexa.wordPair") ?? "null") as { sourceLang?: string; targetLang?: string };
    const source = p?.sourceLang && p.sourceLang !== "auto" ? p.sourceLang : "en";
    return { source, target: p?.targetLang || "zh" };
  } catch {
    return { source: "en", target: "zh" };
  }
}

const srcFont = (l: string) => (l === "zh" || l === "zh-Hant" || l === "ja" ? "font-zh" : "");

export default function CoachPage() {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show, trackImport } = useToast();
  const qc = useQueryClient();
  const router = useRouter();

  // Hand the learner's weak words to the review screen for a focused drill.
  function startWeakDrill(ids: string[]) {
    if (!ids.length) return;
    try {
      sessionStorage.setItem("lexa.reviewFocusIds", JSON.stringify(ids));
    } catch {
      /* ignore */
    }
    router.push("/review");
  }

  const { data: words } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
    enabled: !!accountId,
  });
  const deck = words ?? [];
  // Today's plan — computed from the deck (no AI, no tokens).
  const due = deck.filter(isDue).length;
  const weak = deck.filter((w) => (w.lapses ?? 0) >= 2).length; // words you keep forgetting
  const mastered = deck.filter((w) => w.reviewCount >= 5).length;
  const NEW_TARGET = 5;
  const mins = Math.max(1, Math.round((due + weak) * 0.4 + NEW_TARGET * 0.8)); // rough estimate
  // Review-plan pacing: how the deck's still-new words get phased in over days.
  const newPerDay = useNewPerDay();
  const newLeft = deck.filter((w) => w.reviewCount === 0).length;
  const planDays = newLeft > 0 ? Math.ceil(newLeft / newPerDay) : 0;
  const planMins = Math.max(1, Math.round(newPerDay * 0.5 + due * 0.3));
  // "This week" recap — progress tracking from the deck (no AI, no tokens).
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const addedThisWeek = deck.filter((w) => new Date(w.createdAt).getTime() >= weekAgo).length;
  const reviewedThisWeek = deck.filter((w) => w.lastReview && new Date(w.lastReview).getTime() >= weekAgo).length;
  const weakTop = deck
    .filter((w) => (w.lapses ?? 0) >= 2)
    .sort((a, b) => (b.lapses ?? 0) - (a.lapses ?? 0))
    .slice(0, 4);
  const showRecap = addedThisWeek + reviewedThisWeek > 0;

  const [pair, setPair] = useState(() => readPair());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [theme, setTheme] = useState("");
  const [adding, setAdding] = useState(false);

  // Coach memory: the learner's goal powers a "get to know you" prompt + tailored picks.
  const { data: profile } = useQuery({
    queryKey: ["coach-profile", accountId],
    queryFn: () => api.coachProfile(accountId),
    enabled: !!accountId,
  });
  const [savingGoal, setSavingGoal] = useState(false);

  // Stats power the "living" greeting: streak, whether you trained today, yesterday's activity.
  const { data: stats } = useQuery({
    queryKey: ["stats", accountId],
    queryFn: () => api.stats(accountId),
    enabled: !!accountId,
  });
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

  // Cache the picks in the query client so they SURVIVE navigating away and back
  // (they used to be local state re-fetched — and re-charged — on every mount).
  const picksKey = ["coach-picks", accountId, pair.source, pair.target] as const;
  const picksQuery = useQuery({
    queryKey: picksKey,
    queryFn: () =>
      api.coachPicks({
        sourceLang: pair.source,
        targetLang: pair.target,
        level: getLevel(pair.source) ?? undefined,
        count: 8,
        theme: theme.trim() || undefined,
      }),
    enabled: !!accountId,
    staleTime: Infinity, // keep until the user asks for new picks
    gcTime: 30 * 60_000,
  });
  const picks = picksQuery.data?.picks ?? [];
  const loading = picksQuery.isFetching;
  const loaded = picksQuery.isSuccess;

  function setSource(source: string) {
    const next = { ...pair, source };
    setPair(next);
    try {
      localStorage.setItem("lexa.wordPair", JSON.stringify({ sourceLang: next.source, targetLang: next.target }));
    } catch {
      /* ignore */
    }
  }
  function setTarget(target: string) {
    const next = { ...pair, target };
    setPair(next);
    try {
      localStorage.setItem("lexa.wordPair", JSON.stringify({ sourceLang: next.source, targetLang: next.target }));
    } catch {
      /* ignore */
    }
  }

  // Prefill the "what to learn" box with the saved goal, so it's remembered but not nagged.
  useEffect(() => {
    const g = profile?.goal?.trim();
    if (g) setTheme((cur) => cur || g);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.goal]);

  // Gentle personalization: whatever you type in "what to learn" IS your goal — it's
  // quietly remembered and tailors the picks. No forced onboarding.
  async function saveThemeAndPicks() {
    if (savingGoal) return;
    const g = theme.trim();
    setSavingGoal(true);
    try {
      if (g) {
        await api.updateCoachProfile({ telegramId: accountId, goal: g });
        qc.invalidateQueries({ queryKey: ["coach-profile", accountId] });
      }
      const r = await api.coachPicks({
        sourceLang: pair.source,
        targetLang: pair.target,
        level: getLevel(pair.source) ?? undefined,
        count: 8,
        theme: g || undefined,
      });
      qc.setQueryData(picksKey, r);
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setSavingGoal(false);
    }
  }
  const loadPicks = () => void saveThemeAndPicks();

  // Select all freshly-loaded picks by default; surface fetch errors as a toast.
  useEffect(() => {
    setSel(new Set(picks.map((p) => p.word)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picksQuery.data]);
  useEffect(() => {
    if (picksQuery.isError) show({ icon: "⚠️", title: errText(picksQuery.error, t) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picksQuery.isError]);

  const toggle = (w: string) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(w)) n.delete(w);
      else n.add(w);
      return n;
    });

  async function addSelected() {
    const words = picks.filter((p) => sel.has(p.word)).map((p) => p.word);
    if (!words.length || adding) return;
    setAdding(true);
    try {
      const r = await api.batchAddWords({
        telegramId: accountId,
        sourceLang: pair.source,
        targetLang: pair.target,
        words,
        level: getLevel(pair.source) ?? undefined,
        exampleStyle: getExampleStyle(),
        enrich: isAiSupported(pair.source),
      });
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      if (r.job) trackImport({ jobId: r.job.id, telegramId: accountId, words, total: r.job.total, processed: 0 });
      show({ icon: "🌱", title: t("word.cardsCreated", { n: r.created }) });
      // Drop the added ones from the cached picks.
      const added = new Set(words);
      qc.setQueryData<{ picks: Pick[] }>(picksKey, (old) => (old ? { picks: old.picks.filter((x) => !added.has(x.word)) } : old));
      setSel(new Set());
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setAdding(false);
    }
  }

  const selectedCount = picks.filter((p) => sel.has(p.word)).length;

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
    const yStr = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const practicedYesterday = (stats?.days ?? []).some((d) => d.date === yStr && d.reviews > 0);

    // Seed changes each 6-hour block, so the line refreshes across a single day.
    const seed = Math.floor(Date.now() / 86_400_000) * 4 + Math.floor(hour / 6);

    // A brand-new personal-best streak trumps everything — celebrate it all day.
    if (streak >= 2 && streak > bestStreak) return `${greeting} ${t("coach.sayRecord", { n: streak })}`;

    // Situational remarks, most-personal first; we rotate among whichever apply.
    const opts: string[] = [];
    if (trainedToday) opts.push(t("coach.sayDoneToday"));
    if (streak >= 3) opts.push(t("coach.sayStreak", { n: streak }));
    if (!trainedToday && practicedYesterday) opts.push(t("coach.sayKeepPace"));
    if (!trainedToday && !practicedYesterday && streak === 0) opts.push(t("coach.sayComeback"));
    // Name the single word that keeps tripping you up — concrete beats a count.
    if (weakTop[0]) opts.push(t("coach.sayStumble", { word: weakTop[0].word }));
    if (weak > 1) opts.push(t("coach.sayWeak", { n: weak }));
    if (due >= 15) opts.push(t("coach.sayDue", { n: due }));
    if (goal) opts.push(t("coach.sayGoal", { goal }));
    else opts.push(t("coach.sayAskGoal", { lang: langLabel(pair.source) }));
    opts.push(t("coach.sayWarm"));
    // A rare "thought of the day" — one micro-tip joins the rotation, so it surfaces
    // occasionally and feels like a real remark rather than noise.
    const tips = [t("coach.tip1"), t("coach.tip2"), t("coach.tip3"), t("coach.tip4"), t("coach.tip5")];
    opts.push(tips[seed % tips.length]);

    const remark = opts[seed % opts.length];
    return `${greeting} ${remark}`;
  }, [weak, due, weakTop, profile?.goal, pair.source, stats, bestStreak, t]);

  return (
    <div className="anim-fade-up mx-auto max-w-[760px] space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-serif text-[30px] font-medium tracking-[-0.01em] text-ink">
          <Compass className="h-7 w-7 text-sage-deep" /> {t("coach.title")}
        </h1>
        {/* Living greeting — a friendly, context-aware line instead of a static subtitle */}
        <div className="mt-3 flex items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sage text-white">
            <Compass className="h-[17px] w-[17px]" />
          </span>
          <p className="rounded-[16px] rounded-tl-[4px] bg-sage-tint/45 px-3.5 py-2 text-[14.5px] leading-snug text-ink">
            {coachLine}
          </p>
        </div>
      </div>

      {/* Practice with your coach — the hero: an adaptive drill on your own words */}
      <Link
        href="/coach/practice"
        className="group block rounded-[22px] border border-sage/25 bg-gradient-to-br from-sage-tint/60 via-surface to-surface p-6 transition-shadow hover:shadow-[0_16px_40px_rgba(46,42,38,0.10)]"
      >
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-sage text-white">
            <Compass className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-[21px] font-semibold text-ink">{t("coach.practiceHeroTitle")}</h2>
            <p className="mt-1 text-[13.5px] leading-snug text-ink-soft">{t("coach.practiceCard")}</p>
            <span className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition-colors group-hover:bg-sage-deep">
              <Compass className="h-4 w-4" /> {due + weak > 0 ? t("coach.practiceOpen") : t("coach.practiceStart")}
            </span>
          </div>
        </div>
      </Link>

      {/* Words for you — level-appropriate picks, near the top so it's front-and-centre */}
      <section id="coach-picks" className="space-y-4 rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-[20px] font-medium text-ink">{t("coach.picksTitle")}</h2>
            <p className="mt-0.5 text-[13px] text-ink-soft">
              {t("coach.picksHint", { level: getLevel(pair.source) ?? "—", lang: langLabel(pair.source) })}
            </p>
          </div>
          <button
            type="button"
            onClick={loadPicks}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3.5 py-1.5 text-[13px] font-semibold text-ink-muted transition-colors hover:border-sage/60 hover:text-sage-deep disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t("coach.refresh")}
          </button>
        </div>

        {/* language pair */}
        <div className="flex flex-wrap items-center gap-2">
          <LangSelect value={pair.source} onChange={setSource} />
          <span className="text-ink-faint">→</span>
          <LangSelect value={pair.target} onChange={setTarget} />
        </div>

        {/* Your goal, in-context: type why you're learning → picks follow it and it's
            quietly remembered. No separate onboarding, no nagging. */}
        <div>
          <input
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") loadPicks();
            }}
            placeholder={t("coach.themePlaceholder")}
            maxLength={80}
            className="h-10 w-full rounded-[12px] border border-black/[0.08] bg-surface px-3.5 text-[14px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
          />
          <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-faint">
            <Compass className="h-3.5 w-3.5 shrink-0 text-sage" />
            {theme.trim() ? t("coach.themeRemembers") : t("coach.themeHint")}
          </p>
        </div>

        {/* picks */}
        {loading && picks.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-soft">{t("coach.loading")}</p>
        ) : picks.length === 0 && loaded ? (
          <p className="py-8 text-center text-sm text-ink-soft">{t("coach.empty")}</p>
        ) : (
          <div className="max-h-[336px] space-y-2 overflow-y-auto pr-1">
            {picks.map((p) => {
              const on = sel.has(p.word);
              return (
                <button
                  key={p.word}
                  type="button"
                  onClick={() => toggle(p.word)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-[14px] border p-3.5 text-left transition-colors",
                    on ? "border-sage/40 bg-sage-tint/45" : "border-black/[0.08] bg-surface opacity-80 hover:opacity-100",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                      on ? "border-sage bg-sage text-white" : "border-black/20 bg-surface",
                    )}
                  >
                    {on && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className={cn("text-[19px] font-semibold leading-tight text-ink", srcFont(pair.source))}>{p.word}</span>
                      {p.meaning && (
                        <span className={cn("text-[15px] font-medium text-sage", (pair.target === "zh" || pair.target === "zh-Hant") && "font-zh")}>
                          {p.meaning}
                        </span>
                      )}
                    </span>
                    {p.reason && <span className="mt-1 block text-[13px] leading-snug text-ink-soft">{p.reason}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {picks.length > 0 && (
          <Button onClick={addSelected} disabled={adding || selectedCount === 0} className="w-full">
            {adding ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("reader.queueing")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Plus className="h-4 w-4" /> {t("coach.addN", { n: selectedCount })}
              </span>
            )}
          </Button>
        )}
      </section>

      {/* Today's plan — deterministic, no AI */}
      <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
        <h2 className="font-serif text-[20px] font-medium text-ink">{t("coach.planTitle")}</h2>
        <div className="mt-4 grid grid-cols-3 gap-2.5">
          <div className="rounded-[14px] bg-sage-tint/50 p-3.5 text-center">
            <div className="flex items-center justify-center gap-1.5 text-sage-deep">
              <RotateCcw className="h-4 w-4" />
              <span className="font-serif text-[26px] font-bold leading-none">{due}</span>
            </div>
            <div className="mt-1.5 text-[12px] font-semibold text-ink-soft">{t("coach.pDue")}</div>
          </div>
          <button
            type="button"
            disabled={weak === 0}
            title={weak > 0 ? t("coach.drillWeak") : undefined}
            onClick={() => startWeakDrill(deck.filter((w) => (w.lapses ?? 0) >= 2).map((w) => w.id))}
            className="rounded-[14px] bg-warn-bg p-3.5 text-center transition-transform enabled:hover:scale-[1.03] disabled:cursor-default"
          >
            <div className="flex items-center justify-center gap-1.5 text-warn-text">
              <Dumbbell className="h-4 w-4" />
              <span className="font-serif text-[26px] font-bold leading-none">{weak}</span>
            </div>
            <div className="mt-1.5 text-[12px] font-semibold text-ink-soft">{t("coach.pWeak")}</div>
          </button>
          <div className="rounded-[14px] bg-black/[0.04] p-3.5 text-center">
            <div className="flex items-center justify-center gap-1.5 text-ink-muted">
              <Sprout className="h-4 w-4 text-sage" />
              <span className="font-serif text-[26px] font-bold leading-none">{NEW_TARGET}</span>
            </div>
            <div className="mt-1.5 text-[12px] font-semibold text-ink-soft">{t("coach.pNew")}</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/review"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition-colors",
              due + weak > 0 ? "bg-sage text-white hover:bg-sage-deep" : "pointer-events-none bg-black/[0.05] text-ink-faint",
            )}
          >
            <RotateCcw className="h-4 w-4" /> {t("coach.pReview")}
          </Link>
          <button
            type="button"
            onClick={() => document.getElementById("coach-picks")?.scrollIntoView({ behavior: "smooth" })}
            className="inline-flex items-center gap-1.5 rounded-full border border-sage/50 bg-sage-tint/40 px-4 py-2 text-sm font-semibold text-sage-deep transition-colors hover:bg-sage-tint"
          >
            <Plus className="h-4 w-4" /> {t("coach.pAddNew")}
          </button>
        </div>
        <p className="mt-3 text-[12px] text-ink-faint">{t("coach.planFoot", { mins, total: deck.length, mastered })}</p>
      </section>

      {/* Review plan — pace the deck's still-new words into a daily schedule */}
      <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
        <h2 className="flex items-center gap-2 font-serif text-[20px] font-medium text-ink">
          <CalendarDays className="h-5 w-5 text-sage-deep" /> {t("coach.planReviewTitle")}
        </h2>
        {newLeft > 0 ? (
          <>
            <p className="mt-1.5 text-[14px] leading-snug text-ink-soft">
              {t("coach.planReviewLine", { n: newLeft, per: newPerDay, days: planDays, mins: planMins })}
            </p>
            <div className="mt-4">
              <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">{t("coach.planPace")}</div>
              <div className="inline-flex flex-wrap gap-1 rounded-full bg-black/[0.05] p-1 text-sm font-semibold">
                {NEW_PER_DAY_OPTIONS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setNewPerDay(n)}
                    className={cn(
                      "rounded-full px-3.5 py-1.5 transition-colors",
                      newPerDay === n ? "bg-sage text-white" : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="ml-2 text-[13px] text-ink-soft">{t("coach.planPerDay")}</span>
            </div>
          </>
        ) : (
          <p className="mt-1.5 text-[14px] leading-snug text-ink-soft">{t("coach.planAllCaught")}</p>
        )}
      </section>

      {/* This week — a short coaching recap of progress */}
      {showRecap && (
        <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
          <h2 className="font-serif text-[20px] font-medium text-ink">{t("coach.weekTitle")}</h2>
          <p className="mt-1.5 text-[14px] leading-snug text-ink-soft">
            {t("coach.weekLine", { added: addedThisWeek, reviewed: reviewedThisWeek, mastered })}
          </p>
          {weakTop.length > 0 && (
            <div className="mt-3">
              <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">{t("coach.weekWatch")}</div>
              <div className="flex flex-wrap gap-1.5">
                {weakTop.map((w) => (
                  <Link
                    key={w.id}
                    href={`/word/${w.id}`}
                    className="rounded-full border border-warn/40 bg-warn-bg px-2.5 py-0.5 text-[13px] font-medium text-warn-text hover:opacity-80"
                  >
                    {w.word}
                  </Link>
                ))}
                <button
                  type="button"
                  onClick={() => startWeakDrill(deck.filter((w) => (w.lapses ?? 0) >= 2).map((w) => w.id))}
                  className="rounded-full border border-sage/50 bg-sage-tint/40 px-2.5 py-0.5 text-[13px] font-semibold text-sage-deep hover:bg-sage-tint"
                >
                  {t("coach.weekDrill")}
                </button>
              </div>
            </div>
          )}
        </section>
      )}

    </div>
  );
}
