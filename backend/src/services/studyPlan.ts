// A plan with a date (BACKLOG "A plan with a date"): the exam day, the words still
// standing between the learner and their target, and what a day has to hold to
// cover them in time — said in minutes, the way the learner decides it ("15 min a
// day"), with the words as the detail. "Learn 48 words a day" reads as impossible
// and tells nobody what to do; "this date needs about an hour a day, even 30 min
// won't get there" does, and comes with the three ways out: check what you
// already know (the gap may be a guess), a lower target, or the most a day holds.
//
// The gap is an estimate on purpose. A word counts as met when there is a card or
// an "I know it" for it; the rest of a level is priced by the check's sample of
// that level (6 of 24 words tapped through → the share known), so a learner who
// knows HSK 1–3 isn't told to learn them again. A level with no sample borrows
// the rate of a harder one ("knows 80% of HSK 4" → at least that much of HSK 3),
// and with nothing to go on the words count as unknown. `exact` says which it is;
// the sweep of `sweepLevel` is what settles it.

import { prisma } from "./db.js";
import { HSK_MAX_LEVEL, asHskVersion, clampLevel, hskLevelWords, learnerStatus, normalizeHanzi, type HskVersion } from "./hsk.js";

// Minutes a day that one new word a day costs once its reviews have piled up: the
// first meeting (~20 s) plus the ~7 reviews a young card gets in its first weeks
// at the 8 s a review that Today's session estimate uses. 10 words a day ≈ 12 min.
export const MIN_PER_WORD = 1.25;
// The paces offered, in minutes a day. 30 is the ceiling a plan will ask for: past
// it the reviews alone outgrow a day, and the honest answer is a different plan.
export const PACES = [10, 15, 20, 30] as const;
const MIN_SAMPLE = 3; // answers in a level before its share known is trusted
const DEFAULT_DAILY = 5; // hsk.ts's drip default when the account never saved one

export const wordsFor = (minutes: number) => Math.floor(minutes / MIN_PER_WORD);
// Rounded up to 5: "about 25 min" is what a person plans a day around.
export const minutesFor = (words: number) => Math.max(5, Math.ceil((words * MIN_PER_WORD) / 5) * 5);

// The last stretch before the exam brings no new words, only reviews: a word met
// the day before is not a word you know. A tenth of the time, 3–14 days.
export const bufferDays = (daysLeft: number) => Math.min(14, Math.max(3, Math.round(daysLeft / 8)));

export type LevelEvidence = {
  level: number;
  total: number;
  have: number; // a card, or "I know it": never offered as new
  toLearn: number; // "I don't know it" and no card yet
  saidKnown: number; // answers in this level, the sample
  saidUnknown: number;
};

// `finish` is the day the learner is ready: every word met, and the review stretch
// after the last one. A pace fits when that day is on or before the exam — the
// same test as the daily number, so the date shown and the tag never disagree.
export type Pace = { minutes: number; words: number; finish: string; fits: boolean | null };

export type StudyPlan = {
  version: HskVersion;
  level: number;
  today: string;
  examDate: string | null;
  daysLeft: number | null;
  total: number; // words on the list up to the target
  left: number; // of those, still to meet (estimated)
  exact: boolean; // false while part of `left` is priced by a sample, or by nothing
  sweepLevel: number | null; // the level whose sweep would settle most of the guess
  perDay: number | null; // new words a day the date needs
  need: number | null; // what that costs, in minutes
  status: "done" | "noDate" | "passed" | "close" | "fits" | "tight";
  pick: number | null; // the lightest pace that fits the date, in minutes
  paces: Pace[];
  current: { words: number; minutes: number; finish: string };
  lower: { level: number; minutes: number } | null; // a closer target that fits, when this one doesn't
};

export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
export const daysBetween = (from: string, to: string) => Math.round((dayMs(to) - dayMs(from)) / 86_400_000);
export const addDays = (iso: string, n: number) => new Date(dayMs(iso) + n * 86_400_000).toISOString().slice(0, 10);

/** Share of a level known, per level: its own sample, or the best of the levels above it. */
function knownRates(levels: LevelEvidence[]): Map<number, number | null> {
  const rates = new Map<number, number | null>();
  let above: number | null = null;
  for (const l of [...levels].sort((a, b) => b.level - a.level)) {
    const answered = l.saidKnown + l.saidUnknown;
    const own = answered >= MIN_SAMPLE ? l.saidKnown / answered : null;
    if (own !== null) above = above === null ? own : Math.max(above, own);
    rates.set(l.level, above);
  }
  return rates;
}

/** Words still to meet up to `target`, and how much of that is a guess. */
export function wordsLeft(levels: LevelEvidence[], target: number) {
  const rates = knownRates(levels);
  let total = 0;
  let left = 0;
  let unsure = 0;
  let sweepLevel: number | null = null;
  let sampledBelow: number | null = null; // the nearest easier level's own share known
  for (const l of levels.filter((x) => x.level <= target).sort((a, b) => a.level - b.level)) {
    const open = Math.max(0, l.total - l.have - l.toLearn);
    const rate = rates.get(l.level) ?? null;
    const answered = l.saidKnown + l.saidUnknown;
    // Nothing on this level, but the easier one is mostly unknown: so is this one.
    const likelyUnknown = rate === null && sampledBelow !== null && sampledBelow < 0.5;
    if (answered >= MIN_SAMPLE) sampledBelow = l.saidKnown / answered;
    total += l.total;
    left += l.toLearn + Math.round(open * (1 - (rate ?? 0)));
    unsure += open;
    // Worth a sweep: the lowest level where it would settle a real share of the
    // number — much of it unanswered and priced as unknown, yet likely known. A
    // level the sample says they know (the guess is ~0 words) or mostly don't
    // (they'd tap nearly every word) only confirms what the plan already says.
    const guessed = open * (1 - (rate ?? 0));
    const worth = guessed >= Math.max(30, l.total * 0.1) && (rate === null ? !likelyUnknown : rate >= 0.5);
    if (sweepLevel === null && worth) sweepLevel = l.level;
  }
  return { total, left, exact: unsure <= Math.max(20, total * 0.03), sweepLevel };
}

/** The plan itself: pure, so the check script and the guest estimate share it. */
export function buildPlan(input: {
  version: HskVersion;
  level: number;
  levels: LevelEvidence[];
  today: string;
  examDate: string | null;
  daily: number;
}): StudyPlan {
  const { version, today, examDate } = input;
  const level = clampLevel(version, input.level);
  const { total, left, exact, sweepLevel } = wordsLeft(input.levels, level);
  const daysLeft = examDate ? daysBetween(today, examDate) : null;
  const buffer = daysLeft === null ? null : bufferDays(daysLeft);
  const newDays = daysLeft === null || buffer === null ? null : daysLeft - buffer;
  const perDayFor = (n: number) => (newDays && newDays > 0 ? Math.ceil(n / newDays) : null);
  const perDay = left > 0 ? perDayFor(left) : 0;
  const finishAt = (words: number) => {
    const days = Math.ceil(left / Math.max(1, words));
    return addDays(today, days + (buffer ?? bufferDays(days)));
  };

  const paces: Pace[] = PACES.map((minutes) => {
    const words = wordsFor(minutes);
    const finish = finishAt(words);
    return { minutes, words, finish, fits: examDate && newDays && newDays > 0 ? finish <= examDate : null };
  });
  const pick = perDay !== null ? (PACES.find((m) => wordsFor(m) >= perDay) ?? null) : null;

  let status: StudyPlan["status"];
  if (left === 0) status = "done";
  else if (daysLeft === null) status = "noDate";
  else if (daysLeft <= 0) status = "passed";
  else if (!newDays || newDays <= 0) status = "close";
  else status = pick !== null ? "fits" : "tight";

  // The highest level below the target that the date does fit at the most a day
  // holds — "HSK 4 by then at 20 min a day" beside "HSK 5 needs an hour".
  let lower: StudyPlan["lower"] = null;
  if (status === "tight") {
    for (let n = level - 1; n >= 1; n--) {
      const below = wordsLeft(input.levels, n).left;
      if (below === 0) break; // already covered: nothing to aim at there
      const need = perDayFor(below) ?? Infinity;
      const fit = PACES.find((m) => wordsFor(m) >= need);
      if (fit !== undefined) {
        lower = { level: n, minutes: fit };
        break;
      }
    }
  }

  const daily = Math.max(1, input.daily);
  return {
    version,
    level,
    today,
    examDate,
    daysLeft,
    total,
    left,
    exact,
    sweepLevel: exact ? null : sweepLevel,
    perDay: status === "fits" || status === "tight" ? perDay : null,
    need: status === "tight" && perDay ? minutesFor(perDay) : null,
    status,
    pick: status === "fits" ? pick : null,
    paces,
    current: { words: daily, minutes: minutesFor(daily), finish: finishAt(daily) },
    lower,
  };
}

/** Per-level evidence for one learner: cards, "I know it"s, and the check's taps. */
async function levelEvidence(telegramId: string, version: HskVersion): Promise<LevelEvidence[]> {
  const [status, answers] = await Promise.all([
    learnerStatus(telegramId),
    prisma.placementAnswer.findMany({
      where: { user: { telegramId }, sourceLang: "zh" },
      select: { word: true, known: true },
    }),
  ]);
  const said = new Map(answers.map((a) => [normalizeHanzi(a.word), a.known]));
  const levels: LevelEvidence[] = [];
  for (let n = 1; n <= HSK_MAX_LEVEL[version]; n++) {
    const l: LevelEvidence = { level: n, total: 0, have: 0, toLearn: 0, saidKnown: 0, saidUnknown: 0 };
    for (const w of hskLevelWords(version, n)) {
      l.total++;
      const answer = said.get(w.word);
      if (answer === true) l.saidKnown++;
      if (answer === false) l.saidUnknown++;
      if (status.has(w.word)) l.have++;
      else if (answer === false) l.toLearn++;
    }
    levels.push(l);
  }
  return levels;
}

export async function planForUser(telegramId: string, today: string): Promise<StudyPlan> {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { hskVersion: true, hskTarget: true, examDate: true, dailyGoal: true },
  });
  const version = asHskVersion(user?.hskVersion) ?? "3.0";
  return buildPlan({
    version,
    level: user?.hskTarget ?? 4,
    levels: await levelEvidence(telegramId, version),
    today,
    examDate: user?.examDate ? user.examDate.toISOString().slice(0, 10) : null,
    daily: user?.dailyGoal ?? DEFAULT_DAILY,
  });
}

/**
 * Before sign-in there is no evidence yet, only the level the guest said they
 * have: those levels count as known, the rest up to the target as unknown. The
 * check that follows (and the account's own plan after it) refines it.
 */
export function guestPlan(input: {
  version: HskVersion;
  level: number;
  known: number;
  today: string;
  examDate: string | null;
  daily: number;
}): StudyPlan {
  const levels: LevelEvidence[] = [];
  for (let n = 1; n <= HSK_MAX_LEVEL[input.version]; n++) {
    const total = hskLevelWords(input.version, n).length;
    levels.push({ level: n, total, have: n <= input.known ? total : 0, toLearn: 0, saidKnown: 0, saidUnknown: 0 });
  }
  return { ...buildPlan({ ...input, levels }), sweepLevel: null };
}
