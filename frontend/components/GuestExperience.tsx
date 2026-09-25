"use client";

import { useState } from "react";
import { FOCUS } from "@/lib/focus";
import { useI18n } from "@/lib/i18n";
import { FocusLanding } from "@/components/FocusLanding";
import { LandingScreen } from "@/components/LandingScreen";
import { LoginScreen } from "@/components/LoginScreen";
import { BetaGate } from "@/components/BetaGate";
import { HskFirstRun, OTHER_LANGUAGE_KEY } from "@/components/HskFirstRun";

// What a signed-out visitor sees: the marketing landing, then (focused) the
// onboarding questions, then the shared beta-code gate, then sign-in. The
// questions come BEFORE sign-in, the way phone apps do it: the plan is the reason
// to make an account, not a chore after it. The answers wait on the device and
// the signed-in flow opens on the plan, one tap from the check. Unlocking the
// beta gate sets a signed cookie so the sign-in marks the account invited.
//
// "Sign in" on the landing is for returning learners: straight to sign-in, no
// questions and no beta code (their invite is on the account).
//
// Focused (F10) the landing is the HSK one; `NEXT_PUBLIC_FOCUS_MODE=off` brings
// back the full-build landing that pitches every feature.
export function GuestExperience() {
  const { t } = useI18n();
  const [stage, setStage] = useState<"landing" | "questions" | "beta" | "login">("landing");
  if (stage === "login") return <LoginScreen />;
  if (stage === "beta") return <BetaGate onUnlock={() => setStage("login")} />;
  if (stage === "questions")
    return (
      <main className="min-h-screen bg-paper px-4 pb-10 pt-[calc(16px+env(safe-area-inset-top))] sm:pt-10">
        <div className="mx-auto max-w-[560px]">
          <div className="mb-4 flex items-center justify-between gap-3">
            <button type="button" onClick={() => setStage("landing")} className="flex items-center gap-1.5">
              <span className="font-serif text-[24px] font-semibold text-ink">Onomika</span>
              <span className="h-1.5 w-1.5 rounded-full bg-sage" />
            </button>
            <button
              type="button"
              onClick={() => setStage("login")}
              className="text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
            >
              {t("onb.haveAccount")}
            </button>
          </div>
          <HskFirstRun
            guest
            onGuestDone={() => setStage("beta")}
            onOther={() => {
              try {
                localStorage.setItem(OTHER_LANGUAGE_KEY, "1");
              } catch {
                /* ignore */
              }
              setStage("beta");
            }}
          />
        </div>
      </main>
    );
  const onStart = () => setStage(FOCUS ? "questions" : "beta");
  return FOCUS ? <FocusLanding onStart={onStart} onSignIn={() => setStage("login")} /> : <LandingScreen onStart={onStart} />;
}
