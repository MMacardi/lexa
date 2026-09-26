"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type HskVersion, type LearnerPrefs, type StudyPace, type StudyPlan } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { setDailyGoal, setNewPerDay } from "@/lib/learnPrefs";
import { ExamCalendar, formatDay, shortDay } from "@/components/ExamCalendar";
import { cn } from "@/lib/utils";
import { CalendarDays, Check, ChevronDown, Target } from "lucide-react";

// The plan with a date (BACKLOG "A plan with a date"). The goal used to be a line
// of text — "HSK 4 (in 1–3 months)" — which went stale the week it was written
// and couldn't be changed without retyping it. Now it is the target, the day and
// a pace, and the plan says what they add up to, in minutes a day. When the date
// is out of reach it says so and offers the ways out (backend services/studyPlan.ts).

const MAX_LEVEL: Record<HskVersion, number> = { "2.0": 6, "3.0": 7 };
const short = shortDay;
const levelLabel = (n: number) => (n === 7 ? "7–9" : String(n));

export function usePlan() {
  const { accountId } = useAccount();
  return useQuery({ queryKey: ["hskPlan", accountId], queryFn: () => api.hskPlan(), enabled: !!accountId });
}

function useSavePlan() {
  const { patchProfile } = useAccount();
  const { show } = useToast();
  const { t } = useI18n();
  const qc = useQueryClient();
  return async (patch: LearnerPrefs) => {
    patchProfile(patch);
    try {
      await api.updateLearnerPrefs(patch);
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    }
    for (const key of ["hskPlan", "hskReadiness", "hskDaily"]) qc.invalidateQueries({ queryKey: [key] });
  };
}

const chip = (on: boolean) =>
  cn(
    "rounded-full border px-3.5 py-1.5 text-[14px] font-semibold transition-colors",
    on ? "border-sage bg-sage text-white" : "border-black/[0.08] bg-surface text-ink hover:bg-black/[0.03]",
  );

/** The whole plan: target, day, what they need, the paces. Saves as it's tapped. */
export function ExamPlan() {
  const { profile } = useAccount();
  const { t, locale } = useI18n();
  const save = useSavePlan();
  const { data: plan } = usePlan();
  const [calendar, setCalendar] = useState(false);

  const version: HskVersion = plan?.version ?? profile?.hskVersion ?? "3.0";
  const target = plan?.level ?? profile?.hskTarget ?? 4;
  const examDate = profile?.examDate !== undefined ? (profile.examDate?.slice(0, 10) ?? null) : (plan?.examDate ?? null);

  const pickPace = async (p: StudyPace) => {
    // Review introduces as many new cards as the plan brings, like onboarding does.
    setDailyGoal(p.words);
    setNewPerDay(p.words);
    await save({ dailyGoal: p.words });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {Array.from({ length: MAX_LEVEL[version] }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" aria-pressed={n === target} onClick={() => save({ hskVersion: version, hskTarget: n })} className={chip(n === target)}>
            HSK {levelLabel(n)}
          </button>
        ))}
        <span className="ml-1 inline-flex overflow-hidden rounded-full border border-black/[0.08] text-[12px] font-semibold">
          {(["3.0", "2.0"] as HskVersion[]).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={v === version}
              onClick={() => save({ hskVersion: v, hskTarget: Math.min(target, MAX_LEVEL[v]) })}
              className={cn("px-2.5 py-1 transition-colors", v === version ? "bg-sage-tint text-sage-deep" : "text-ink-faint hover:text-ink")}
            >
              {v}
            </button>
          ))}
        </span>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setCalendar((o) => !o)}
          aria-expanded={calendar}
          className="flex w-full items-center gap-2.5 rounded-[14px] border border-black/[0.08] bg-surface px-3.5 py-2.5 text-left transition-colors hover:bg-black/[0.02]"
        >
          <CalendarDays className="h-4 w-4 shrink-0 text-sage-deep" />
          <span className="min-w-0 flex-1 text-[14px] text-ink">
            {examDate ? (
              <>
                <span className="font-semibold">{formatDay(examDate, locale)}</span>
                {plan?.daysLeft != null && plan.daysLeft > 0 && (
                  <span className="text-ink-soft"> · {t("plan.inDays", { n: plan.daysLeft })}</span>
                )}
              </>
            ) : (
              <span className="text-ink-soft">{t("plan.date")}</span>
            )}
          </span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-ink-faint transition-transform", calendar && "rotate-180")} />
        </button>
        {calendar && (
          <div className="mt-2">
            <ExamCalendar
              value={examDate}
              onChange={(day) => {
                setCalendar(false);
                void save({ examDate: day });
              }}
            />
          </div>
        )}
      </div>

      {plan && <PlanBody plan={plan} onPace={pickPace} onLevel={(n) => save({ hskVersion: version, hskTarget: n })} />}
    </div>
  );
}

function PlanBody({ plan, onPace, onLevel }: { plan: StudyPlan; onPace: (p: StudyPace) => void; onLevel: (n: number) => void }) {
  const { t, locale } = useI18n();
  const level = levelLabel(plan.level);
  const status =
    plan.status === "fits"
      ? t("plan.fits", { m: plan.pick ?? 0 })
      : plan.status === "tight"
        ? t("plan.tight", { m: plan.need ?? 0 })
        : plan.status === "noDate"
          ? t("plan.noDateLine")
          : plan.status === "passed"
            ? t("plan.passed")
            : plan.status === "close"
              ? t("plan.close", { n: plan.daysLeft ?? 0 })
              : t("plan.done", { level });
  const onPaces = plan.paces.some((p) => p.words === plan.current.words);
  const max = plan.paces[plan.paces.length - 1];

  return (
    <div className="rounded-[16px] bg-paper p-4">
      {plan.status !== "done" && (
        <p className="text-[15px] font-semibold text-ink">
          {t(plan.exact ? "plan.left" : "plan.leftApprox", { n: plan.left, level })}
        </p>
      )}
      <p className={cn("mt-0.5 text-[14px]", plan.status === "tight" || plan.status === "passed" ? "text-warn-text" : "text-ink-soft")}>{status}</p>

      {/* The three ways out of a date no pace reaches: what you may already know,
          a closer level, or the most a day holds. */}
      {plan.status === "tight" && (
        <div className="mt-3 space-y-1.5">
          {plan.sweepLevel && (
            <Link
              href={`/hsk/${plan.version}/${plan.sweepLevel}/sweep`}
              className="block rounded-[12px] border border-sage/30 bg-surface px-3 py-2 text-[14px] transition-colors hover:bg-sage-tint/40"
            >
              <span className="font-semibold text-sage-deep">{t("plan.sweep", { level: levelLabel(plan.sweepLevel) })}</span>
              <span className="block text-[12px] text-ink-soft">{t("plan.sweepWhy")}</span>
            </Link>
          )}
          {plan.lower && (
            <button
              type="button"
              onClick={() => onLevel(plan.lower!.level)}
              className="block w-full rounded-[12px] border border-black/[0.08] bg-surface px-3 py-2 text-left text-[14px] font-semibold text-ink transition-colors hover:bg-black/[0.02]"
            >
              {t("plan.lower", { level: levelLabel(plan.lower.level), m: plan.lower.minutes })}
            </button>
          )}
          {plan.current.words !== max.words && (
            <button
              type="button"
              onClick={() => onPace(max)}
              className="block w-full rounded-[12px] border border-black/[0.08] bg-surface px-3 py-2 text-left text-[14px] font-semibold text-ink transition-colors hover:bg-black/[0.02]"
            >
              {t("plan.max", { level, m: max.minutes, date: short(max.finish, locale) })}
            </button>
          )}
        </div>
      )}

      {plan.status !== "done" && plan.status !== "close" && (
        <>
          <p className="mt-4 mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("plan.pace")}</p>
          <div className="grid grid-cols-2 gap-2">
            {plan.paces.map((p) => {
              const on = p.words === plan.current.words;
              return (
                <button
                  key={p.minutes}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onPace(p)}
                  className={cn(
                    "rounded-[14px] border px-3 py-2.5 text-left transition-colors",
                    on ? "border-sage bg-sage-tint/60" : "border-black/[0.08] bg-surface hover:bg-black/[0.02]",
                  )}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="font-serif text-[18px] font-semibold text-ink">{t("plan.min", { m: p.minutes })}</span>
                    {p.fits && <Check className="h-4 w-4 text-sage-deep" aria-label={t("plan.onTime")} />}
                  </span>
                  <span className="block text-[12px] text-ink-soft">{t("plan.words", { n: p.words })}</span>
                  <span className={cn("block text-[12px]", p.fits === false ? "text-warn-text" : "text-ink-faint")}>
                    {t("plan.by", { date: short(p.finish, locale) })}
                  </span>
                </button>
              );
            })}
          </div>
          {!onPaces && (
            <p className="mt-2 text-[12px] text-ink-soft">
              {t("plan.now", { n: plan.current.words, m: plan.current.minutes, date: short(plan.current.finish, locale) })}
            </p>
          )}
        </>
      )}

      {!plan.exact && plan.status !== "tight" && plan.sweepLevel && (
        <p className="mt-3 text-[12px] text-ink-soft">
          {t("plan.estimate")}{" "}
          <Link href={`/hsk/${plan.version}/${plan.sweepLevel}/sweep`} className="font-semibold text-sage-deep hover:text-sage">
            {t("plan.sweep", { level: levelLabel(plan.sweepLevel) })}
          </Link>
        </p>
      )}
    </div>
  );
}

/** Today's one line about the plan; tapping it opens the plan in place. */
export function PlanLine({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t, locale } = useI18n();
  const { data: plan } = usePlan();
  if (!plan) return null;
  const level = levelLabel(plan.level);
  const date = plan.examDate ? short(plan.examDate, locale) : "";
  // Behind: the date fits, but not at the pace they're on now.
  const behind = plan.status === "fits" && plan.perDay !== null && plan.current.words < plan.perDay;
  const text =
    plan.status === "fits"
      ? behind
        ? t("plan.line.behind", { level, date, m: plan.pick ?? 0 })
        : t("plan.line.fits", { level, date, m: plan.current.minutes })
      : plan.status === "tight"
        ? t("plan.line.tight", { level, date })
        : plan.status === "noDate"
          ? t("plan.line.noDate")
          : plan.status === "passed"
            ? t("plan.line.passed")
            : plan.status === "close"
              ? t("plan.line.close", { n: plan.daysLeft ?? 0 })
              : t("plan.line.done", { level });
  const warn = behind || plan.status === "tight" || plan.status === "passed";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={cn(
        "mt-1 inline-flex max-w-full items-center gap-1.5 text-left text-[13px] font-semibold transition-colors",
        warn ? "text-warn-text hover:opacity-80" : "text-sage-deep hover:text-sage",
      )}
    >
      <Target className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">{text}</span>
      <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 transition-transform", open && "rotate-180")} />
    </button>
  );
}
