import { fsrs, generatorParameters, createEmptyCard, Rating, type Card, type State } from "ts-fsrs";
import type { Word } from "./api";
import { getRetention } from "./learnPrefs";

// Mirror the backend scheduler config, but without fuzz so the previewed
// intervals stay stable/deterministic for the buttons. Built per call so it
// tracks the learner's current desired-retention setting.
function makeScheduler() {
  return fsrs(generatorParameters({ request_retention: getRetention(), enable_fuzz: false }));
}

// Minutes-from-now until the card is next due for each grade (1=Again..4=Easy).
export function previewMinutes(word: Word): { again: number; hard: number; good: number; easy: number } {
  const now = new Date();
  const card: Card =
    word.stability == null
      ? createEmptyCard(now)
      : {
          due: word.due ? new Date(word.due) : now,
          stability: word.stability,
          difficulty: word.difficulty ?? 0,
          elapsed_days: 0,
          scheduled_days: 0,
          learning_steps: word.learningSteps ?? 0,
          reps: word.reps ?? 0,
          lapses: word.lapses ?? 0,
          state: (word.state ?? 0) as State,
          last_review: word.lastReview ? new Date(word.lastReview) : undefined,
        };
  const rec = makeScheduler().repeat(card, now);
  const mins = (r: Rating) =>
    Math.max(0, Math.round((new Date(rec[r as 1 | 2 | 3 | 4].card.due).getTime() - now.getTime()) / 60000));
  return { again: mins(Rating.Again), hard: mins(Rating.Hard), good: mins(Rating.Good), easy: mins(Rating.Easy) };
}
