import type { Stats } from "@/lib/api";

export interface Badge {
  id: string;
  icon: string;
  label: string;
  done: boolean;
}

// Single source of truth for milestone badges — used by both the StatsPanel
// display and the toast watcher so they never drift apart.
export function computeBadges(stats: Stats, goal: number): Badge[] {
  return [
    { id: "first-word", icon: "🌱", label: "First word", done: stats.total >= 1 },
    { id: "10-words", icon: "📚", label: "10 words", done: stats.total >= 10 },
    { id: "50-words", icon: "🏆", label: "50 words", done: stats.total >= 50 },
    { id: "first-mastered", icon: "✅", label: "First mastered", done: stats.mastered >= 1 },
    { id: "10-mastered", icon: "🎓", label: "10 mastered", done: stats.mastered >= 10 },
    { id: "streak-3", icon: "🔥", label: "3-day streak", done: stats.streak >= 3 },
    { id: "streak-7", icon: "⚡", label: "7-day streak", done: stats.streak >= 7 },
    { id: "daily-goal", icon: "🎯", label: "Daily goal", done: stats.trainedToday >= goal },
  ];
}
