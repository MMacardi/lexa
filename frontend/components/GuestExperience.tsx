"use client";

import { useState } from "react";
import { FOCUS } from "@/lib/focus";
import { FocusLanding } from "@/components/FocusLanding";
import { LandingScreen } from "@/components/LandingScreen";
import { LoginScreen } from "@/components/LoginScreen";
import { BetaGate } from "@/components/BetaGate";

// What a signed-out visitor sees: the marketing landing first, then the shared
// beta-code gate, then login. Unlocking the beta gate sets a signed cookie so the
// subsequent login marks the account invited.
//
// Focused (F10) the landing is the HSK one; `NEXT_PUBLIC_FOCUS_MODE=off` brings
// back the full-build landing that pitches every feature.
export function GuestExperience() {
  const [stage, setStage] = useState<"landing" | "beta" | "login">("landing");
  if (stage === "login") return <LoginScreen />;
  if (stage === "beta") return <BetaGate onUnlock={() => setStage("login")} />;
  const onStart = () => setStage("beta");
  return FOCUS ? <FocusLanding onStart={onStart} /> : <LandingScreen onStart={onStart} />;
}
