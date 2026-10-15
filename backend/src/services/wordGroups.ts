import { prisma } from "./db.js";
import { cedictLookup, isMeaningGloss } from "./cedict.js";
import { likedSituations } from "../lib/interests.js";
import { defaultMeaning } from "./lookup.js";
import { hskSituations, type Situation } from "./wordPages.js";
import { asHskVersion, clampLevel, frontierInputs, frontierOrder, type HskVersion, type HskWord } from "./hsk.js";

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
// How deep a situation the learner's goal or interests point at may reach for its
// words. Travel and IT words sit lower in jieba's written-text counts than news ones:
// a travel + IT learner (HSK 3.0 L4, 30 days) got their own theme on 2 days at 200,
// 7 at 400 and 14 at 600, with no news or army day in the first ten; the first 100
// words then cover 87% of the usage frequency alone does (93% with no interests).
const LIKED_POOL = 600;
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
 * `MIN_THEME` words that are not near-synonyms of what is already taken. A situation
 * the learner's goal or interests point at (`liked`) leads whenever one has enough
 * words in the pool: jieba's counts come from written text, much of it news, so on
 * usage alone an HSK 4 day was news, politics or the army half the time (主席 大会
 * 机构, 总理 总统 政府, 兵 战争 敌人) for a learner who came for travel or IT. Its words
 * may come from LIKED_POOL deep; every other theme's from the top POOL.
 */
function chooseThemes(deep: HskWord[], slots: number, liked: ReadonlySet<Situation>): Situation[] {
  const rank = new Map(deep.map((w, i) => [w.word, i]));
  const chosen: Situation[] = [];
  const taken: string[] = [];
  let left = slots;
  while (left >= 2) {
    const members = new Map<Situation, string[]>();
    for (const [i, w] of deep.entries()) {
      if (taken.includes(w.word)) continue;
      for (const s of hskSituations(w.word))
        if (!chosen.includes(s) && (i < POOL || liked.has(s))) members.set(s, [...(members.get(s) ?? []), w.word]);
    }
    let best: { s: Situation; words: string[]; score: number; liked: boolean } | null = null;
    for (const [s, all] of members) {
      const words: string[] = [];
      for (const m of all) if (words.length < left && ![...taken, ...words].some((t) => nearSynonyms(t, m))) words.push(m);
      if (words.length < Math.min(MIN_THEME, left)) continue;
      const score = words.reduce((a, m) => a + POOL - rank.get(m)!, 0);
      const fav = liked.has(s);
      if (!best || (fav && !best.liked) || (fav === best.liked && score > best.score)) best = { s, words, score, liked: fav };
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
  liked: ReadonlySet<Situation>,
): GroupWord[] {
  const pool = order.slice(0, POOL);
  const deep = order.slice(0, LIKED_POOL);
  const abstractCap = abstractSlots(size);
  const out = [...kept];
  const fits = (w: HskWord, strict = true) =>
    !dropped.has(w.word) && !out.some((o) => o.word === w.word || (strict && nearSynonyms(o.word, w.word)));
  const put = (w: HskWord, situation: Situation | null) => out.push({ word: w.word, pinyin: w.pinyin, level: w.level, situation });
  const count = (abstract: boolean) => out.filter((o) => concrete(o) !== abstract).length;

  for (const s of themes)
    for (const w of liked.has(s) ? deep : pool)
      if (out.length < size && count(false) < size - abstractCap && hskSituations(w.word).includes(s) && fits(w)) put(w, s);
  for (const w of pool) if (out.length < size && count(true) < abstractCap && !concrete(w) && fits(w)) put(w, null);
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
 * under the learner's thumb, as the order does. `first`: words the learner said they
 * don't know (the check, a sweep's "to learn"). They lead the day as they lead the
 * order — they told us — and the themes fill what is left of it.
 */
export function nextGroup(
  order: HskWord[],
  size: number,
  dropped: ReadonlySet<string> = new Set(),
  first: ReadonlySet<string> = new Set(),
  liked: ReadonlySet<Situation> = new Set(),
): WordGroup {
  const lead = order.filter((w) => first.has(w.word)).slice(0, size);
  const open = order.slice(0, LIKED_POOL).filter((w) => !lead.includes(w));
  const themes = chooseThemes(open, Math.min(size - lead.length, size - abstractSlots(size) - lead.filter(concrete).length), liked);
  const situationOf = (w: HskWord) => themes.find((s) => hskSituations(w.word).includes(s)) ?? hskSituations(w.word)[0] ?? null;
  let words = fill(order, size, themes, lead.map((w) => ({ ...w, situation: situationOf(w) })), new Set(), liked);
  if (words.some((w) => dropped.has(w.word))) words = fill(order, size, themes, words.filter((w) => !dropped.has(w.word)), dropped, liked);
  return { theme: themes.find((s) => words.some((w) => w.situation === s)) ?? null, words };
}

/** The situations the learner's goal and interests (coach memory, zh) point at. */
export async function likedFor(userId: string): Promise<Set<Situation>> {
  const m = await prisma.coachMemory.findUnique({ where: { userId_lang: { userId, lang: "zh" } }, select: { goal: true, interests: true } });
  return likedSituations(m?.goal ?? "", m?.interests ?? "");
}

// The daily goal the web app starts from (lib/learnPrefs DEFAULT_GOAL) when the
// account has never saved one.
const DEFAULT_DAILY = 5;

export type DailyWord = GroupWord & { added: boolean };
export type DailyGroup = { version: HskVersion; level: number; size: number; theme: Situation | null; words: DailyWord[] };

/**
 * Today's new words at the learner's level — a daily drip, not a one-off build:
 * "I thought it would always give me some words for my level." `dailyGoal` words
 * of the frontier as one group (`nextGroup`), named after its situation. The cards
 * made today and today's "I know it"s stay in the order, so the day holds still:
 * once its words are in review it reads "done" until tomorrow instead of refilling,
 * and a word said known leaves while the rest stay. It never comes back, because
 * "known" is a status.
 */
export async function hskDailyWords(telegramId: string): Promise<DailyGroup> {
  const input = await frontierInputs(telegramId);
  const version = asHskVersion(input?.user.hskVersion) ?? "3.0";
  const level = clampLevel(version, input?.user.hskTarget ?? 4);
  const size = Math.min(Math.max(input?.user.dailyGoal ?? DEFAULT_DAILY, 1), 50);
  if (!input) return { version, level, size, theme: null, words: [] };
  const { status, addedToday, knownToday } = input;
  const order = frontierOrder(version, level, (w) => status.has(w) && !addedToday.has(w) && !knownToday.has(w), input.tapped, input.have);
  const group = nextGroup(order, size, knownToday, input.tapped, await likedFor(input.user.id));
  const added = (w: GroupWord) => ({ ...w, added: addedToday.has(w.word) });
  // A day's worth of frontier words already taken another way (onboarding's deck
  // is the first day's words, or the HSK list page): the day reads done over them
  // rather than offering a second group beside them.
  const taken = order.filter((w) => addedToday.has(w.word));
  if (taken.length >= size && group.words.some((w) => !addedToday.has(w.word)))
    return { version, level, size, theme: null, words: taken.slice(0, size).map((w) => added({ ...w, situation: hskSituations(w.word)[0] ?? null })) };
  return { version, level, size, theme: group.theme, words: group.words.map(added) };
}
