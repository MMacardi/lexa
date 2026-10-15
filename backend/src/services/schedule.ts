import { State, type Card } from "ts-fsrs";

/**
 * Where a graded card's next review lands, on top of FSRS (the author, 2026-10-15:
 * "Again in 10 minutes doesn't show to me, I already finished my practice").
 *
 * By the day: FSRS puts a 1-day card exactly 24 h after the grade, so a word
 * reviewed at 21:00 wasn't due at a morning session and came a day late (0.56 days
 * late on average in a simulation of the loop, 0.10 counted by the day). A card due
 * in days is due from 04:00 on its day, in the learner's time zone, as Anki counts.
 * Steps of minutes (learning, relearning) stay minutes.
 *
 * Before the exam: FSRS doesn't know there is one, so a word whose next review falls
 * after the exam day is sat at whatever recall it has decayed to. If that is under
 * EXAM_RECALL, the review moves into the last days before the exam, spread over
 * them by the word. Simulated: words under 90% on exam day 17% → 5%, for about
 * 10% more reviews, most of them in the last week.
 */

export const ROLLOVER_HOUR = 4;
// The audience is Russian speakers; the bot, which has no browser to ask, schedules in this.
export const DEFAULT_TZ = "Europe/Moscow";
export const EXAM_RECALL = 0.95;
// The days before the exam a pulled-in review lands on: 1..EXAM_WINDOW days before it.
const EXAM_WINDOW = 5;
const DAY = 86_400_000;

const formats = new Map<string, Intl.DateTimeFormat>();
function format(tz: string) {
  let f = formats.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formats.set(tz, f);
  }
  return f;
}

/** An IANA zone name the runtime knows ("Europe/Moscow"), or null. */
export function asTimeZone(v: unknown): string | null {
  if (typeof v !== "string" || !v || v.length > 64) return null;
  try {
    format(v);
    return v;
  } catch {
    return null;
  }
}

/** The wall clock in `tz` at `t`. */
function wall(t: number, tz: string) {
  const parts = format(tz).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), min: get("minute"), s: get("second") };
}

/** How far `tz`'s clock is ahead of UTC at `t`. */
function offset(t: number, tz: string) {
  const w = wall(t, tz);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.min, w.s) - Math.floor(t / 1000) * 1000;
}

/** 04:00 in `tz` on the calendar day y-m-d (d may run past the month's end). */
function rolloverOn(y: number, m: number, d: number, tz: string): number {
  const g = Date.UTC(y, m - 1, d, ROLLOVER_HOUR);
  return g - offset(g - offset(g, tz), tz);
}

/** The start (04:00 local) of the study day `days` after the one `t` falls in. */
export function studyDayStart(t: Date, tz: string, days = 0): Date {
  const w = wall(t.getTime() - ROLLOVER_HOUR * 3_600_000, tz);
  return new Date(rolloverOn(w.y, w.m, w.d + days, tz));
}

/** A word's own small number, so pulled-in reviews spread over the last days instead of one. */
function spread(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

export type Placing = {
  tz: string;
  // The exam day (a calendar date, as stored: UTC midnight), or null.
  examDate: Date | null;
  // What spreads the pulled-in reviews: the card's id.
  key: string;
  // FSRS's predicted recall of `card` at `at` (the scheduler's get_retrievability).
  recall: (card: Card, at: Date) => number;
};

/**
 * `due`, or a day in the last EXAM_WINDOW before the exam when `card` would first
 * be seen on or after it with less than EXAM_RECALL left. At least tomorrow, and
 * nothing to move when the exam is today or tomorrow.
 */
export function beforeExam(card: Card, due: Date, now: Date, p: Placing): Date {
  if (!p.examDate || card.state !== State.Review) return due;
  const exam = new Date(rolloverOn(p.examDate.getUTCFullYear(), p.examDate.getUTCMonth() + 1, p.examDate.getUTCDate(), p.tz));
  const left = Math.round((exam.getTime() - studyDayStart(now, p.tz).getTime()) / DAY);
  if (left < 2 || due < exam || p.recall(card, exam) >= EXAM_RECALL) return due;
  return studyDayStart(now, p.tz, Math.max(1, left - 1 - (spread(p.key) % EXAM_WINDOW)));
}

/** The whole days FSRS puts `next` after `now`, at least one: how placeDue counts them. */
const fsrsDays = (next: Card, now: Date) => Math.max(1, Math.round((next.due.getTime() - now.getTime()) / DAY));

/** The due date for `next`, just scheduled by FSRS at `now`; `minDays` a floor (easyFloor). */
export function placeDue(next: Card, now: Date, p: Placing, minDays = 1): Date {
  if (next.state !== State.Review) return next.due;
  return beforeExam(next, studyDayStart(now, p.tz, Math.max(minDays, fsrsDays(next, now))), now, p);
}

/**
 * Easy at least a day past Good, as Anki keeps them (BACKLOG 1l): FSRS orders the two
 * for a card in review, but a card leaving a (re)learning step had both rounded to its
 * 1-day minimum — «Хорошо 1д · Легко 1д», stability 0.50 vs 0.87 — and Easy meant
 * nothing. `good`: the same card graded Good at `now`. The floor for Easy's days.
 */
export function easyFloor(good: Card, now: Date): number {
  return good.state === State.Review ? fsrsDays(good, now) + 1 : 1;
}
