"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { setLevel as setPrefLevel, pushRecentPair, setNativeLang, setDailyGoal, setNewPerDay } from "@/lib/learnPrefs";
import { Button } from "@/components/ui/button";
import { prefetchCoachPicks } from "@/components/CoachPicks";
import { CEFR_FOR_HSK, clearGuestPlan, type GuestPlan } from "@/components/HskFirstRun";
import { Loader2, Sparkles } from "lucide-react";

// The onboarding a guest did before signing in, landing on the account: the
// target, daily goal and language, the reasons and interests (coach memory),
// the check's answers, and the first deck as cards. Runs once, on the first
// Today after sign-in, so the learner arrives to their words — not to the
// onboarding again. The Coach's picks are started here too, so they follow.
export function FinishGuestPlan({ plan, onDone }: { plan: GuestPlan; onDone: () => void }) {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show, trackImport } = useToast();
  const qc = useQueryClient();
  const [failed, setFailed] = useState<string | null>(null);
  const started = useRef(false);

  async function apply() {
    setFailed(null);
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
      let created = 0;
      if (plan.words.length) {
        // Instant capture: reviewable at once, the Russian fills in behind.
        const r = await api.batchAddWords({ telegramId: accountId, sourceLang: "zh", targetLang: plan.native, words: plan.words, level, enrich: true });
        created = r.created;
        if (r.job) trackImport({ jobId: r.job.id, telegramId: accountId, words: plan.words, total: r.job.total, processed: 0 });
      }
      clearGuestPlan();
      for (const key of ["words", "stats", "hskReadiness", "hskDaily", "hskLists"]) qc.invalidateQueries({ queryKey: [key] });
      show({ icon: "📚", title: t("onb.finished", { n: created }) });
      onDone();
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

  return (
    <section className="anim-fade-up mx-auto max-w-[560px] rounded-[22px] border border-sage/25 bg-gradient-to-br from-sage-tint/50 via-surface to-surface p-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sage-tint/70 text-sage-deep">
        {failed ? <Sparkles className="h-6 w-6" /> : <Loader2 className="h-6 w-6 animate-spin" />}
      </div>
      <h2 className="mt-4 font-serif text-[22px] font-medium text-ink">{t("onb.finishing")}</h2>
      <p className="mt-1 text-[14px] text-ink-soft">{t("onb.finishingSub", { n: plan.words.length })}</p>
      {failed && (
        <div className="mt-4 space-y-3">
          <p className="text-[13px] text-warn-text">{failed}</p>
          <div className="flex flex-wrap justify-center gap-2">
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
