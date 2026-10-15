import { fsrs, generatorParameters, createEmptyCard, Rating, State, type Card, type Grade } from "ts-fsrs";
import type { Word } from "./api";
import { getRetention } from "./learnPrefs";

// Mirror the backend scheduler config, but without fuzz so the previewed
// intervals stay stable/deterministic for the buttons. Built per call so it
// tracks the learner's current desired-retention setting.
function makeScheduler() {
  return fsrs(generatorParameters({ request_retention: getRetention(), enable_fuzz: false }));
}

// Where the next review lands, as backend services/schedule.ts places it — here in
// the browser's own time zone, which is the one the server is sent. A card due in
// days is due from 04:00 on its day; one that would first come back on or after the
// exam with under 95% recall left comes back in the last days before it.
const ROLLOVER_HOUR = 4;
const EXAM_RECALL = 0.95;
const EXAM_WINDOW = 5;
const DAY = 86_400_000;

/** The start (04:00) of the study day `days` after the one `t` falls in. */
export function studyDayStart(t: Date, days = 0): Date {
  const d = new Date(t.getTime() - ROLLOVER_HOUR * 3_600_000);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, ROLLOVER_HOUR);
}

function spread(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

const fsrsDays = (next: Card, now: Date) => Math.max(1, Math.round((next.due.getTime() - now.getTime()) / DAY));

// Easy at least a day past Good when Good also leaves its steps (backend schedule.ts
// easyFloor): from a step FSRS rounded both to one day, «Хорошо 1д · Легко 1д».
const easyFloor = (good: Card, now: Date) => (good.state === State.Review ? fsrsDays(good, now) + 1 : 1);

function placeDue(
  next: Card,
  now: Date,
  key: string,
  examDate: string | null | undefined,
  f: ReturnType<typeof fsrs>,
  minDays = 1,
): Date {
  if (next.state !== State.Review) return next.due;
  const due = studyDayStart(now, Math.max(minDays, fsrsDays(next, now)));
  if (!examDate) return due;
  const [y, m, d] = examDate.slice(0, 10).split("-").map(Number);
  const exam = new Date(y, m - 1, d, ROLLOVER_HOUR);
  const left = Math.round((exam.getTime() - studyDayStart(now).getTime()) / DAY);
  if (left < 2 || due < exam || f.get_retrievability(next, exam, false) >= EXAM_RECALL) return due;
  return studyDayStart(now, Math.max(1, left - 1 - (spread(key) % EXAM_WINDOW)));
}

/** Due again before the session's day is over: a step of minutes, not days. */
export function dueToday(word: Word, now = new Date()): boolean {
  return word.due != null && new Date(word.due) < studyDayStart(now, 1);
}

// Reconstruct an FSRS card from a Word's stored state (or a fresh one).
function cardFor(word: Word, now: Date): Card {
  return word.stability == null
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
}

/**
 * Apply a grade locally (offline), mirroring the backend recordReview: returns
 * the updated Word so the review UI can optimistically drop the card from the
 * due list. The server recomputes authoritatively when the queued grade syncs.
 */
export function applyGradeLocally(word: Word, grade: 1 | 2 | 3 | 4, examDate?: string | null): Word {
  const now = new Date();
  const f = makeScheduler();
  const { card: next } = f.next(cardFor(word, now), now, grade as Grade);
  const floor = grade === Rating.Easy ? easyFloor(f.next(cardFor(word, now), now, Rating.Good).card, now) : 1;
  const due = placeDue(next, now, word.id, examDate, f, floor).toISOString();
  return {
    ...word,
    stability: next.stability,
    difficulty: next.difficulty,
    due,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state,
    learningSteps: next.learning_steps ?? 0,
    lastReview: now.toISOString(),
    nextReviewAt: due,
    reviewCount: grade >= 3 ? word.reviewCount + 1 : word.reviewCount,
  };
}

// The same for the writing schedule: its fields read as the card's.
export function previewWriteMinutes(word: Word, examDate?: string | null) {
  return previewMinutes(
    {
      ...word,
      stability: word.writeStability ?? null,
      difficulty: word.writeDifficulty ?? null,
      due: word.writeDue ?? null,
      reps: word.writeReps ?? 0,
      lapses: word.writeLapses ?? 0,
      state: word.writeState ?? 0,
      learningSteps: word.writeSteps ?? 0,
      lastReview: word.writeLast ?? null,
    },
    examDate,
    `${word.id}:write`,
  );
}

// "10min", "3h", "4d", "2mo" — a grade button's next interval.
export function fmtInterval(m: number, t: (k: string) => string): string {
  if (m < 60) return `${m}${t("unit.min")}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}${t("unit.hour")}`;
  const d = Math.round(m / 1440);
  if (d < 30) return `${d}${t("unit.day")}`;
  return `${Math.round(d / 30)}${t("unit.month")}`;
}

// Minutes-from-now until the card is next due for each grade (1=Again..4=Easy).
// A review a day or more away counts in whole days ("1d", not the 7 h left until
// 04:00 tomorrow), as the learner will meet it.
export function previewMinutes(
  word: Word,
  examDate?: string | null,
  key = word.id,
): { again: number; hard: number; good: number; easy: number } {
  const now = new Date();
  const f = makeScheduler();
  const rec = f.repeat(cardFor(word, now), now);
  const mins = (r: Rating) => {
    const next = rec[r as 1 | 2 | 3 | 4].card;
    const floor = r === Rating.Easy ? easyFloor(rec[Rating.Good].card, now) : 1;
    const due = placeDue(next, now, key, examDate, f, floor);
    if (next.state === State.Review) return Math.round((due.getTime() - studyDayStart(now).getTime()) / DAY) * 1440;
    return Math.max(0, Math.round((due.getTime() - now.getTime()) / 60000));
  };
  return { again: mins(Rating.Again), hard: mins(Rating.Hard), good: mins(Rating.Good), easy: mins(Rating.Easy) };
}
