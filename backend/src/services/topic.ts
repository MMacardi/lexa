import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { suggestTopicWords, type TopicCandidate } from "../agents/topicWords.js";
import { updateProfile } from "./coachMemory.js";
import { asHskVersion, dayStart, hskLevelWords, hskTagFor, normalizeHanzi, HSK_MAX_LEVEL, type HskVersion } from "./hsk.js";

// Topic words beside the exam words (BACKLOG item of that name): the words of a
// field the learner follows (服务器, 算法 for IT), off the HSK lists or far above
// them, TOPIC_DAILY a day next to the HSK ones.
//
// The fields are the learner's interests — picked in onboarding, the same chips as
// Settings (BACKLOG "Your field without asking again"). Nobody names a topic on
// Today, and there is no free-text one: a fixed field is one the model knows well.
// Each interest has its own pool, listed by the model once and kept on the account
// (User.topicPool = { [interest]: words }), so a day costs no model call. The day's
// words go round the interests — with two of them 2 + 1, then 1 + 2 the next day —
// so every field turns up every day or two. Words of different fields don't get
// mixed up the way near-synonyms do, so one day may hold several.
//
// User.topic is only a switch now: "" = topic words turned off (the interests stay,
// for the coach and the examples), anything else = on. It used to hold the one
// topic's name, and topicPool that topic's list.

export const TOPIC_DAILY = 3;
const POOL_MAX = 40;
const OFF = "";
const RETRY_MS = 10 * 60_000;

export type TopicWord = {
  word: string;
  pinyin: string;
  meaning: string;
  fromText: boolean; // occurs in the text the learner gave
  known: number; // share of its characters the learner already has (0–1)
  hsk: number | null; // its level on the learner's list, if it is on one at all
};
type Pools = Record<string, TopicWord[]>;

export type TopicDay = {
  on: boolean;
  topics: string[]; // the learner's interests, each a field
  words: (TopicWord & { added: boolean; topic: string })[];
  left: number;
};

/**
 * A word the learner's level already covers: on their list at or below the target
 * (the exam track brings it), or below the target on the other list. 火车 is HSK 1
 * on 3.0 and off 2.0 (only 火车站 is there), so a 2.0 HSK 4 learner was offered it
 * as a travel word. At the target on the other list it stays: 高铁 is 3.0 HSK 4,
 * a travel term the 2.0 track never brings.
 */
export function coveredByLevel(word: string, version: HskVersion, target: number): boolean {
  const tag = hskTagFor(word);
  if (!tag) return false;
  const own = tag[version];
  if (own != null && own <= target) return true;
  return Object.values(tag).some((n) => n != null && n < target);
}

/**
 * The pool in the order it should be met. Words from the learner's own text first
 * (most frequent there first): that is the material they are actually reading.
 * Then words made only of characters they know (数据 = 数 + 据 for an HSK 4 — cheap
 * to learn, which is what "usable at my level" means in Chinese), then mostly
 * known, then the rest; the model's frequency order breaks ties. Words their level
 * already covers are dropped (coveredByLevel): the exam track brings those, or
 * they are a beginner's words, and offering them as the field's would be noise.
 */
export function rankTopicWords(
  candidates: TopicCandidate[],
  opts: {
    have: Set<string>; // cards + "I know it" answers
    knownChars: Set<string>;
    text?: string;
    hskLevelOf: (word: string) => number | null;
    covered: (word: string) => boolean;
  },
): TopicWord[] {
  const seen = new Set<string>();
  const rows: (TopicWord & { order: number; count: number })[] = [];
  candidates.forEach((c, order) => {
    const word = normalizeHanzi(c.word);
    // 2–8 Han characters: a single character is rarely a field's term, and more
    // than eight is a phrase the model slipped in.
    if (word.length < 2 || word.length > 8 || word !== c.word.replace(/\s+/g, "") || seen.has(word)) return;
    seen.add(word);
    if (opts.have.has(word) || opts.covered(word)) return;
    const hsk = opts.hskLevelOf(word);
    const chars = Array.from(word);
    const known = chars.filter((ch) => opts.knownChars.has(ch)).length / chars.length;
    const count = opts.text ? opts.text.split(word).length - 1 : 0;
    rows.push({ word, pinyin: c.pinyin, meaning: c.meaning, fromText: count > 0, known, hsk, order, count });
  });
  const bucket = (k: number) => (k === 1 ? 0 : k >= 0.5 ? 1 : 2);
  rows.sort(
    (a, b) =>
      Number(b.fromText) - Number(a.fromText) ||
      (a.fromText ? b.count - a.count : 0) ||
      bucket(a.known) - bucket(b.known) ||
      a.order - b.order,
  );
  return rows.slice(0, POOL_MAX).map(({ order: _o, count: _c, ...w }) => w);
}

/** What the learner already has, and the characters those words are made of. */
async function learnerWords(userId: string, version: HskVersion, target: number) {
  const [cards, told] = await Promise.all([
    prisma.word.findMany({ where: { userId, sourceLang: "zh" }, select: { word: true, createdAt: true } }),
    prisma.placementAnswer.findMany({ where: { userId, sourceLang: "zh", known: true, fake: false }, select: { word: true } }),
  ]);
  const have = new Set([...cards.map((c) => normalizeHanzi(c.word)), ...told.map((p) => normalizeHanzi(p.word))]);
  // Characters: every card and every "I know it", plus the list below the target —
  // someone aiming at HSK 4 reads HSK 1–3's characters, card or not.
  const knownChars = new Set<string>();
  for (const w of have) for (const ch of w) knownChars.add(ch);
  for (let n = 1; n < target; n++) for (const e of hskLevelWords(version, n)) for (const ch of e.word) knownChars.add(ch);
  const today = dayStart();
  const addedToday = new Set(cards.filter((c) => c.createdAt >= today).map((c) => normalizeHanzi(c.word)));
  return { have, knownChars, addedToday };
}

async function userFor(telegramId: string) {
  return prisma.user.findUnique({
    where: { telegramId },
    select: { id: true, hskVersion: true, hskTarget: true, nativeLang: true, topic: true, topicPool: true },
  });
}

function levelOf(user: { hskVersion: string | null; hskTarget: number | null }) {
  const version = asHskVersion(user.hskVersion) ?? "3.0";
  return { version, target: Math.min(Math.max(user.hskTarget ?? 4, 1), HSK_MAX_LEVEL[version]) };
}

/** The pools by interest; the one-topic list of before counts as that topic's. */
function poolsOf(user: { topic: string | null; topicPool: Prisma.JsonValue }): Pools {
  const p = user.topicPool;
  if (Array.isArray(p)) return user.topic ? { [user.topic]: p as unknown as TopicWord[] } : {};
  return p && typeof p === "object" ? (p as unknown as Pools) : {};
}

/**
 * The interests (coach memory, zh), one field each. Onboarding and the chips write
 * them as "Технологии и IT, Игры и аниме"; an older free-text entry may use any
 * list separator.
 */
export function splitInterests(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,，、;；\n]+/)) {
    const s = part.trim().slice(0, 60);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out.slice(0, 16);
}

async function interestsOf(userId: string): Promise<string[]> {
  const m = await prisma.coachMemory.findUnique({ where: { userId_lang: { userId, lang: "zh" } }, select: { interests: true } });
  return splitInterests(m?.interests ?? "");
}

/** Which field each of the day's TOPIC_DAILY words comes from: round the list, a day at a time. */
export function slotTopics(topics: string[], day: number): string[] {
  if (!topics.length) return [];
  return Array.from({ length: TOPIC_DAILY }, (_, i) => topics[(day * TOPIC_DAILY + i) % topics.length]);
}

export const dayNumber = () => Math.round(dayStart().getTime() / 86_400_000);

// A field whose list failed isn't asked for again on every load for a while (the
// model being down shouldn't make each Today wait 45 s).
const failed = new Map<string, number>();
const failKey = (telegramId: string, topic: string) => `${telegramId}\n${topic}`;

/**
 * List fields' words (one model call each, in parallel) and keep each as that
 * field's pool: ranked, what the learner has dropped, the reading from pinyin-pro
 * (it knows the field's compounds — 算法 suàn fǎ — and doesn't invent tones).
 * `more` adds words the pool doesn't hold yet ("More words"); otherwise only a
 * field with no pool is listed.
 */
async function fillPools(telegramId: string, topics: string[], more: boolean): Promise<void> {
  const user = await userFor(telegramId);
  if (!user) throw new Error("No such learner");
  const pools = poolsOf(user);
  const todo = more ? topics : topics.filter((t) => !pools[t] && Date.now() - (failed.get(failKey(telegramId, t)) ?? 0) > RETRY_MS);
  if (!todo.length) return;
  const { version, target } = levelOf(user);
  const { have, knownChars } = await learnerWords(user.id, version, target);
  const { pinyin } = await import("pinyin-pro");
  const results = await Promise.allSettled(
    todo.map(async (topic) => {
      const old = pools[topic] ?? [];
      const candidates = await suggestTopicWords({
        topic,
        level: target,
        targetLang: user.nativeLang ?? "ru",
        avoid: more ? old.map((w) => w.word) : undefined,
      });
      const had = new Set([...have, ...old.map((w) => w.word)]);
      const ranked = rankTopicWords(candidates, {
        have: had,
        knownChars,
        hskLevelOf: (w) => hskTagFor(w)?.[version] ?? null,
        covered: (w) => coveredByLevel(w, version, target),
      });
      return [...old, ...ranked.map((w) => ({ ...w, pinyin: pinyin(w.word, { toneType: "symbol", type: "string" }) }))];
    }),
  );
  let changed = false;
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      pools[todo[i]] = r.value;
      failed.delete(failKey(telegramId, todo[i]));
      changed = true;
    } else {
      failed.set(failKey(telegramId, todo[i]), Date.now());
      console.error(`topic words for "${todo[i]}" failed:`, (r.reason as Error).message);
    }
  });
  if (changed) await prisma.user.update({ where: { id: user.id }, data: { topicPool: pools as unknown as Prisma.InputJsonValue } });
  if (!changed) throw new Error("Couldn't list the field's words");
}

// One fill at a time per learner: two of them writing the pool map at once would
// lose one's words, and two loads of Today would list the same field twice.
const queue = new Map<string, Promise<void>>();
function fill(telegramId: string, topics: string[], more = false): Promise<void> {
  const run = (queue.get(telegramId) ?? Promise.resolve()).catch(() => {}).then(() => fillPools(telegramId, topics, more));
  queue.set(telegramId, run);
  void run.catch(() => {}).finally(() => queue.get(telegramId) === run && queue.delete(telegramId));
  return run;
}

/** The chips on Today: the learner's fields are their interests, and picking them turns topic words on. */
export async function setTopics(telegramId: string, topics: string[]): Promise<void> {
  await updateProfile(telegramId, "zh", { interests: topics.join(", ") });
  await prisma.user.update({ where: { telegramId }, data: { topic: null } });
}

/** Off, pools kept: turning it back on costs no model call. */
export async function clearTopic(telegramId: string): Promise<void> {
  await prisma.user.update({ where: { telegramId }, data: { topic: OFF } });
}

/** Every field of the day has run dry: ask for words the pools don't hold yet. */
export async function moreTopicWords(telegramId: string): Promise<void> {
  const user = await userFor(telegramId);
  if (!user) throw new Error("No such learner");
  await fill(telegramId, [...new Set(slotTopics(await interestsOf(user.id), dayNumber()))], true);
}

/**
 * Today's topic words: TOPIC_DAILY slots round the learner's fields, each taking
 * the first word of its field's pool the learner has neither a card for nor said
 * they know (a field run dry lends its slot to the others) — except words added
 * today, which stay in the offer (marked added), so the card reads "done" until
 * tomorrow instead of refilling the moment they're taken. A field of the day with
 * no pool yet is listed first: that is how the interests from onboarding become
 * words on the first Today, unasked. `left` counts what the pools still hold
 * beyond today's; at zero, the card offers more.
 */
export async function topicDaily(telegramId: string): Promise<TopicDay> {
  const user = await userFor(telegramId);
  if (!user) return { on: false, topics: [], words: [], left: 0 };
  const topics = await interestsOf(user.id);
  const on = user.topic !== OFF;
  if (!on || !topics.length) return { on, topics, words: [], left: 0 };
  const slots = slotTopics(topics, dayNumber());
  let pools = poolsOf(user);
  if (slots.some((t) => !pools[t])) {
    try {
      await fill(telegramId, [...new Set(slots)]);
    } catch (err) {
      console.error("topic pools failed:", (err as Error).message);
    }
    const fresh = await userFor(telegramId);
    if (fresh) pools = poolsOf(fresh);
  }
  const { version, target } = levelOf(user);
  const { have, addedToday } = await learnerWords(user.id, version, target);
  const taken = new Set<string>();
  // Covered is checked here too, not only when a pool is listed: pools listed before
  // the rule (or before a level change) still hold words like 火车.
  const open = (w: TopicWord) =>
    !taken.has(w.word) && !coveredByLevel(w.word, version, target) && (!have.has(w.word) || addedToday.has(w.word));
  const words: TopicDay["words"] = [];
  for (const slot of slots) {
    for (const topic of [slot, ...topics.filter((t) => t !== slot)]) {
      const w = pools[topic]?.find(open);
      if (!w) continue;
      taken.add(w.word);
      words.push({ ...w, added: addedToday.has(w.word), topic });
      break;
    }
  }
  const rest = new Set<string>();
  for (const t of topics) for (const w of pools[t] ?? []) if (open(w) && !addedToday.has(w.word)) rest.add(w.word);
  return { on, topics, words, left: rest.size };
}
