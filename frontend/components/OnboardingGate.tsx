"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { wordsQuery } from "@/lib/wordQueries";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { FinishGuestPlan } from "@/components/GuestPlan";
import { HskFirstRun, readGuestPlan } from "@/components/HskFirstRun";
import { LangMenu } from "@/components/LandingChrome";

// The first minutes after sign-in, with nothing else on screen. An account comes
// through here in one of two ways:
//   - carrying the plan its guest onboarding built: FinishGuestPlan makes the
//     words, writes their meanings and says when they are ready;
//   - with nothing at all — no target, no cards. Someone tapped "I already have
//     an account" without having one, and Telegram sign-in made them one. They
//     get the onboarding itself, with no nav around it: an app with no target
//     and no words has nothing else worth opening, and a way around it left
//     them in an empty app.
// Decided once per load, then it steps aside for good (an account that later
// empties itself isn't sent back through it).
export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { accountId, profile, verified } = useAccount();
  const { t } = useI18n();
  const [plan] = useState(readGuestPlan);
  const [mode, setMode] = useState<"plan" | "onboarding" | "app" | null>(() => (plan ? "plan" : null));
  // /me supplies hasWords so onboarding no longer waits for the full list.
  const hasTarget = profile?.hskTarget != null;
  const knownApp = hasTarget || profile?.hasWords === true || !verified;
  const { data: words, isError } = useQuery({
    ...wordsQuery(accountId),
    enabled: !!accountId && mode === null && !!profile && !knownApp && profile.hasWords === undefined,
  });

  useEffect(() => {
    if (mode !== null || !verified) return;
    if (knownApp || isError) setMode("app");
    else if (profile?.hasWords === false) setMode("onboarding");
    else if (words && profile) setMode(words.length === 0 ? "onboarding" : "app");
  }, [mode, words, profile, knownApp, isError, verified]);

  if (mode === "app" || (mode === null && knownApp)) return <>{children}</>;
  if (mode === null)
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper">
        <span className="text-sm text-ink-soft">{t("common.loading")}</span>
      </main>
    );

  return (
    <main className="min-h-screen bg-paper px-4 pb-10 pt-[calc(16px+env(safe-area-inset-top))] sm:pt-10">
      <div className="mx-auto max-w-[560px]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5">
            <span className="font-serif text-[24px] font-semibold text-ink">Onomika</span>
            <span className="h-1.5 w-1.5 rounded-full bg-sage" />
          </div>
          <LangMenu />
        </div>
        {mode === "plan" && plan ? (
          <FinishGuestPlan plan={plan} onDone={() => setMode("app")} />
        ) : (
          <HskFirstRun onFinish={() => setMode("app")} />
        )}
      </div>
    </main>
  );
}
