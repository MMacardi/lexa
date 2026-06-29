"use client";

import { useEffect, useState } from "react";

// Daily review goal (number of cards to train per day), stored locally.
const KEY = "lexa.dailyGoal";
const DEFAULT_GOAL = 5;

export function useDailyGoal() {
  const [goal, setGoalState] = useState(DEFAULT_GOAL);

  useEffect(() => {
    const v = localStorage.getItem(KEY);
    if (v) setGoalState(Math.max(1, parseInt(v, 10) || DEFAULT_GOAL));
  }, []);

  function setGoal(v: number) {
    const clamped = Math.max(1, Math.min(100, Math.round(v)));
    localStorage.setItem(KEY, String(clamped));
    setGoalState(clamped);
  }

  return [goal, setGoal] as const;
}
