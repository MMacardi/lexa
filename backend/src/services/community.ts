import { prisma } from "./db.js";
import { displayName } from "./friends.js";
import { LIBRARY_TELEGRAM_ID, LIBRARY_NAME } from "./librarySeed.js";

// Social layer: shared collections + the Community tab. Others can only READ a
// shared deck and copy words out of it; writing stays owner-only (the owner edits
// through the normal /collections routes). Copies are independent cards with
// their own FSRS state, credited to the source ("from @anya's HSK4").

export const VISIBILITIES = ["private", "friends", "code", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

const WEEK_MS = 7 * 86400_000;
const MAX_COPY = 500; // a deck bigger than this is copied in its first 500 words

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

type AuthorRow = { id: string; telegramId: string; firstName: string | null; lastName: string | null; displayName: string | null; username: string | null; hideTag: boolean };

function author(u: AuthorRow) {
  const official = u.telegramId === LIBRARY_TELEGRAM_ID;
  // `id` opens the author's profile page; the library has none.
  return { id: official ? null : u.id, name: official ? LIBRARY_NAME : displayName(u), official };
}

async function viewer(telegramId: string) {
  const u = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  if (!u) fail("no_account", "Account not found");
  return u.id;
}

export async function friendIds(userId: string): Promise<string[]> {
  const links = await prisma.friendship.findMany({
    where: { status: "accepted", OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  return links.map((l) => (l.requesterId === userId ? l.addresseeId : l.requesterId));
}

/** Short share code, same alphabet as referral codes (no O/0/I/1 confusion). */
export async function mintShareCode(): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[O0I1]/g, "X");
    const clash = await prisma.collection.findUnique({ where: { shareCode: code }, select: { id: true } });
    if (!clash) return code;
  }
  throw new Error("Could not generate a share code");
}

type DeckRow = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  visibility: string;
  shareCode: string | null;
  mikaPick: boolean;
  createdAt: Date;
};

/** Can this user read the deck? Owner always; otherwise by visibility (+ code). */
async function canView(deck: DeckRow, viewerId: string, code?: string): Promise<boolean> {
  if (deck.userId === viewerId) return true;
  if (deck.visibility === "public") return true;
  const codeOk = Boolean(code && deck.shareCode && code.trim().toUpperCase() === deck.shareCode);
  if (deck.visibility === "code") return codeOk;
  if (deck.visibility === "friends") return (await friendIds(viewerId)).includes(deck.userId);
  return false;
}

// Summaries: counts, the deck's (dominant) language pair, a few preview words and
// the real-use counters. One query per list, grouped in JS — fine at beta scale.
export const summarySelect = {
  id: true,
  userId: true,
  name: true,
  description: true,
  visibility: true,
  shareCode: true,
  mikaPick: true,
  createdAt: true,
  user: { select: { id: true, telegramId: true, firstName: true, lastName: true, displayName: true, username: true, hideTag: true } },
  words: { select: { word: true, sourceLang: true, targetLang: true }, orderBy: { createdAt: "asc" as const } },
  adds: { select: { lastAt: true } },
};

type SummaryRow = DeckRow & {
  user: AuthorRow;
  words: { word: string; sourceLang: string; targetLang: string }[];
  adds: { lastAt: Date }[];
};

export function summarize(c: SummaryRow, viewerId: string) {
  const pairs = new Map<string, number>();
  for (const w of c.words) {
    const k = `${w.sourceLang}>${w.targetLang}`;
    pairs.set(k, (pairs.get(k) ?? 0) + 1);
  }
  const top = [...pairs.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ">";
  const [sourceLang, targetLang] = top.split(">");
  const weekAgo = Date.now() - WEEK_MS;
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    sourceLang,
    targetLang,
    count: c.words.length,
    preview: c.words.slice(0, 6).map((w) => w.word),
    author: author(c.user),
    mikaPick: c.mikaPick,
    visibility: c.visibility as Visibility,
    mine: c.userId === viewerId,
    learners: c.adds.length,
    weekLearners: c.adds.filter((a) => a.lastAt.getTime() >= weekAgo).length,
  };
}

export type DeckSummary = ReturnType<typeof summarize>;

function byPopularity(a: DeckSummary, b: DeckSummary) {
  return b.weekLearners - a.weekLearners || b.learners - a.learners || a.name.localeCompare(b.name);
}

/**
 * Public decks for the Community tab, optionally filtered by studied language,
 * translation language and a free-text topic (matches name, description or a word).
 */
export async function listPublicDecks(
  telegramId: string,
  opts: { q?: string; lang?: string; target?: string },
) {
  const me = await viewer(telegramId);
  const q = opts.q?.trim();
  const rows = await prisma.collection.findMany({
    where: {
      visibility: "public",
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" as const } },
              { description: { contains: q, mode: "insensitive" as const } },
              { words: { some: { word: { contains: q, mode: "insensitive" as const } } } },
            ],
          }
        : {}),
    },
    select: summarySelect,
    take: 200,
  });
  return rows
    .map((r) => summarize(r, me))
    .filter((d) => d.count > 0)
    .filter((d) => !opts.lang || d.sourceLang === opts.lang)
    .filter((d) => !opts.target || d.targetLang === opts.target)
    .sort(byPopularity);
}

/** Decks my friends shared with friends (or publicly). */
export async function listFriendDecks(telegramId: string) {
  const me = await viewer(telegramId);
  const ids = await friendIds(me);
  if (!ids.length) return [];
  const rows = await prisma.collection.findMany({
    // A friend who hides their decks (privacy switch) drops out of this feed; their
    // public decks still appear in the public Community list.
    where: { userId: { in: ids }, visibility: { in: ["friends", "public"] }, user: { decksVisibility: { not: "hidden" } } },
    select: summarySelect,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return rows.map((r) => summarize(r, me)).filter((d) => d.count > 0);
}

/** Resolve a share code to a deck id (code-only and public decks). */
export async function findByCode(code: string) {
  const c = await prisma.collection.findUnique({
    where: { shareCode: code.trim().toUpperCase() },
    select: { id: true, visibility: true },
  });
  if (!c || (c.visibility !== "code" && c.visibility !== "public")) fail("no_deck", "No deck has that code");
  return { id: c.id };
}

const wordKey = (w: { word: string; sourceLang: string; targetLang: string }) =>
  `${w.word.trim().toLowerCase()}|${w.sourceLang}|${w.targetLang}`;

async function ownedKeys(userId: string) {
  const mine = await prisma.word.findMany({ where: { userId }, select: { id: true, word: true, sourceLang: true, targetLang: true } });
  const map = new Map<string, string>();
  for (const w of mine) if (!map.has(wordKey(w))) map.set(wordKey(w), w.id);
  return map;
}

/** Read-only view of a shared deck with each word marked "you already have it". */
export async function getDeck(telegramId: string, deckId: string, code?: string) {
  const me = await viewer(telegramId);
  const c = await prisma.collection.findUnique({
    where: { id: deckId },
    select: {
      ...summarySelect,
      words: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          word: true,
          sourceLang: true,
          targetLang: true,
          phonetic: true,
          partOfSpeech: true,
          meaningZh: true,
          synonyms: true,
          examples: { select: { sentenceEn: true, sentenceZh: true }, orderBy: { createdAt: "asc" }, take: 1 },
        },
      },
    },
  });
  if (!c || !(await canView(c, me, code))) fail("no_deck", "Deck not found");
  const owned = await ownedKeys(me);
  const copy = await prisma.collection.findFirst({ where: { userId: me, copiedFromId: c.id }, select: { id: true } });
  return {
    ...summarize(c, me),
    shareCode: c.userId === me ? c.shareCode : null,
    copiedCollectionId: copy?.id ?? null,
    words: c.words.map((w) => ({
      id: w.id,
      word: w.word,
      sourceLang: w.sourceLang,
      targetLang: w.targetLang,
      phonetic: w.phonetic,
      partOfSpeech: w.partOfSpeech,
      meaning: w.meaningZh,
      synonyms: w.synonyms,
      example: w.examples[0] ?? null,
      owned: owned.has(wordKey(w)),
    })),
  };
}

/**
 * Take words from a shared deck. Without `wordIds` the whole deck is taken: the
 * words I don't have yet are copied (with examples + synonyms) and a collection of
 * mine mirrors the deck, holding both the copies and my matching existing cards.
 * With `wordIds`, just those words are copied as loose cards. Both keep a credit.
 */
export async function copyFromDeck(
  telegramId: string,
  deckId: string,
  opts: { code?: string; wordIds?: string[] },
) {
  const me = await viewer(telegramId);
  const deck = await prisma.collection.findUnique({
    where: { id: deckId },
    select: { id: true, userId: true, name: true, description: true, visibility: true, shareCode: true, mikaPick: true, createdAt: true, user: { select: summarySelect.user.select } },
  });
  if (!deck || !(await canView(deck, me, opts.code))) fail("no_deck", "Deck not found");
  if (deck.userId === me) fail("own_deck", "This is your own deck");

  const source = await prisma.word.findMany({
    where: {
      collections: { some: { id: deck.id } },
      ...(opts.wordIds?.length ? { id: { in: opts.wordIds } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: MAX_COPY,
    include: { examples: { orderBy: { createdAt: "asc" } } },
  });

  const owned = await ownedKeys(me);
  const credit = { sharedFrom: author(deck.user).name, sharedDeck: deck.name, sharedDeckId: deck.id };
  const ids: string[] = [];
  let added = 0;
  for (const w of source) {
    const have = owned.get(wordKey(w));
    if (have) {
      ids.push(have);
      continue;
    }
    const created = await prisma.word.create({
      data: {
        userId: me,
        word: w.word,
        sourceLang: w.sourceLang,
        targetLang: w.targetLang,
        phonetic: w.phonetic,
        partOfSpeech: w.partOfSpeech,
        meaningZh: w.meaningZh,
        collocations: w.collocations,
        synonyms: w.synonyms,
        antonyms: w.antonyms,
        ...credit,
        examples: {
          create: w.examples.map((e) => ({
            sentenceEn: e.sentenceEn,
            sentenceZh: e.sentenceZh,
            sourceName: e.sourceName,
            sourceUrl: e.sourceUrl,
            register: e.register,
            level: e.level,
          })),
        },
      },
      select: { id: true },
    });
    owned.set(wordKey(w), created.id);
    ids.push(created.id);
    added++;
  }

  let collectionId: string | null = null;
  if (!opts.wordIds?.length) {
    const existing = await prisma.collection.findFirst({ where: { userId: me, copiedFromId: deck.id }, select: { id: true } });
    if (existing) {
      collectionId = existing.id;
    } else {
      const taken = new Set(
        (await prisma.collection.findMany({ where: { userId: me }, select: { name: true } })).map((c) => c.name),
      );
      let name = deck.name;
      for (let n = 2; taken.has(name); n++) name = `${deck.name} (${n})`;
      collectionId = (
        await prisma.collection.create({
          data: { userId: me, name, description: deck.description, copiedFromId: deck.id },
          select: { id: true },
        })
      ).id;
    }
    if (ids.length) {
      await prisma.collection.update({
        where: { id: collectionId },
        data: { words: { connect: ids.map((id) => ({ id })) } },
      });
    }
  }

  // Real-use counter: one row per learner per deck, bumped on every take.
  const now = new Date();
  await prisma.collectionAdd.upsert({
    where: { collectionId_userId: { collectionId: deck.id, userId: me } },
    create: { collectionId: deck.id, userId: me },
    update: { lastAt: now },
  });

  return { added, skipped: source.length - added, collectionId };
}

/** Credit for a collection I copied: the source deck's name + author (if it still exists). */
export async function copiedCredits(collectionIds: string[]) {
  if (!collectionIds.length) return new Map<string, { deck: string; author: string; official: boolean }>();
  const rows = await prisma.collection.findMany({
    where: { id: { in: collectionIds } },
    select: { id: true, name: true, user: { select: summarySelect.user.select } },
  });
  return new Map(rows.map((r) => [r.id, { deck: r.name, ...(({ name, official }) => ({ author: name, official }))(author(r.user)) }]));
}
