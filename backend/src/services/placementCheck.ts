import { z } from "zod";
import { cedictKnows, cedictLookup, isMeaningGloss } from "./cedict.js";
import { defaultMeaning } from "./lookup.js";
import { HSK_MAX_LEVEL, clampLevel, hskLevelWords, hskTagFor, normalizeHanzi, type HskVersion } from "./hsk.js";

// The check (BACKLOG "An adaptive check that catches overclaiming"). The old one
// was 24 words spread evenly over levels 1..target: ~6 a level, so one tap moved a
// level's share by 17 points, the words sat where the learner already knew
// everything, and nothing noticed a learner who simply tapped nothing.
//
// Adaptive: a screen of words from one level at a time, starting at the level
// the learner says they have. Knowing ≥70% of that level so far moves up, ≤30%
// moves down, anything between is the boundary and gets its neighbours next. So
// an HSK 3 who says "HSK 4" and a real HSK 4 are asked different words and end up
// apart, and the screens gather where knowledge runs out — the levels that price
// most of the plan. The levels well below it borrow the rate of a harder one
// (studyPlan.ts `levelRates`), as they always have.
//
// Overclaiming, caught two ways. Every screen hides one made-up word built from
// two real characters of that level (LexTALE's idea): "I know it" on one says how
// freely this learner claims, and that rate discounts every other claim when the
// sample is stretched over the words never asked (`correctForGuessing`). And as in
// the sweep, one claimed word a screen is asked back as a 4-option meaning
// question; a miss turns it into "to learn".
//
// Stateless: the client sends every finished screen back and gets the next one,
// so the same function serves a guest before sign-in, an account, and the script
// that measures how well it predicts (scripts/check-placement.ts).

export const CHECK_SCREENS = 5;
export const SCREEN_WORDS = 6; // real words a screen, plus one made-up one
const MAX_VISITS = 2; // screens at one level: the boundary gets two, nothing gets three
const UP = 0.7;
const DOWN = 0.3;
const MIN_WORDS = 3; // fewer unasked words than this and a level can't fill a screen
const SENSES = 12; // meanings of the level's other words, for the question's wrong options

export type CheckWord = { word: string; pinyin: string; meaning: string | null };
export type CheckScreen = { n: number; of: number; level: number; words: CheckWord[]; senses: string[] };
export type CheckAnswer = { word: string; known: boolean };
// A finished screen as the client sends it back: every word shown with its tap
// ("known" = left untapped), and the meaning question if one was asked.
export type DoneScreen = { level: number; answers: CheckAnswer[]; probe?: { word: string; right: boolean } | null };

export type CheckResult = {
  asked: number; // real words shown
  knew: number; // of those, left as known (a missed meaning question counts as unknown)
  levels: { level: number; asked: number; knew: number }[];
  fakes: { shown: number; claimed: number };
  probes: { asked: number; missed: number };
  falseAlarm: number; // `falseAlarmRate` of the made-up words
  known: string[]; // real words, as saved: the placement answers
  unknown: string[];
  fakeKnown: string[]; // made-up words, saved apart (PlacementAnswer.fake)
  fakeUnknown: string[];
};

// One request: the goal, the level the learner says they have, and every screen
// finished so far. The same body for a guest and an account.
export const checkBodySchema = z.object({
  version: z.string().optional(),
  target: z.number().int().min(1).max(9),
  claimed: z.number().int().min(0).max(9).default(0),
  native: z.string().max(10).optional(),
  done: z
    .array(
      z.object({
        level: z.number().int().min(1).max(9),
        answers: z.array(z.object({ word: z.string().min(1).max(20), known: z.boolean() })).max(SCREEN_WORDS + 2),
        probe: z.object({ word: z.string().min(1).max(20), right: z.boolean() }).nullable().optional(),
      }),
    )
    .max(CHECK_SCREENS),
});

// --- Made-up words ---

const TONED = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;

// Each character's usual reading, read off the list itself: the lists spell a
// word a syllable per character, so 图书 "tú shū" says 图 is tú. Only toned
// syllables count, which also keeps 的, 了 and 吗 out of made-up words — a "word"
// starting with a particle gives itself away.
let readings: Map<string, string> | null = null;
function charReadings(): Map<string, string> {
  if (readings) return readings;
  const counts = new Map<string, Map<string, number>>();
  for (const version of ["2.0", "3.0"] as const) {
    for (let n = 1; n <= HSK_MAX_LEVEL[version]; n++) {
      for (const w of hskLevelWords(version, n)) {
        const chars = Array.from(w.word);
        const syllables = w.pinyin.split(" ");
        if (chars.length !== syllables.length) continue;
        chars.forEach((ch, i) => {
          if (!TONED.test(syllables[i])) return;
          const c = counts.get(ch) ?? new Map<string, number>();
          c.set(syllables[i], (c.get(syllables[i]) ?? 0) + 1);
          counts.set(ch, c);
        });
      }
    }
  }
  readings = new Map();
  for (const [ch, c] of counts) readings.set(ch, [...c].sort((a, b) => b[1] - a[1])[0][0]);
  return readings;
}

const levelCharCache = new Map<string, { ch: string; py: string }[]>();
function levelChars(version: HskVersion, level: number) {
  const key = `${version}:${level}`;
  let out = levelCharCache.get(key);
  if (!out) {
    const seen = new Set<string>();
    out = [];
    for (const w of hskLevelWords(version, level)) {
      for (const ch of w.word) {
        const py = charReadings().get(ch);
        if (py && !seen.has(ch)) {
          seen.add(ch);
          out.push({ ch, py });
        }
      }
    }
    levelCharCache.set(key, out);
  }
  return out;
}

/**
 * Two real characters of this level that make no word: not on either list, not
 * in CC-CEDICT, and not a word read backwards either (书图 is 图书 misread).
 */
export function makeFakeWord(version: HskVersion, level: number, avoid: Set<string>, rand = Math.random): CheckWord | null {
  const chars = levelChars(version, level);
  if (chars.length < 2) return null;
  for (let tries = 0; tries < 80; tries++) {
    const a = chars[Math.floor(rand() * chars.length)];
    const b = chars[Math.floor(rand() * chars.length)];
    const word = a.ch + b.ch;
    if (a.ch === b.ch || avoid.has(word)) continue;
    if (hskTagFor(word) || cedictKnows(word) || cedictKnows(b.ch + a.ch)) continue;
    return { word, pinyin: `${a.py} ${b.py}`, meaning: null };
  }
  return null;
}

/**
 * How freely this learner says "I know it", from the made-up words: the share
 * of them claimed, with the first one forgiven — one can look like a real
 * compound, or be a slip of the thumb, and one slip shouldn't dock every level.
 */
export function falseAlarmRate(shown: number, claimed: number): number {
  return shown > 0 ? Math.max(0, claimed - 1) / shown : 0;
}

/**
 * The share of a level really known, from the share claimed. A learner who
 * claims a made-up word at rate g also claims that share of the real words they
 * don't know, so claimed = p + (1 − p)·g, and p = (claimed − g) / (1 − g) — the
 * standard correction for guessing in yes/no vocabulary tests.
 *
 * Measured, not assumed (scripts/check-placement.ts): refusing to believe any
 * claim once half the made-up words were claimed zeroed whole levels on one
 * unlucky run and did worse than no correction; so did discounting by missed
 * meaning questions (each miss already turns its own word to "unknown"). The
 * plain correction, with the first made-up word forgiven, is what helped.
 */
export function correctForGuessing(claimed: number, g: number): number {
  if (g <= 0) return claimed;
  const rate = Math.min(g, 0.8);
  return Math.max(0, (claimed - rate) / (1 - rate));
}

// --- Meanings, for the question ---

const firstSense = (m: string) => m.split(/[;；]/)[0].trim();

/** One short meaning in the learner's language: the shared Russian one, or CC-CEDICT's English. */
function meaningFor(word: string, native: string | null | undefined): string | null {
  const own = defaultMeaning(word, native);
  if (own) return firstSense(own) || null;
  if (native !== "en") return null;
  const entry = cedictLookup(word, { count: false });
  const readings = entry?.readings.filter((r) => r.pinyin[0] === r.pinyin[0].toLowerCase()) ?? [];
  const gloss = readings.flatMap((r) => r.glosses).find(isMeaningGloss);
  return gloss ? firstSense(gloss.replace(/\s*\([^)]*\)/g, "")) || null : null;
}

// --- The screens ---

function shuffle<T>(items: T[], rand = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const isReal = (word: string) => hskTagFor(word) !== null;

/** Each answer as it stands after the meaning questions: a missed one is "unknown". */
function settled(screen: DoneScreen): CheckAnswer[] {
  const missed = screen.probe && !screen.probe.right ? normalizeHanzi(screen.probe.word) : null;
  return screen.answers.map((a) => ({ word: normalizeHanzi(a.word), known: a.known && normalizeHanzi(a.word) !== missed }));
}

/** Share of the real words known on every screen at this level so far. */
function shareAt(done: DoneScreen[], level: number): number {
  let asked = 0;
  let knew = 0;
  for (const s of done.filter((x) => x.level === level)) {
    for (const a of settled(s)) {
      if (!isReal(a.word)) continue;
      asked++;
      if (a.known) knew++;
    }
  }
  return asked ? knew / asked : 0;
}

/** Where the next screen goes: the staircase, with the fallbacks it needs at the ends. */
function pickLevel(cap: number, start: number, done: DoneScreen[], usable: (n: number) => boolean): number | null {
  const visits = new Map<number, number>();
  for (const s of done) visits.set(s.level, (visits.get(s.level) ?? 0) + 1);
  const open = (n: number) => n >= 1 && n <= cap && (visits.get(n) ?? 0) < MAX_VISITS && usable(n);
  const fresh = (n: number) => open(n) && !visits.has(n);
  // How unsettled a level still is: p(1 − p) of its share so far, the most for
  // one never asked. An HSK 2 at 6 of 6 has little left to say; HSK 4 at 2 of 6 does.
  const doubt = (n: number) => (visits.has(n) ? shareAt(done, n) * (1 - shareAt(done, n)) : 0.25);
  const nearest = (from: number) => {
    for (let d = 0; d <= cap; d++) {
      const below = open(from - d) ? from - d : null;
      const above = d > 0 && open(from + d) ? from + d : null;
      if (below !== null && above !== null) return doubt(above) > doubt(below) ? above : below;
      if (below !== null || above !== null) return below ?? above;
    }
    return null;
  };
  if (!done.length) return nearest(start);

  const last = done[done.length - 1].level;
  const share = shareAt(done, last);
  if (share >= UP) {
    if (open(last + 1)) return last + 1;
    // At the top already: check the floor — the highest easier level not asked
    // yet — before asking this one a second time.
    for (let n = last - 1; n >= 1; n--) if (fresh(n)) return n;
    return nearest(last);
  }
  if (share <= DOWN) {
    if (open(last - 1)) return last - 1;
    // Nothing easier left to ask: settle this level, or stop — a learner who knows
    // little of HSK 1 learns nothing from being shown HSK 2.
    return open(last) ? last : null;
  }
  // Between: the boundary is here. Its neighbours first, the easier one before
  // the harder (it is assumed known, and it prices more of the plan), then this
  // level again.
  if (fresh(last - 1)) return last - 1;
  if (fresh(last + 1)) return last + 1;
  return nearest(last);
}

/**
 * The next screen of the check, or null when it's over: five screens, or sooner
 * when nothing is left worth asking. `claimed` is the self-rated level (1–6);
 * the check never goes above the target — nothing there prices the plan.
 * `skip` leaves out words an account already has a card or an answer for, so an
 * account's check samples exactly the words its estimate is stretched over.
 */
export function nextCheckScreen(input: {
  version: HskVersion;
  target: number;
  claimed: number;
  native?: string | null;
  done: DoneScreen[];
  skip?: (word: string) => boolean;
  rand?: () => number;
}): CheckScreen | null {
  const { version, done, skip } = input;
  const rand = input.rand ?? Math.random;
  if (done.length >= CHECK_SCREENS) return null;
  const cap = clampLevel(version, input.target);
  const asked = new Set(done.flatMap((s) => s.answers.map((a) => normalizeHanzi(a.word))));
  const pool = (n: number) => hskLevelWords(version, n).filter((w) => !asked.has(w.word) && !skip?.(w.word));
  const level = pickLevel(cap, Math.min(Math.max(Math.round(input.claimed) || 1, 1), cap), done, (n) => pool(n).length >= MIN_WORDS);
  if (level === null) return null;

  const words: CheckWord[] = shuffle(pool(level), rand)
    .slice(0, SCREEN_WORDS)
    .map((w) => ({ word: w.word, pinyin: w.pinyin, meaning: meaningFor(w.word, input.native) }));
  const onScreen = new Set(words.map((w) => w.word));
  const fake = makeFakeWord(version, level, asked, rand);
  if (fake) words.splice(Math.floor(rand() * (words.length + 1)), 0, fake);
  const senses = Array.from(
    new Set(
      shuffle(hskLevelWords(version, level), rand)
        .filter((w) => !onScreen.has(w.word))
        .slice(0, SENSES * 2)
        .map((w) => meaningFor(w.word, input.native))
        .filter((m): m is string => Boolean(m)),
    ),
  ).slice(0, SENSES);
  return { n: done.length + 1, of: CHECK_SCREENS, level, words, senses };
}

/** What the check found, in the shape the placement answers are saved in. */
export function checkResult(version: HskVersion, done: DoneScreen[]): CheckResult {
  const known: string[] = [];
  const unknown: string[] = [];
  const fakeKnown: string[] = [];
  const fakeUnknown: string[] = [];
  const byLevel = new Map<number, { asked: number; knew: number }>();
  let probesAsked = 0;
  let probesMissed = 0;
  for (const s of done) {
    if (s.probe) {
      probesAsked++;
      if (!s.probe.right) probesMissed++;
    }
    for (const a of settled(s)) {
      const level = hskTagFor(a.word)?.[version];
      if (!isReal(a.word)) {
        (a.known ? fakeKnown : fakeUnknown).push(a.word);
        continue;
      }
      (a.known ? known : unknown).push(a.word);
      if (!level) continue;
      const row = byLevel.get(level) ?? { asked: 0, knew: 0 };
      row.asked++;
      if (a.known) row.knew++;
      byLevel.set(level, row);
    }
  }
  const shown = fakeKnown.length + fakeUnknown.length;
  return {
    asked: known.length + unknown.length,
    knew: known.length,
    levels: [...byLevel].sort((a, b) => a[0] - b[0]).map(([level, r]) => ({ level, ...r })),
    fakes: { shown, claimed: fakeKnown.length },
    probes: { asked: probesAsked, missed: probesMissed },
    falseAlarm: falseAlarmRate(shown, fakeKnown.length),
    known,
    unknown,
    fakeKnown,
    fakeUnknown,
  };
}
