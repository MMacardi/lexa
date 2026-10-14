import { cedictLookup, isMeaningGloss } from "./cedict.js";
import { defaultMeaning } from "./lookup.js";
import { hskSituations, type Situation } from "./wordPages.js";
import type { HskWord } from "./hsk.js";

/**
 * A day's new words as one group that is easier to learn together (BACKLOG 1e,
 * PLAN-word-groups.md part 1).
 *
 * The frontier (`frontierOrder`, hsk.ts) is ranked by usage, and jieba's counts come
 * from written text, so an HSK 3.0 level 4 learner's first day was five connectors:
 * 而 此 自 以及 却 — three of them «и / но, однако». Now a day leads with the words of
 * one situation (transit, the office), takes the words that belong to no situation a
 * few at a time, and never holds two words that mean the same: learned side by side,
 * near-synonyms blur into each other (the "ten colours" rule).
 *
 * Chosen only from the top of the frontier (`POOL`), so a theme never costs
 * usefulness: everything in a day is already among the most useful next words.
 * Character families and words that share sentences were in the plan and left out
 * (the author, 2026-10-14): a known character's words (二手 分手 手套) share little
 * meaning, and the ranking already prefers words made of characters the learner has.
 */

// The top of the frontier a day is chosen from: deep enough that some situation has
// three words in it (at 120, half of 30 days had none), shallow enough that the first
// 100 words still cover 93% of the usage the frequency order alone does (HSK 3.0 L4,
// scripts/check-word-groups.ts).
const POOL = 200;
// The share of a day kept for words with no situation (而 此 却 以及). About the share
// they hold in a level (half of HSK 3.0 L4), so they come steadily, a couple a day,
// and never pile up at the end of the level as a run of connector days.
const ABSTRACT_SHARE = 0.4;
// A situation is a theme when it brings this many words to the day; fewer is a coincidence.
const MIN_THEME = 3;

/** A day's word, and the situation it came for (null: one of the words that belong to none). */
export type GroupWord = HskWord & { situation: Situation | null };
/** `theme`: the situation the day is named after, null when no situation had enough words. */
export type WordGroup = { theme: Situation | null; words: GroupWord[] };

const termsOf = new Map<string, Set<string>>();

/**
 * What a word means, as a set of terms: those of its shared Russian meaning
 * (hsk-ru), else CC-CEDICT's English. Usage hints in brackets left out, so
 * «надеть (одежду)» is «надеть».
 */
function meaningTerms(word: string): Set<string> {
  let terms = termsOf.get(word);
  if (terms) return terms;
  const ru = defaultMeaning(word, "ru");
  const en = cedictLookup(word, { count: false })
    ?.readings.filter((r) => r.pinyin[0] === r.pinyin[0]?.toLowerCase())
    .flatMap((r) => r.glosses.filter(isMeaningGloss));
  terms = new Set(
    (ru ?? en?.join("; ") ?? "")
      .replace(/\s*[(（][^)）]*[)）]/g, "")
      .split(/[;；,，/]/)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );
  termsOf.set(word, terms);
  return terms;
}

/** Do two words say the same thing in one of their senses? 而 / 却 «но», 巴士 / 大巴 «автобус». */
export function nearSynonyms(a: string, b: string): boolean {
  const ta = meaningTerms(a);
  for (const t of meaningTerms(b)) if (ta.has(t)) return true;
  return false;
}

const concrete = (w: HskWord) => hskSituations(w.word).length > 0;
// A day of one or two words is just the next ones; no share to keep.
const abstractSlots = (size: number) => (size < 3 ? 0 : Math.round(size * ABSTRACT_SHARE));

/**
 * The situations a day is built around, best first: the one whose words stand
 * highest in the pool, then, for a day too big for one, the next. Each must bring
 * `MIN_THEME` words that are not near-synonyms of what is already taken.
 */
function chooseThemes(pool: HskWord[], slots: number): Situation[] {
  const rank = new Map(pool.map((w, i) => [w.word, i]));
  const chosen: Situation[] = [];
  const taken: string[] = [];
  let left = slots;
  while (left >= 2) {
    const members = new Map<Situation, string[]>();
    for (const w of pool) {
      if (taken.includes(w.word)) continue;
      for (const s of hskSituations(w.word)) if (!chosen.includes(s)) members.set(s, [...(members.get(s) ?? []), w.word]);
    }
    let best: { s: Situation; words: string[]; score: number } | null = null;
    for (const [s, all] of members) {
      const words: string[] = [];
      for (const m of all) if (words.length < left && ![...taken, ...words].some((t) => nearSynonyms(t, m))) words.push(m);
      if (words.length < Math.min(MIN_THEME, left)) continue;
      const score = words.reduce((a, m) => a + POOL - rank.get(m)!, 0);
      if (!best || score > best.score) best = { s, words, score };
    }
    if (!best) break;
    chosen.push(best.s);
    taken.push(...best.words);
    left -= best.words.length;
  }
  return chosen;
}

/**
 * Fill a day: the themes' words, then the abstract ones up to their share, then the
 * rest of the pool's concrete words, then anything from the top. Near-synonyms of a
 * word already in stay out, unless nothing else is left. `kept` are words the day
 * already holds; `dropped` never come in.
 */
function fill(
  order: HskWord[],
  size: number,
  themes: Situation[],
  kept: GroupWord[],
  dropped: ReadonlySet<string>,
): GroupWord[] {
  const pool = order.slice(0, POOL);
  const abstractCap = abstractSlots(size);
  const out = [...kept];
  const fits = (w: HskWord, strict = true) =>
    !dropped.has(w.word) && !out.some((o) => o.word === w.word || (strict && nearSynonyms(o.word, w.word)));
  const put = (w: HskWord, situation: Situation | null) => out.push({ word: w.word, pinyin: w.pinyin, level: w.level, situation });
  const count = (abstract: boolean) => out.filter((o) => concrete(o) !== abstract).length;

  for (const s of themes)
    for (const w of pool)
      if (count(false) < size - abstractCap && hskSituations(w.word).includes(s) && fits(w)) put(w, s);
  for (const w of pool) if (count(true) < abstractCap && !concrete(w) && fits(w)) put(w, null);
  for (const w of pool) if (out.length < size && concrete(w) && fits(w)) put(w, hskSituations(w.word)[0]);
  for (const strict of [true, false])
    for (const w of order) if (out.length < size && fits(w, strict)) put(w, hskSituations(w.word)[0] ?? null);
  return out;
}

/**
 * Today's new words from the frontier, as a group. `order` is the frontier as it
 * stood when the day began — words said known today still in it — and `dropped`
 * those words: they leave the day, the rest stay put, and each gap fills as the day
 * itself would have (a theme word by the theme's next word). So the day holds still
 * under the learner's thumb, as the order does.
 */
export function nextGroup(order: HskWord[], size: number, dropped: ReadonlySet<string> = new Set()): WordGroup {
  const themes = chooseThemes(order.slice(0, POOL), size - abstractSlots(size));
  let words = fill(order, size, themes, [], new Set());
  if (words.some((w) => dropped.has(w.word))) words = fill(order, size, themes, words.filter((w) => !dropped.has(w.word)), dropped);
  return { theme: themes.find((s) => words.some((w) => w.situation === s)) ?? null, words };
}
