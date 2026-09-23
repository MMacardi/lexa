import { prisma } from "./db.js";
import { HSK_WORDS } from "../data/hskWords.js";

// The official HSK word lists, and the readiness mark built on top of them.
//
// Two lists are shipped because both are real: HSK 2.0 is what the 2026 exams
// are still sat against, HSK 3.0 is what the textbooks are moving to. A word
// usually sits at a different level in each, so a card carries both tags and the
// learner picks which ladder they are climbing.
//
// The mark is deliberately *vocabulary coverage*, never a predicted exam score:
// we have no calibration data, and "90% ready" followed by a fail would cost the
// trust this whole product is built on.

export const HSK_VERSIONS = ["2.0", "3.0"] as const;
export type HskVersion = (typeof HSK_VERSIONS)[number];

/** HSK 2.0 stops at 6; HSK 3.0's level 7 is the combined 7–9 band. */
export const HSK_MAX_LEVEL: Record<HskVersion, number> = { "2.0": 6, "3.0": 7 };

export function asHskVersion(v: unknown): HskVersion | null {
  return (HSK_VERSIONS as readonly string[]).includes(v as string) ? (v as HskVersion) : null;
}

/** The two tags a word can carry, e.g. { "2.0": 3, "3.0": 1 }. */
export type HskTag = Partial<Record<HskVersion, number>>;

// --- The list, parsed once ---

// Line format is `simplified<TAB>pinyin<TAB>o3,n1`; see data/hskWords.ts.
type Entry = { word: string; pinyin: string; levels: HskTag };

let index: Map<string, Entry> | null = null;
let byLevel: Map<string, Entry[]> | null = null; // key: `${version}:${level}`

function build() {
  index = new Map();
  byLevel = new Map();
  for (const line of HSK_WORDS.split("\n")) {
    const [word, pinyin, tags] = line.split("\t");
    if (!word || !tags) continue;
    const levels: HskTag = {};
    for (const tag of tags.split(",")) {
      const version: HskVersion = tag[0] === "o" ? "2.0" : "3.0";
      const level = Number(tag.slice(1));
      // Should a word ever be tagged twice in one list, it belongs at the level
      // it is first taught at — otherwise an inclusive count would miss it.
      levels[version] = Math.min(levels[version] ?? level, level);
    }
    const entry: Entry = { word, pinyin: pinyin ?? "", levels };
    index.set(word, entry);
    for (const [version, level] of Object.entries(levels)) {
      const key = `${version}:${level}`;
      const bucket = byLevel.get(key);
      if (bucket) bucket.push(entry);
      else byLevel.set(key, [entry]);
    }
  }
}

function idx() {
  if (!index) build();
  return index!;
}

/**
 * Normalise a card's headword to what the list stores: simplified characters,
 * nothing else. Learners paste words with spaces, pinyin or a trailing 的, and a
 * card whose text is "学习 (xuéxí)" is still the HSK 1 word.
 */
export function normalizeHanzi(word: string): string {
  return Array.from(word.trim())
    .filter((ch) => /\p{Script=Han}/u.test(ch))
    .join("");
}

/** The HSK levels a word sits at, or null if it is on neither list. */
export function hskTagFor(word: string): HskTag | null {
  const hit = idx().get(normalizeHanzi(word));
  return hit ? hit.levels : null;
}

/** Words that are new at exactly this level (the "exclusive" list). */
export function hskLevelWords(version: HskVersion, level: number): Entry[] {
  if (!byLevel) build();
  return byLevel!.get(`${version}:${level}`) ?? [];
}

// --- The readiness mark ---

/**
 * One level's coverage. The buckets are exclusive, so they add up to `total`:
 *   canUse    — two correct judged uses on different days (production.ts)
 *   recognise — reviewed past the learning steps, or told us they knew it in the
 *               placement test. Cards you can use are counted here too.
 *   learning  — a card exists but has not survived an interval yet
 *   gap       — no card at all
 * "Has a card" is never enough for recognise: adding a word is not knowing it,
 * and a mark that counted it would be flattering and useless.
 */
export type LevelReadiness = {
  level: number;
  total: number;
  recognise: number;
  canUse: number;
  learning: number;
  gap: number;
};

export type Readiness = {
  version: HskVersion;
  level: number;
  levels: LevelReadiness[];
} & Omit<LevelReadiness, "level">;

const FSRS_REVIEW = 2; // state 2=Review, 3=Relearning — both are past learning

/**
 * The mark for whichever goal applies: what the caller asked for, else the goal
 * saved on the account, else HSK 3.0 level 4 — the level most learners name when
 * asked what they are aiming at, and a sane first screen before they pick.
 */
export async function readinessForUser(telegramId: string, version?: unknown, level?: unknown): Promise<Readiness> {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { hskVersion: true, hskTarget: true },
  });
  const v = asHskVersion(version) ?? asHskVersion(user?.hskVersion) ?? "3.0";
  const n = Number(level) || user?.hskTarget || 4;
  return hskReadiness(telegramId, v, n);
}

type WordStatus = "canUse" | "recognise" | "learning";

/**
 * Best status per headword, keyed by the normalised hanzi. A learner may keep
 * several cards for one word (different senses), and the strongest one is the
 * honest answer. Shared by the mark and the gap deck so the two never disagree.
 */
async function learnerStatus(telegramId: string): Promise<Map<string, WordStatus>> {
  const status = new Map<string, WordStatus>();
  const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  if (!user) return status;

  const rank = { learning: 0, recognise: 1, canUse: 2 };
  const put = (word: string, s: WordStatus) => {
    const key = normalizeHanzi(word);
    if (!key) return;
    const prev = status.get(key);
    if (!prev || rank[s] > rank[prev]) status.set(key, s);
  };

  const [cards, placement] = await Promise.all([
    prisma.word.findMany({
      where: { userId: user.id, sourceLang: "zh" },
      select: { word: true, state: true, canUseAt: true },
    }),
    prisma.placementAnswer.findMany({
      where: { userId: user.id, sourceLang: "zh", known: true },
      select: { word: true },
    }),
  ]);
  for (const c of cards) {
    put(c.word, c.canUseAt ? "canUse" : c.state >= FSRS_REVIEW ? "recognise" : "learning");
  }
  // The placement test's "I know this" is about words that never became cards,
  // so it can only ever raise a gap to recognise — `put` keeps the stronger of
  // the two when the learner also has the card.
  for (const p of placement) put(p.word, "recognise");
  return status;
}

/**
 * Coverage of every level of one HSK list, plus the cumulative mark for the
 * target level (all words up to and including it — that is what an exam asks).
 */
export async function hskReadiness(telegramId: string, version: HskVersion, level: number): Promise<Readiness> {
  const target = clampLevel(version, level);
  const status = await learnerStatus(telegramId);

  const levels: LevelReadiness[] = [];
  for (let n = 1; n <= HSK_MAX_LEVEL[version]; n++) {
    const words = hskLevelWords(version, n);
    let canUse = 0;
    let recognise = 0;
    let learning = 0;
    for (const w of words) {
      const s = status.get(w.word);
      if (s === "canUse") {
        canUse++;
        recognise++;
      } else if (s === "recognise") recognise++;
      else if (s === "learning") learning++;
    }
    levels.push({ level: n, total: words.length, recognise, canUse, learning, gap: words.length - recognise - learning });
  }

  const upToTarget = levels.filter((l) => l.level <= target);
  const sum = (pick: (l: LevelReadiness) => number) => upToTarget.reduce((a, l) => a + pick(l), 0);
  return {
    version,
    level: target,
    total: sum((l) => l.total),
    recognise: sum((l) => l.recognise),
    canUse: sum((l) => l.canUse),
    learning: sum((l) => l.learning),
    gap: sum((l) => l.gap),
    levels,
  };
}

export type ListWord = HskWord & { status: WordStatus | null };

/**
 * One level of an official list, read-only, with where the learner stands on
 * each word — the "HSK 1–6, add them" every HSK app has. Table stakes rather
 * than a differentiator, but an app without it looks empty. Pinyin order, as
 * the list itself is printed.
 */
export async function hskListWords(telegramId: string, version: HskVersion, level: number): Promise<ListWord[]> {
  const n = clampLevel(version, level);
  const status = await learnerStatus(telegramId);
  return hskLevelWords(version, n).map((w) => ({ word: w.word, pinyin: w.pinyin, level: n, status: status.get(w.word) ?? null }));
}

// --- The onboarding check, and the gap deck it feeds ---
//
// Onboarding asks for a target level, then shows a sample of the list to tap
// through ("which of these don't you know"). That is the readiness check: it
// writes PlacementAnswers, which the mark above already reads. The gap deck is
// then the other half of the same list — words at or below the target that the
// learner has neither a card for nor claimed to know.

export type HskWord = { word: string; pinyin: string; level: number };

/**
 * A sample spread evenly over levels 1..target, `size` words in total. Taken by
 * stride rather than at random so one level is never represented by a single
 * corner of the alphabet, with a random offset so a re-take asks new words.
 */
export function hskCheckWords(version: HskVersion, level: number, size = 24): HskWord[] {
  const target = clampLevel(version, level);
  const perLevel = Math.max(1, Math.round(size / target));
  const out: HskWord[] = [];
  for (let n = 1; n <= target; n++) {
    const words = hskLevelWords(version, n);
    if (!words.length) continue;
    const take = Math.min(perLevel, words.length);
    const stride = words.length / take;
    const offset = Math.random() * stride;
    for (let i = 0; i < take; i++) {
      const hit = words[Math.min(words.length - 1, Math.floor(offset + i * stride))];
      out.push({ word: hit.word, pinyin: hit.pinyin, level: n });
    }
  }
  return out.slice(0, size);
}

// Seeded, so the shuffle within a level is fixed for one learner on one day: the
// day's offer doesn't reshuffle on every reload, and tomorrow's is a new draw.
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// The server's calendar day, the same boundary getStats counts "today" by.
function dayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * The list in the order a learner aiming at `target` should meet it: words they
 * tapped as unknown in the check first (they told us), then the target level,
 * then one level down at a time — HSK 1 only once everything above is used up.
 * Shuffled within a level. The old walk went 1→target in file order, which is
 * alphabetical by pinyin, so an HSK 4 learner was handed 一下儿, 一些, 七, 三 …:
 * HSK 1's unproven words filled every deck before level 2 was ever reached.
 */
function frontierOrder(
  version: HskVersion,
  target: number,
  skip: (word: string) => boolean,
  tapped: Set<string>,
  seed: string,
): HskWord[] {
  const rand = seededRandom(seed);
  const first: HskWord[] = [];
  const rest: HskWord[] = [];
  for (let n = target; n >= 1; n--) {
    // Shuffle the whole level, then skip: filtering first would reshuffle every
    // word each time one is rejected or added, and today's offer would jump.
    for (const w of shuffled(hskLevelWords(version, n), rand)) {
      if (skip(w.word)) continue;
      (tapped.has(w.word) ? first : rest).push({ word: w.word, pinyin: w.pinyin, level: n });
    }
  }
  return [...first, ...rest];
}

/** What the ordering needs beyond the status map: who, what they tapped, what they added today. */
async function frontierInputs(telegramId: string) {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { id: true, hskVersion: true, hskTarget: true, dailyGoal: true },
  });
  if (!user) return null;
  const [status, tapped, today] = await Promise.all([
    learnerStatus(telegramId),
    prisma.placementAnswer.findMany({
      where: { userId: user.id, sourceLang: "zh", known: false },
      select: { word: true },
    }),
    prisma.word.findMany({
      where: { userId: user.id, sourceLang: "zh", createdAt: { gte: dayStart() } },
      select: { word: true },
    }),
  ]);
  return {
    user,
    status,
    tapped: new Set(tapped.map((p) => normalizeHanzi(p.word))),
    addedToday: new Set(today.map((w) => normalizeHanzi(w.word))),
    seed: `${user.id}:${dayStart().toISOString().slice(0, 10)}`,
  };
}

/**
 * The words standing between the learner and their target: no card, no "I know
 * it" in the check. The onboarding deck; `frontierOrder` decides which come first.
 */
export async function hskGapWords(
  telegramId: string,
  version: HskVersion,
  level: number,
  limit = 30,
): Promise<HskWord[]> {
  const input = await frontierInputs(telegramId);
  if (!input) return [];
  const target = clampLevel(version, level);
  return frontierOrder(version, target, (w) => input.status.has(w), input.tapped, input.seed).slice(0, limit);
}

// The daily goal the web app starts from (lib/learnPrefs DEFAULT_GOAL) when the
// account has never saved one.
const DEFAULT_DAILY = 5;

export type DailyWord = HskWord & { added: boolean };

/**
 * Today's new words at the learner's level — a daily drip, not a one-off build:
 * "I thought it would always give me some words for my level." The first
 * `dailyGoal` words of the frontier, counting the cards made today as still in
 * it, so once today's words are in review the offer reads "done" until tomorrow
 * instead of refilling forever. A word rejected as known drops out and the next
 * one takes its place; it never comes back, because "known" is a status.
 */
export async function hskDailyWords(
  telegramId: string,
): Promise<{ version: HskVersion; level: number; size: number; words: DailyWord[] }> {
  const input = await frontierInputs(telegramId);
  const version = asHskVersion(input?.user.hskVersion) ?? "3.0";
  const level = clampLevel(version, input?.user.hskTarget ?? 4);
  const size = Math.min(Math.max(input?.user.dailyGoal ?? DEFAULT_DAILY, 1), 50);
  if (!input) return { version, level, size, words: [] };
  const { status, addedToday } = input;
  const order = frontierOrder(version, level, (w) => status.has(w) && !addedToday.has(w), input.tapped, input.seed);
  return { version, level, size, words: order.slice(0, size).map((w) => ({ ...w, added: addedToday.has(w.word) })) };
}

function clampLevel(version: HskVersion, level: number): number {
  return Math.min(Math.max(Math.round(level) || 1, 1), HSK_MAX_LEVEL[version]);
}
