"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useToast } from "@/lib/toast";
import { useDailyGoal } from "@/lib/goal";
import { computeBadges } from "@/lib/achievements";
import { useI18n } from "@/lib/i18n";

const KEY_SET = "lexa.ach.unlocked";
const KEY_GOAL = "lexa.goal.celebrated";

// Invisible component (mounted app-wide) that watches the stats query and pops a
// toast whenever a new achievement unlocks or the daily goal is hit. Already-
// earned achievements are seeded silently on first run so we don't spam.
export function AchievementWatcher() {
  const { accountId } = useAccount();
  const { show } = useToast();
  const { t } = useI18n();
  const [goal] = useDailyGoal();
  const { data: stats } = useQuery({
    queryKey: ["stats", accountId],
    queryFn: () => api.stats(accountId),
  });

  useEffect(() => {
    if (!stats) return;
    const badges = computeBadges(stats, goal);

    // --- permanent milestones ---
    const doneIds = badges.filter((b) => b.id !== "daily-goal" && b.done).map((b) => b.id);
    const raw = localStorage.getItem(KEY_SET);
    if (raw === null) {
      localStorage.setItem(KEY_SET, JSON.stringify(doneIds)); // seed silently
    } else {
      const set = new Set<string>(JSON.parse(raw));
      const newly = doneIds.filter((id) => !set.has(id));
      for (const id of newly) {
        const b = badges.find((x) => x.id === id);
        if (b) show({ icon: "🏆", title: t(b.labelKey), subtitle: t("toast.milestone"), tone: "achievement" });
      }
      if (newly.length) localStorage.setItem(KEY_SET, JSON.stringify([...set, ...newly]));
    }

    // --- daily goal (once per day) ---
    const today = new Date().toISOString().slice(0, 10);
    if (stats.trainedToday >= goal && localStorage.getItem(KEY_GOAL) !== today) {
      localStorage.setItem(KEY_GOAL, today);
      show({
        icon: "🎯",
        title: t("toast.goalTitle", { n: goal }),
        subtitle: t("toast.goalSub"),
        tone: "goal",
      });
    }
  }, [stats, goal, show, t]);

  return null;
}
