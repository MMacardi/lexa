"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { FinishGuestPlan } from "@/components/GuestPlan";
import { HskFirstRun, readGuestPlan } from "@/components/HskFirstRun";

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
  const { accountId, profile } = useAccount();
  const { t } = useI18n();
  const [plan] = useState(readGuestPlan);
  const [mode, setMode] = useState<"plan" | "onboarding" | "app" | null>(() => (plan ? "plan" : null));
  const { data: words, isError } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
    enabled: !!accountId && mode === null,
  });

  useEffect(() => {
    if (mode !== null) return;
    if (isError) setMode("app");
    else if (words && profile) setMode(words.length === 0 && profile.hskTarget == null ? "onboarding" : "app");
  }, [mode, words, profile, isError]);

  if (mode === "app") return <>{children}</>;
  if (mode === null)
    return (
      <main className="flex min-h-screen items-center justify-center bg-paper">
        <span className="text-sm text-ink-soft">{t("common.loading")}</span>
      </main>
    );

  return (
    <main className="min-h-screen bg-paper px-4 pb-10 pt-[calc(16px+env(safe-area-inset-top))] sm:pt-10">
      <div className="mx-auto max-w-[560px]">
        <div className="mb-4 flex items-center gap-1.5">
          <span className="font-serif text-[24px] font-semibold text-ink">Onomika</span>
          <span className="h-1.5 w-1.5 rounded-full bg-sage" />
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
