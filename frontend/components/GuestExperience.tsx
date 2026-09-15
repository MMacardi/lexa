"use client";

import { useState } from "react";
import { LandingScreen } from "@/components/LandingScreen";
import { LoginScreen } from "@/components/LoginScreen";
import { BetaGate } from "@/components/BetaGate";

// What a signed-out visitor sees: the marketing landing first, then the shared
// beta-code gate, then login. Unlocking the beta gate sets a signed cookie so the
// subsequent login marks the account invited; a tester with a personal single-use
// code skips the gate (its "personal code" link) and redeems it after login.
export function GuestExperience() {
  const [stage, setStage] = useState<"landing" | "beta" | "login">("landing");
  if (stage === "login") return <LoginScreen />;
  if (stage === "beta") return <BetaGate onUnlock={() => setStage("login")} />;
  return <LandingScreen onStart={() => setStage("beta")} />;
}
