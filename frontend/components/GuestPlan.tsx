"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { langLabel } from "@/lib/langs";
import { setLevel as setPrefLevel, pushRecentPair, setNativeLang, setDailyGoal, setNewPerDay } from "@/lib/learnPrefs";
import { Button } from "@/components/ui/button";
import { prefetchCoachPicks } from "@/components/CoachPicks";
import { CEFR_FOR_HSK, clearGuestPlan, type GuestPlan } from "@/components/HskFirstRun";
import { cn } from "@/lib/utils";
import { Check, Loader2, Sparkles } from "lucide-react";

// The onboarding a guest did before signing in, landing on the account: the
// target, daily goal and language, the reasons and interests (coach memory),
// the check's answers, and the first deck as cards. Runs once, right after
// sign-in and with nothing else on screen (OnboardingGate), as the loading the
// flow promised: the words are made and their meanings written in the learner's
// language, and only then does it say "ready". It used to drop them on Today
// with a progress popup still translating from English. Examples keep arriving
// in the background; nothing waits on them. The Coach's picks start here too.
export function FinishGuestPlan({ plan, onDone }: { plan: GuestPlan; onDone: () => void }) {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [failed, setFailed] = useState<string | null>(null);
  const [stage, setStage] = useState(0); // lines ticked off; 3 = ready
  const [ready, setReady] = useState<Word[]>([]);
  const started = useRef(false);

  async function apply() {
    setFailed(null);
    setStage(0);
    const level = CEFR_FOR_HSK[plan.target] ?? "B1";
    try {
      setNativeLang(plan.native);
      setPrefLevel("zh", level);
      pushRecentPair("zh", plan.native);
      setDailyGoal(plan.daily);
      setNewPerDay(plan.daily); // review introduces what the plan promised, not the default 15
      try {
        localStorage.setItem("lexa.wordPair", JSON.stringify({ sourceLang: "zh", targetLang: plan.native }));
      } catch {
        /* ignore */
      }
      await api.updateLearnerPrefs({ hskVersion: plan.version, hskTarget: plan.target, nativeLang: plan.native, dailyGoal: plan.daily });
      void api
        .updateCoachProfile({ telegramId: accountId, lang: "zh", goal: plan.goal, interests: plan.likes })
        .catch(() => {})
        .then(() => prefetchCoachPicks(qc, accountId, "zh", plan.native));
      if (plan.known.length || plan.unknown.length) {
        await api.savePlacement({ sourceLang: "zh", targetLang: plan.native, level, known: plan.known, unknown: plan.unknown });
      }
      setStage(1);
      if (plan.words.length) {
        // The cards exist in a moment; the meanings take the few seconds after.
        const tick = window.setTimeout(() => setStage((s) => Math.max(s, 2)), 1200);
        await api.batchAddWords({ telegramId: accountId, sourceLang: "zh", targetLang: plan.native, words: plan.words, level, enrich: true, meaningsFirst: true });
        window.clearTimeout(tick);
        const all = await api.listWords(accountId);
        const wanted = new Set(plan.words);
        setReady(all.filter((w) => wanted.has(w.word)));
      }
      clearGuestPlan();
      for (const key of ["words", "stats", "hskReadiness", "hskDaily", "hskLists"]) qc.invalidateQueries({ queryKey: [key] });
      setStage(3);
    } catch (e) {
      setFailed(errText(e, t));
    }
  }

  useEffect(() => {
    if (!accountId || started.current) return;
    started.current = true;
    void apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const lines = [
    t("onb.prep.plan"),
    t("onb.prep.cards", { n: plan.words.length }),
    plan.native === "en" ? t("onb.prep.meaningsEn") : t("onb.prep.meanings", { lang: langLabel(plan.native) }),
  ];

  if (stage === 3)
    return (
      <section className="anim-fade-up rounded-[22px] border border-sage/25 bg-gradient-to-br from-sage-tint/50 via-surface to-surface p-5 sm:p-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-sage text-white">
          <Check className="h-6 w-6" />
        </div>
        <h2 className="mt-4 font-serif text-[26px] font-medium text-ink">{t("onb.welcomeTitle")}</h2>
        <p className="mt-1 text-[15px] text-ink-soft">{t("onb.welcomeSub", { n: ready.length || plan.words.length })}</p>
        {/* Above the list: twenty rows put it a scroll away on a phone. */}
        <Button className="mt-4 w-full sm:w-auto" onClick={onDone}>
          <Sparkles className="mr-2 h-4 w-4" />
          {t("onb.welcomeContinue")}
        </Button>
        {ready.length > 0 && (
          <ul className="mt-4 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {ready.map((w) => (
              <li key={w.id} className="flex min-w-0 items-baseline gap-2 rounded-[12px] bg-surface/80 px-3 py-2">
                <span className="shrink-0 font-zh text-[17px] font-semibold text-ink">{w.word}</span>
                <span className="shrink-0 text-[12px] text-ink-faint">{w.phonetic}</span>
                <span className="min-w-0 truncate text-[13px] text-sage-deep">{w.meaningZh}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    );

  return (
    <section className="anim-fade-up rounded-[22px] border border-sage/25 bg-gradient-to-br from-sage-tint/50 via-surface to-surface p-5 sm:p-6">
      <h2 className="font-serif text-[22px] font-medium text-ink">{t("onb.finishing")}</h2>
      <p className="mt-1 mb-4 text-[14px] text-ink-soft">{t("onb.finishingSub", { n: plan.words.length })}</p>
      <ul className="space-y-3">
        {lines.map((line, i) => (
          <li key={i} className="flex items-center gap-3 text-[15px]">
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
                i < stage ? "bg-sage text-white" : "bg-sage-tint/60 text-sage-deep",
              )}
            >
              {i < stage ? (
                <Check className="h-4 w-4" />
              ) : i === stage && !failed ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
              )}
            </span>
            <span className={cn("transition-colors duration-300", i <= stage ? "text-ink" : "text-ink-faint")}>{line}</span>
          </li>
        ))}
      </ul>
      {failed && (
        <div className="mt-5 space-y-3">
          <p className="text-[13px] text-warn-text">{failed}</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void apply()}>{t("errState.retry")}</Button>
            <Button
              variant="outline"
              onClick={() => {
                clearGuestPlan();
                onDone();
              }}
            >
              {t("onb.finishSkip")}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
