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
// the sweep of `sweepLevel` is what settles it. A sample is only as good as the
// claims in it: the check's made-up words say how freely this learner claims,
// and that rate discounts the share before it is stretched over the words never
// asked (placementCheck.ts `correctForGuessing`).

import { prisma } from "./db.js";
import {
  HSK_MAX_LEVEL,
  asHskVersion,
  clampLevel,
  hskLevelWords,
  learnerStatus,
  normalizeHanzi,
  type HskVersion,
  type LevelReadiness,
  type Readiness,
} from "./hsk.js";
import { correctForGuessing, falseAlarmRate } from "./placementCheck.js";

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

/**
 * Share of a level known, per level: its own sample, or the best of the levels
 * above it — discounted by `falseAlarm`, the rate this learner claims words they
 * don't know. null: nothing to go on.
 *
 * A harder level can't be better known than an easier one, and when two samples
 * say so it is noise: the two are pooled, weighted by how many words each asked
 * (pool-adjacent-violators). The old rule lifted the easier level to the harder
 * one's share instead, so one lucky screen of six at HSK 4 made all of HSK 3
 * "known" over its own 8 of 12 — and the adaptive check samples right at that
 * boundary, where such screens happen.
 */
export function levelRates(levels: LevelEvidence[], falseAlarm = 0): Map<number, number | null> {
  type Block = { levels: number[]; known: number; asked: number };
  const blocks: Block[] = [];
  for (const l of [...levels].sort((a, b) => a.level - b.level)) {
    const asked = l.saidKnown + l.saidUnknown;
    if (asked < MIN_SAMPLE) continue;
    blocks.push({ levels: [l.level], known: l.saidKnown, asked });
    while (blocks.length > 1) {
      const [easier, harder] = blocks.slice(-2);
      if (harder.known / harder.asked <= easier.known / easier.asked) break;
      blocks.splice(-2, 2, { levels: [...easier.levels, ...harder.levels], known: easier.known + harder.known, asked: easier.asked + harder.asked });
    }
  }
  const own = new Map<number, number>();
  for (const b of blocks) for (const n of b.levels) own.set(n, correctForGuessing(b.known / b.asked, falseAlarm));

  const rates = new Map<number, number | null>();
  let above: number | null = null;
  for (const l of [...levels].sort((a, b) => b.level - a.level)) {
    const r = own.get(l.level);
    if (r !== undefined) above = above === null ? r : Math.max(above, r);
    rates.set(l.level, r ?? above);
  }
  return rates;
}

/** Words still to meet up to `target`, and how much of that is a guess. */
export function wordsLeft(levels: LevelEvidence[], target: number, falseAlarm = 0) {
  const rates = levelRates(levels, falseAlarm);
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
    if (answered >= MIN_SAMPLE) sampledBelow = correctForGuessing(l.saidKnown / answered, falseAlarm);
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
  falseAlarm?: number;
}): StudyPlan {
  const { version, today, examDate } = input;
  const level = clampLevel(version, input.level);
  const { total, left, exact, sweepLevel } = wordsLeft(input.levels, level, input.falseAlarm);
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
      const below = wordsLeft(input.levels, n, input.falseAlarm).left;
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

/** Per-level evidence from the answers ("I know it" true/false) and the words the learner has. */
export function evidenceFrom(version: HskVersion, said: Map<string, boolean>, has: (word: string) => boolean): LevelEvidence[] {
  const levels: LevelEvidence[] = [];
  for (let n = 1; n <= HSK_MAX_LEVEL[version]; n++) {
    const l: LevelEvidence = { level: n, total: 0, have: 0, toLearn: 0, saidKnown: 0, saidUnknown: 0 };
    for (const w of hskLevelWords(version, n)) {
      l.total++;
      const answer = said.get(w.word);
      if (answer === true) l.saidKnown++;
      if (answer === false) l.saidUnknown++;
      if (has(w.word)) l.have++;
      else if (answer === false) l.toLearn++;
    }
    levels.push(l);
  }
  return levels;
}

/**
 * The first grade each Chinese headword got in review, and when. A card's first
 * review is the one moment it tests what the learner knew before: a word recalled
 * on first sight was known (Hard, Good or Easy — only Again means it wasn't).
 * DISTINCT ON keeps it to one row a card, however many reviews there are.
 */
async function firstReviews(userId: string): Promise<Map<string, { at: Date; recalled: boolean }>> {
  const rows = await prisma.$queryRaw<{ word: string; grade: number; at: Date }[]>`
    SELECT DISTINCT ON (e."wordId") w."word" AS word, e."grade" AS grade, e."createdAt" AS at
    FROM "ReviewEvent" e JOIN "Word" w ON w."id" = e."wordId"
    WHERE e."userId" = ${userId} AND e."source" = 'review' AND e."grade" IS NOT NULL AND w."sourceLang" = 'zh'
    ORDER BY e."wordId", e."createdAt" ASC`;
  const out = new Map<string, { at: Date; recalled: boolean }>();
  for (const r of rows) {
    const key = normalizeHanzi(r.word);
    const prev = out.get(key);
    if (!prev || r.at < prev.at) out.set(key, { at: r.at, recalled: r.grade >= 2 });
  }
  return out;
}

/**
 * Per-level evidence for one learner — cards, "I know it"s, the check's taps —
 * and how freely they claim (the check's made-up words).
 *
 * Never over: an answer is the learner's word at the time, and a card's first
 * review after it is better evidence, so it takes the answer's place. That is how
 * the sample keeps moving after the check: every daily word is an answer too.
 * "I know it" says known; taking it says nothing yet (`took`) until the first
 * review says whether it really was new. Counting only the "I know it"s, as the
 * plan used to, crept towards "knows all of HSK 4" by the end of a week of daily
 * words. Only answered words count: a word captured from a text was picked
 * because it wasn't known, and would drag every level's share down.
 */
async function levelEvidence(telegramId: string, version: HskVersion): Promise<{ levels: LevelEvidence[]; falseAlarm: number }> {
  const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  if (!user) return { levels: evidenceFrom(version, new Map(), () => false), falseAlarm: 0 };
  const [status, answers, firsts] = await Promise.all([
    learnerStatus(telegramId),
    prisma.placementAnswer.findMany({
      where: { userId: user.id, sourceLang: "zh" },
      select: { word: true, known: true, fake: true, took: true, createdAt: true },
    }),
    firstReviews(user.id),
  ]);
  const said = new Map<string, boolean>();
  let fakes = 0;
  let claimed = 0;
  for (const a of answers) {
    if (a.fake) {
      fakes++;
      if (a.known) claimed++;
      continue;
    }
    const word = normalizeHanzi(a.word);
    const first = firsts.get(word);
    if (a.took) {
      if (first) said.set(word, first.recalled);
      continue;
    }
    said.set(word, first && first.at > a.createdAt ? first.recalled : a.known);
  }
  return { levels: evidenceFrom(version, said, (w) => status.has(w)), falseAlarm: falseAlarmRate(fakes, claimed) };
}

export async function planForUser(telegramId: string, today: string): Promise<StudyPlan> {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { hskVersion: true, hskTarget: true, examDate: true, dailyGoal: true },
  });
  const version = asHskVersion(user?.hskVersion) ?? "3.0";
  const { levels, falseAlarm } = await levelEvidence(telegramId, version);
  return buildPlan({
    version,
    level: user?.hskTarget ?? 4,
    levels,
    falseAlarm,
    today,
    examDate: user?.examDate ? user.examDate.toISOString().slice(0, 10) : null,
    daily: user?.dailyGoal ?? DEFAULT_DAILY,
  });
}

/**
 * Before sign-in, priced from the check's taps when there are any: the same
 * per-level evidence as the account's plan (no cards yet), so the pace the
 * guest picks and the date Today shows after sign-in come from one sum.
 *
 * Without taps (from zero, or before the check) only the self-rated level is
 * left. "Around HSK 4" is what someone preparing for HSK 4 taps, so it reads as
 * working on it: the levels below count as known, that one as half known, the
 * rest up to the target as unknown. Read as "knows all of HSK 4" it left an HSK 4
 * target with nothing to learn, and every pace said the same date.
 */
export function guestPlan(input: {
  version: HskVersion;
  level: number;
  known: number;
  answers?: { known: string[]; unknown: string[] };
  fakes?: { shown: number; claimed: number }; // the check's made-up words
  today: string;
  examDate: string | null;
  daily: number;
}): StudyPlan {
  const { answers } = input;
  if (answers && answers.known.length + answers.unknown.length > 0) {
    const falseAlarm = falseAlarmRate(input.fakes?.shown ?? 0, input.fakes?.claimed ?? 0);
    const said = new Map<string, boolean>();
    for (const w of answers.known) said.set(normalizeHanzi(w), true);
    for (const w of answers.unknown) said.set(normalizeHanzi(w), false);
    // An "I know it" is a word they have, as in `learnerStatus`: never offered as new.
    const levels = evidenceFrom(input.version, said, (w) => said.get(w) === true);
    return { ...buildPlan({ ...input, levels, falseAlarm }), sweepLevel: null };
  }
  const levels: LevelEvidence[] = [];
  for (let n = 1; n <= HSK_MAX_LEVEL[input.version]; n++) {
    const total = hskLevelWords(input.version, n).length;
    const have = n < input.known ? total : n === input.known ? Math.round(total / 2) : 0;
    levels.push({ level: n, total, have, toLearn: 0, saidKnown: 0, saidUnknown: 0 });
  }
  return { ...buildPlan({ ...input, levels }), sweepLevel: null };
}

// --- The mark, measured and estimated ---

export type EstimatedReadiness = Omit<Readiness, "levels"> & {
  estimate: number; // up to the target: the measured count plus the unasked words the sample prices as known
  levels: (LevelReadiness & { estimate: number })[];
};

/**
 * The readiness mark counts what was measured: cards past learning, and words
 * the learner said they know. After a 30-word check that is ~30 of an HSK 4
 * learner's 2,000 — true and useless. So each level also gets an estimate: the
 * measured count plus the words nobody asked about, priced by the level's own
 * sample exactly as the plan prices them, so the two never disagree. Coverage,
 * never a predicted score; the UI labels which part is which.
 */
export async function withEstimate(telegramId: string, r: Readiness): Promise<EstimatedReadiness> {
  const { levels, falseAlarm } = await levelEvidence(telegramId, r.version);
  const rates = levelRates(levels, falseAlarm);
  const byLevel = new Map(levels.map((l) => [l.level, l]));
  const out = r.levels.map((l) => {
    const e = byLevel.get(l.level);
    const open = e ? Math.max(0, e.total - e.have - e.toLearn) : 0;
    return { ...l, estimate: Math.min(l.total, l.recognise + Math.round(open * (rates.get(l.level) ?? 0))) };
  });
  const estimate = out.filter((l) => l.level <= r.level).reduce((a, l) => a + l.estimate, 0);
  return { ...r, estimate, levels: out };
}
