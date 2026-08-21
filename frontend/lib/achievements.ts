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
  done: boolean;
}

// Single source of truth for milestone badges — used by the StatsPanel display,
// the Friends profiles, and the toast watcher so they never drift apart. Every
// badge has a plain-language description so the unlock condition is never a
// mystery. "Mastered" = a card reviewed to the point it's well-known (5+ reviews).
export function computeBadges(stats: Stats, goal: number): Badge[] {
  const langs = stats.languages?.length ?? 0;
  return [
    // Collecting words
    { id: "first-word", Icon: Sprout, labelKey: "ach.firstWord", descKey: "ach.firstWord.d", done: stats.total >= 1 },
    { id: "words-10", Icon: BookOpen, labelKey: "ach.words10", descKey: "ach.words10.d", done: stats.total >= 10 },
    { id: "words-50", Icon: Library, labelKey: "ach.words50", descKey: "ach.words50.d", done: stats.total >= 50 },
    { id: "words-100", Icon: Trophy, labelKey: "ach.words100", descKey: "ach.words100.d", done: stats.total >= 100 },
    { id: "words-250", Icon: Award, labelKey: "ach.words250", descKey: "ach.words250.d", done: stats.total >= 250 },
    // Mastering
    { id: "mastered-1", Icon: GraduationCap, labelKey: "ach.mastered1", descKey: "ach.mastered1.d", done: stats.mastered >= 1 },
    { id: "mastered-10", Icon: GraduationCap, labelKey: "ach.mastered10", descKey: "ach.mastered10.d", done: stats.mastered >= 10 },
    { id: "mastered-50", Icon: Star, labelKey: "ach.mastered50", descKey: "ach.mastered50.d", done: stats.mastered >= 50 },
    // Reviewing
    { id: "reviews-100", Icon: Repeat, labelKey: "ach.reviews100", descKey: "ach.reviews100.d", done: stats.reviews >= 100 },
    { id: "reviews-1000", Icon: Repeat, labelKey: "ach.reviews1000", descKey: "ach.reviews1000.d", done: stats.reviews >= 1000 },
    // Streaks
    { id: "streak-3", Icon: Flame, labelKey: "ach.streak3", descKey: "ach.streak3.d", done: stats.streak >= 3 },
    { id: "streak-7", Icon: Zap, labelKey: "ach.streak7", descKey: "ach.streak7.d", done: stats.streak >= 7 },
    { id: "streak-14", Icon: CalendarCheck, labelKey: "ach.streak14", descKey: "ach.streak14.d", done: stats.streak >= 14 },
    // Daily goal
    { id: "daily-goal", Icon: Target, labelKey: "ach.dailyGoal", descKey: "ach.dailyGoal.d", done: stats.trainedToday >= goal },
    // Languages
    { id: "lang-2", Icon: Languages, labelKey: "ach.lang2", descKey: "ach.lang2.d", done: langs >= 2 },
    { id: "lang-3", Icon: Globe, labelKey: "ach.lang3", descKey: "ach.lang3.d", done: langs >= 3 },
  ];
}
