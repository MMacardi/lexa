import type { Stats } from "@/lib/api";
import {
  Sprout, BookOpen, Library, Trophy, GraduationCap, Award, Flame, Zap,
  CalendarCheck, Target, Repeat, Languages, Globe, Star, type LucideIcon,
} from "lucide-react";

export interface Badge {
  id: string;
  Icon: LucideIcon;
  labelKey: string; // i18n key for the short name
  descKey: string; // i18n key explaining how it's earned
  cur: number; // current progress toward the milestone
  target: number; // the milestone value
  done: boolean;
}

// Single source of truth for milestone badges — used by the StatsPanel display,
// the Friends profiles, and the toast watcher so they never drift apart. Every
// badge has a plain-language description so the unlock condition is never a
// mystery, and cur/target so the UI can show how close you are. "Mastered" = a
// card reviewed to the point it's well-known (5+ reviews).
// NOTE: `id` values are STABLE — the toast watcher persists unlocked ids by them.
export function computeBadges(stats: Stats, goal: number): Badge[] {
  const langs = stats.languages?.length ?? 0;
  // id, icon, label-key stem (ach.<stem> / ach.<stem>.d), current value, target
  const mk = (id: string, Icon: LucideIcon, stem: string, cur: number, target: number): Badge => ({
    id,
    Icon,
    labelKey: `ach.${stem}`,
    descKey: `ach.${stem}.d`,
    cur,
    target,
    done: cur >= target,
  });
  return [
    // Collecting words
    mk("first-word", Sprout, "firstWord", stats.total, 1),
    mk("words-10", BookOpen, "words10", stats.total, 10),
    mk("words-50", Library, "words50", stats.total, 50),
    mk("words-100", Trophy, "words100", stats.total, 100),
    mk("words-250", Award, "words250", stats.total, 250),
    // Mastering
    mk("mastered-1", GraduationCap, "mastered1", stats.mastered, 1),
    mk("mastered-10", GraduationCap, "mastered10", stats.mastered, 10),
    mk("mastered-50", Star, "mastered50", stats.mastered, 50),
    // Reviewing
    mk("reviews-100", Repeat, "reviews100", stats.reviews, 100),
    mk("reviews-1000", Repeat, "reviews1000", stats.reviews, 1000),
    // Streaks
    mk("streak-3", Flame, "streak3", stats.streak, 3),
    mk("streak-7", Zap, "streak7", stats.streak, 7),
    mk("streak-14", CalendarCheck, "streak14", stats.streak, 14),
    // Daily goal
    mk("daily-goal", Target, "dailyGoal", stats.trainedToday, goal),
    // Languages
    mk("lang-2", Languages, "lang2", langs, 2),
    mk("lang-3", Globe, "lang3", langs, 3),
  ];
}
