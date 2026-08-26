"use client";

import { useState } from "react";
import { LandingScreen } from "@/components/LandingScreen";
import { LoginScreen } from "@/components/LoginScreen";

// What a signed-out visitor sees: the marketing landing first, then the login
// screen once they tap a "get started / sign in" call-to-action.
export function GuestExperience() {
  const [showLogin, setShowLogin] = useState(false);
  if (showLogin) return <LoginScreen />;
  return <LandingScreen onStart={() => setShowLogin(true)} />;
}
