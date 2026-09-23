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

/**
 * The words standing between the learner and their target: no card, no "I know
 * it" in the check. Easiest level first, because a gap at HSK 2 hurts more than
 * one at HSK 5 — and a deck that starts with words you can almost read is the
 * one that gets reviewed.
 */
export async function hskGapWords(
  telegramId: string,
  version: HskVersion,
  level: number,
  limit = 30,
): Promise<HskWord[]> {
  const target = clampLevel(version, level);
  const status = await learnerStatus(telegramId);
  const out: HskWord[] = [];
  for (let n = 1; n <= target && out.length < limit; n++) {
    for (const w of hskLevelWords(version, n)) {
      if (status.has(w.word)) continue;
      out.push({ word: w.word, pinyin: w.pinyin, level: n });
      if (out.length >= limit) break;
    }
  }
  return out;
}

function clampLevel(version: HskVersion, level: number): number {
  return Math.min(Math.max(Math.round(level) || 1, 1), HSK_MAX_LEVEL[version]);
}
