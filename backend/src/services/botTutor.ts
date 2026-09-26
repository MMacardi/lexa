import { prisma } from "./db.js";
import { cedictHas, isChinese } from "./cedict.js";

// Server-side helpers for the Telegram tutor bot. The bot has no browser
// localStorage, so the learner's language pair lives on the User row (resolved
// lazily). Review/tutor logic itself is reused from vocab.ts / tutorChat.ts.

export interface Pair {
  source: string;
  target: string;
  /** The learner's CEFR level for `source`, when they have set one (F2 moved it
   * onto the User, so the bot can finally tune generation the way the web does). */
  level?: string;
}

/**
 * Resolve a Telegram sender to the account behind them, remembering their chat
 * id for proactive messages. Returns the **canonical** `User.telegramId` — the
 * key every other service here takes.
 *
 * That key is not always the numeric Telegram id. Someone who signed in with
 * Google first has `telegramId = "email:…"`, so keying the bot on `ctx.from.id`
 * handed them a second, empty account and their deck vanished the moment they
 * opened the chat. The linked AuthIdentity is the source of truth; the numeric
 * id is only the fallback for a learner who arrived through Telegram.
 */
export async function ensureBotUser(
  telegramId: string,
  chatId: string,
  profile?: { firstName?: string | null; username?: string | null },
): Promise<string> {
  const linked = await prisma.authIdentity.findUnique({
    where: { provider_subject: { provider: "telegram", subject: telegramId } },
    select: { user: { select: { id: true, telegramId: true, botChatId: true } } },
  });
  if (linked) {
    // Runs on every update, so only write when the chat id actually changed.
    if (linked.user.botChatId !== chatId) {
      await prisma.user.update({ where: { id: linked.user.id }, data: { botChatId: chatId } });
    }
    return linked.user.telegramId;
  }
  const user = await prisma.user.upsert({
    where: { telegramId },
    create: {
      telegramId,
      botChatId: chatId,
      authVia: "telegram",
      firstName: profile?.firstName ?? null,
      username: profile?.username ?? null,
    },
    update: { botChatId: chatId },
    select: { id: true },
  });
  // Keep a matching identity so this Telegram account is linkable/listed — and
  // so the lookup above finds it on the next update.
  await prisma.authIdentity.upsert({
    where: { provider_subject: { provider: "telegram", subject: telegramId } },
    create: { userId: user.id, provider: "telegram", subject: telegramId },
    update: {},
  });
  return telegramId;
}

/**
 * The learner's active language pair: their explicit preference, else inferred
 * from their most recent card, else the app default (en → zh).
 */
export async function resolveUserPair(telegramId: string): Promise<Pair> {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { preferredSource: true, preferredTarget: true, levels: true },
  });
  const withLevel = (source: string, target: string): Pair => ({ source, target, level: levelFor(user?.levels, source) });

  if (user?.preferredSource && user?.preferredTarget) {
    return withLevel(user.preferredSource, user.preferredTarget);
  }
  const recent = await prisma.word.findFirst({
    where: { user: { telegramId } },
    orderBy: { createdAt: "desc" },
    select: { sourceLang: true, targetLang: true },
  });
  if (recent) return withLevel(recent.sourceLang, recent.targetLang);
  return withLevel("en", "zh");
}

/** `User.levels` is a `{ [lang]: "A1".."C2" }` JSON blob; read one language out of it. */
function levelFor(levels: unknown, source: string): string | undefined {
  if (!levels || typeof levels !== "object") return undefined;
  const hit = (levels as Record<string, unknown>)[source];
  return typeof hit === "string" ? hit : undefined;
}

export async function setUserPair(telegramId: string, source: string, target: string): Promise<void> {
  await prisma.user.update({ where: { telegramId }, data: { preferredSource: source, preferredTarget: target } });
}

/** Distinct language pairs the learner actually has cards in (for a button picker). */
export async function distinctPairsForUser(telegramId: string): Promise<Pair[]> {
  const rows = await prisma.word.findMany({
    where: { user: { telegramId } },
    select: { sourceLang: true, targetLang: true },
    distinct: ["sourceLang", "targetLang"],
    take: 12,
  });
  return rows.map((r) => ({ source: r.sourceLang, target: r.targetLang }));
}

const dueWhere = (telegramId: string, pair: Pair, now: Date) => ({
  user: { telegramId },
  sourceLang: pair.source,
  targetLang: pair.target,
  OR: [{ nextReviewAt: null }, { nextReviewAt: { lte: now } }],
});

/** Cards due for review right now, oldest-due first (new cards first). */
export async function dueWordsForUser(telegramId: string, pair: Pair, limit = 20) {
  const now = new Date();
  return prisma.word.findMany({
    where: dueWhere(telegramId, pair, now),
    orderBy: [{ nextReviewAt: { sort: "asc", nulls: "first" } }],
    take: limit,
    include: { examples: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
}

export async function dueCountForUser(telegramId: string, pair: Pair): Promise<number> {
  const now = new Date();
  return prisma.word.count({ where: dueWhere(telegramId, pair, now) });
}

/** One card by id, scoped to the owner (defence-in-depth for callback ids). */
export async function ownedWord(telegramId: string, wordId: string) {
  return prisma.word.findFirst({
    where: { id: wordId, user: { telegramId } },
    include: { examples: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
}

/** How many of the learner's cards are "weak" (keep getting forgotten). */
export async function weakCountForUser(telegramId: string, pair: Pair): Promise<number> {
  return prisma.word.count({
    where: { user: { telegramId }, sourceLang: pair.source, targetLang: pair.target, lapses: { gte: 2 } },
  });
}

/**
 * Words to run a Coach practice drill over: weak spots first, then due, then any —
 * from the learner's active pair. Returns the id (for SRS grading) + word + meaning.
 */
export async function drillWordsForUser(
  telegramId: string,
  pair: Pair,
  limit = 6,
): Promise<{ id: string; word: string; meaning: string }[]> {
  const words = await prisma.word.findMany({
    where: { user: { telegramId }, sourceLang: pair.source, targetLang: pair.target },
    select: { id: true, word: true, meaningZh: true, lapses: true, nextReviewAt: true },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const now = Date.now();
  const weak = words.filter((w) => (w.lapses ?? 0) >= 2);
  const due = words.filter((w) => !w.nextReviewAt || new Date(w.nextReviewAt).getTime() <= now);
  const ordered = [...new Map([...weak, ...due, ...words].map((w) => [w.id, w])).values()];
  return ordered.slice(0, limit).map((w) => ({ id: w.id, word: w.word, meaning: w.meaningZh ?? "" }));
}

// ---- Capture: a photographed page turned into cards you don't have yet ----

const HANZI = /^\p{Script=Han}+$/u;
// CC-CEDICT headwords run longer, but past four characters they are idioms and
// names — not what a textbook page is teaching this week.
const MAX_HANZI_WORD = 4;

/**
 * Greedy longest-match segmentation of Chinese against CC-CEDICT.
 *
 * Single characters are dropped on purpose: alone on a scanned page they are
 * mostly particles (的, 了, 是), and a one-character card with no context is the
 * weakest card there is. `add 好` still works when the learner wants one.
 *
 * Greedy costs the odd boundary — 说明天 comes out as 说明, not 说 + 明天 — but
 * every candidate is a real dictionary word the learner chooses to tap or not,
 * so a wrong split loses a suggestion, never data.
 */
function segmentHanzi(text: string): string[] {
  const chars = Array.from(text);
  const out: string[] = [];
  let i = 0;
  while (i < chars.length) {
    if (!HANZI.test(chars[i])) {
      i++;
      continue;
    }
    let taken = 0;
    for (let n = Math.min(MAX_HANZI_WORD, chars.length - i); n >= 2; n--) {
      const candidate = chars.slice(i, i + n).join("");
      if (HANZI.test(candidate) && cedictHas(candidate)) {
        out.push(candidate);
        taken = n;
        break;
      }
    }
    i += taken || 1;
  }
  return out;
}

/**
 * Words worth capturing out of scanned text: in the order the page teaches them,
 * minus the ones already in the deck. Chinese only — the other languages have no
 * dictionary loaded here, so the bot shows them the text and lets them pick.
 */
export async function captureCandidates(telegramId: string, pair: Pair, text: string, limit = 12): Promise<string[]> {
  if (!isChinese(pair.source)) return [];
  const tokens = segmentHanzi(text);
  if (tokens.length === 0) return [];
  const owned = await prisma.word.findMany({
    where: { user: { telegramId }, sourceLang: pair.source },
    select: { word: true },
  });
  const have = new Set(owned.map((w) => w.word.trim()));
  const out: string[] = [];
  for (const token of tokens) {
    if (have.has(token)) continue;
    have.add(token); // also de-duplicates repeats within the page
    out.push(token);
    if (out.length >= limit) break;
  }
  return out;
}

/** The learner's chosen reminder hour (0–23), or null if reminders are off. */
export async function getReminderHour(telegramId: string): Promise<number | null> {
  const u = await prisma.user.findUnique({ where: { telegramId }, select: { reminderHour: true } });
  return u?.reminderHour ?? null;
}

export async function setReminderHour(telegramId: string, hour: number | null): Promise<void> {
  await prisma.user.update({ where: { telegramId }, data: { reminderHour: hour } });
}

/** Which weekdays the nudge fires on (CSV of getDay() ints); "" = every day. */
export async function getReminderDays(telegramId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { telegramId }, select: { reminderDays: true } });
  return u?.reminderDays ?? "";
}

export async function setReminderDays(telegramId: string, days: string): Promise<void> {
  await prisma.user.update({ where: { telegramId }, data: { reminderDays: days } });
}

/**
 * Users who asked to be reminded at this hour, have a chat id, and have cards
 * due — for the per-user daily reminder sweep.
 */
export async function usersToRemindAt(hour: number): Promise<{ telegramId: string; botChatId: string; reminderDays: string }[]> {
  const now = new Date();
  const rows = await prisma.user.findMany({
    where: {
      reminderHour: hour,
      botChatId: { not: null },
      deleteAfter: null, // an account waiting to be erased gets no nudges
      words: { some: { OR: [{ nextReviewAt: null }, { nextReviewAt: { lte: now } }] } },
    },
    select: { telegramId: true, botChatId: true, reminderDays: true },
  });
  return rows.filter((r): r is { telegramId: string; botChatId: string; reminderDays: string } => Boolean(r.botChatId));
}
