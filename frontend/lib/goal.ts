"use client";

import { useEffect, useState } from "react";
import { DEFAULT_GOAL, getDailyGoal, setDailyGoal } from "@/lib/learnPrefs";

// Daily review goal (number of cards to train per day). The value itself lives
// with the rest of the learner model in lib/learnPrefs, which mirrors it onto the
// account; this is just the reactive wrapper the pages use.
export function useDailyGoal() {
  const [goal, setGoalState] = useState(DEFAULT_GOAL);

  useEffect(() => {
    const sync = () => setGoalState(getDailyGoal());
    sync();
    window.addEventListener("lexa-prefs-changed", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("lexa-prefs-changed", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function setGoal(v: number) {
    setDailyGoal(v);
    setGoalState(getDailyGoal());
  }

  return [goal, setGoal] as const;
}
