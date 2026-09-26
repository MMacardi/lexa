import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";
import { suggestTopicWords, type TopicCandidate } from "../agents/topicWords.js";
import { asHskVersion, dayStart, hskLevelWords, hskTagFor, normalizeHanzi, HSK_MAX_LEVEL, type HskVersion } from "./hsk.js";

// Topic words beside the exam words (BACKLOG item of that name). A learner names a
// field ("AI"); the model lists its everyday terms once; Today's words then take
// TOPIC_DAILY of them a day, next to the HSK ones. The pool is kept on the account
// (User.topicPool), so a day costs no model call — only naming a topic, or asking
// for more once the pool runs dry, does.

export const TOPIC_DAILY = 3;
const POOL_MAX = 40;

export type TopicWord = {
  word: string;
  pinyin: string;
  meaning: string;
  fromText: boolean; // occurs in the text the learner gave
  known: number; // share of its characters the learner already has (0–1)
  hsk: number | null; // its level on the learner's list, if it is on one at all
};

/**
 * The pool in the order it should be met. Words from the learner's own text first
 * (most frequent there first): that is the material they are actually reading.
 * Then words made only of characters they know (数据 = 数 + 据 for an HSK 4 — cheap
 * to learn, which is what "usable at my level" means in Chinese), then mostly
 * known, then the rest; the model's frequency order breaks ties. Words already on
 * the learner's list at or below their target are dropped: the exam track brings
 * those, and offering them twice a day would be noise.
 */
export function rankTopicWords(
  candidates: TopicCandidate[],
  opts: {
    have: Set<string>; // cards + "I know it" answers
    knownChars: Set<string>;
    text?: string;
    hskLevelOf: (word: string) => number | null;
    target: number;
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
    if (opts.have.has(word)) return;
    const hsk = opts.hskLevelOf(word);
    if (hsk != null && hsk <= opts.target) return;
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
    prisma.placementAnswer.findMany({ where: { userId, sourceLang: "zh", known: true }, select: { word: true } }),
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

/**
 * Name a topic (or ask for more words on the current one): one model call, the
 * pool ranked and saved. `text` is real material the learner pasted; only which
 * of its words occur and how often is kept, never the text itself.
 */
export async function setTopic(telegramId: string, topic: string, text?: string): Promise<TopicWord[]> {
  const user = await userFor(telegramId);
  if (!user) throw new Error("No such learner");
  const version = asHskVersion(user.hskVersion) ?? "3.0";
  const target = Math.min(Math.max(user.hskTarget ?? 4, 1), HSK_MAX_LEVEL[version]);
  const { have, knownChars } = await learnerWords(user.id, version, target);
  const candidates = await suggestTopicWords({ topic, level: target, targetLang: user.nativeLang ?? "ru", text });
  const ranked = rankTopicWords(candidates, {
    have,
    knownChars,
    text,
    hskLevelOf: (w) => hskTagFor(w)?.[version] ?? null,
    target,
  });
  // The reading comes from pinyin-pro, not the model: it knows the field's
  // compounds (算法 suàn fǎ, 参数 cān shù) and doesn't invent tones.
  const { pinyin } = await import("pinyin-pro");
  const pool = ranked.map((w) => ({ ...w, pinyin: pinyin(w.word, { toneType: "symbol", type: "string" }) }));
  await prisma.user.update({ where: { id: user.id }, data: { topic, topicPool: pool } });
  return pool;
}

export async function clearTopic(telegramId: string): Promise<void> {
  await prisma.user.update({ where: { telegramId }, data: { topic: null, topicPool: Prisma.DbNull } });
}

/**
 * Today's topic words: the first TOPIC_DAILY of the pool the learner has neither
 * a card for nor said they know — except words added today, which stay in the
 * offer (marked added), so the card reads "done" until tomorrow instead of
 * refilling the moment they're taken. `left` counts what the pool still holds
 * beyond today's; near zero, the card offers more.
 */
export async function topicDaily(
  telegramId: string,
): Promise<{ topic: string | null; words: (TopicWord & { added: boolean })[]; left: number }> {
  const user = await userFor(telegramId);
  if (!user?.topic) return { topic: null, words: [], left: 0 };
  const version = asHskVersion(user.hskVersion) ?? "3.0";
  const target = Math.min(Math.max(user.hskTarget ?? 4, 1), HSK_MAX_LEVEL[version]);
  const { have, addedToday } = await learnerWords(user.id, version, target);
  const pool = Array.isArray(user.topicPool) ? (user.topicPool as TopicWord[]) : [];
  const words: (TopicWord & { added: boolean })[] = [];
  let left = 0;
  for (const w of pool) {
    const added = addedToday.has(w.word);
    if (have.has(w.word) && !added) continue;
    if (words.length < TOPIC_DAILY) words.push({ ...w, added });
    else if (!added) left++;
  }
  return { topic: user.topic, words, left };
}
