import { prisma } from "./db.js";
import { runExampleSearch } from "../agents/exampleSearch.js";
import { runTutor } from "../agents/tutor.js";

// Spaced-repetition intervals (days) indexed by how many times a word has been
// reviewed. A simple Leitner-style ladder — plenty for this project.
const REVIEW_INTERVALS_DAYS = [1, 3, 7, 14, 30, 60];

/** Find or create the user that owns this telegramId. */
async function ensureUser(telegramId: string) {
  return prisma.user.upsert({
    where: { telegramId },
    create: { telegramId },
    update: {},
  });
}

/**
 * Add a word for a user: run the Example Search Agent, then the Tutor Agent,
 * and return the fully populated word. Shared by the bot and the REST API.
 */
export async function addWordForUser(params: {
  telegramId: string;
  word: string;
  sourceLang?: string;
  targetLang?: string;
}) {
  const user = await ensureUser(params.telegramId);
  const example = await runExampleSearch({
    userId: user.id,
    word: params.word,
    sourceLang: params.sourceLang,
    targetLang: params.targetLang,
  });
  await runTutor({
    wordId: example.wordId,
    word: params.word,
    sourceLang: params.sourceLang,
    targetLang: params.targetLang,
  });

  return prisma.word.findUniqueOrThrow({
    where: { id: example.wordId },
    include: { examples: { orderBy: { createdAt: "desc" } } },
  });
}

/**
 * Add a word manually (no agents): the user provides the meaning, example and
 * source themselves. Useful when you don't want to spend an LLM call or want to
 * curate the entry by hand.
 */
export async function addWordManual(params: {
  telegramId: string;
  word: string;
  sourceLang?: string;
  targetLang?: string;
  phonetic?: string;
  partOfSpeech?: string;
  meaningZh?: string;
  collocations?: string[];
  synonyms?: string[];
  antonyms?: string[];
  example?: {
    sentenceEn: string;
    sentenceZh?: string;
    sourceName?: string;
    sourceUrl?: string;
  };
}) {
  const user = await ensureUser(params.telegramId);
  const word = params.word.trim().toLowerCase();

  const data = {
    sourceLang: params.sourceLang ?? "en",
    targetLang: params.targetLang ?? "zh",
    phonetic: params.phonetic ?? null,
    partOfSpeech: params.partOfSpeech ?? null,
    meaningZh: params.meaningZh ?? null,
    collocations: params.collocations ?? [],
    synonyms: params.synonyms ?? [],
    antonyms: params.antonyms ?? [],
  };

  const wordRecord = await prisma.word.upsert({
    where: { userId_word: { userId: user.id, word } },
    create: { userId: user.id, word, ...data },
    update: data,
  });

  if (params.example?.sentenceEn?.trim()) {
    await prisma.example.create({
      data: {
        wordId: wordRecord.id,
        sentenceEn: params.example.sentenceEn.trim(),
        sentenceZh: params.example.sentenceZh?.trim() ?? "",
        sourceName: params.example.sourceName?.trim() || "Manual entry",
        sourceUrl: params.example.sourceUrl?.trim() ?? "",
      },
    });
  }

  return prisma.word.findUniqueOrThrow({
    where: { id: wordRecord.id },
    include: { examples: { orderBy: { createdAt: "desc" } } },
  });
}

/** All of a user's saved words, newest first, each with its examples. */
export async function listWordsForUser(telegramId: string) {
  const user = await prisma.user.findUnique({ where: { telegramId } });
  if (!user) return [];
  return prisma.word.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    include: { examples: { orderBy: { createdAt: "desc" } } },
  });
}

/** A single word by id, with its examples. */
export async function getWord(id: string) {
  return prisma.word.findUnique({
    where: { id },
    include: { examples: { orderBy: { createdAt: "desc" } } },
  });
}

/** Delete a word (its examples cascade via the schema's onDelete: Cascade). */
export async function deleteWord(id: string) {
  return prisma.word.delete({ where: { id } });
}

/** Edit a word's fields (and optionally its first example). */
export async function updateWord(
  id: string,
  fields: {
    word?: string;
    phonetic?: string | null;
    partOfSpeech?: string | null;
    meaningZh?: string | null;
    collocations?: string[];
    synonyms?: string[];
    antonyms?: string[];
    sourceLang?: string;
    targetLang?: string;
    example?: {
      sentenceEn?: string;
      sentenceZh?: string;
      sourceName?: string;
      sourceUrl?: string;
    };
  },
) {
  const data: Record<string, unknown> = {};
  if (fields.word !== undefined) data.word = fields.word.trim().toLowerCase();
  for (const k of [
    "phonetic",
    "partOfSpeech",
    "meaningZh",
    "collocations",
    "synonyms",
    "antonyms",
    "sourceLang",
    "targetLang",
  ] as const) {
    if (fields[k] !== undefined) data[k] = fields[k];
  }
  await prisma.word.update({ where: { id }, data });

  if (fields.example) {
    const ex = fields.example;
    const first = await prisma.example.findFirst({
      where: { wordId: id },
      orderBy: { createdAt: "asc" },
    });
    if (first) {
      await prisma.example.update({
        where: { id: first.id },
        data: {
          ...(ex.sentenceEn !== undefined ? { sentenceEn: ex.sentenceEn } : {}),
          ...(ex.sentenceZh !== undefined ? { sentenceZh: ex.sentenceZh } : {}),
          ...(ex.sourceName !== undefined ? { sourceName: ex.sourceName } : {}),
          ...(ex.sourceUrl !== undefined ? { sourceUrl: ex.sourceUrl } : {}),
        },
      });
    } else if (ex.sentenceEn?.trim()) {
      await prisma.example.create({
        data: {
          wordId: id,
          sentenceEn: ex.sentenceEn.trim(),
          sentenceZh: ex.sentenceZh ?? "",
          sourceName: ex.sourceName || "Manual entry",
          sourceUrl: ex.sourceUrl ?? "",
        },
      });
    }
  }

  return prisma.word.findUniqueOrThrow({
    where: { id },
    include: { examples: { orderBy: { createdAt: "desc" } } },
  });
}

/**
 * Record a review: bump reviewCount and schedule the next review date using the
 * interval ladder above.
 */
export async function recordReview(id: string) {
  const word = await prisma.word.findUnique({ where: { id } });
  if (!word) return null;

  const nextCount = word.reviewCount + 1;
  const idx = Math.min(word.reviewCount, REVIEW_INTERVALS_DAYS.length - 1);
  const days = REVIEW_INTERVALS_DAYS[idx];
  const nextReviewAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  // Log the training event (powers the learning-progress stats).
  await prisma.reviewEvent.create({ data: { userId: word.userId } });

  return prisma.word.update({
    where: { id },
    data: { reviewCount: nextCount, nextReviewAt },
  });
}

/** Aggregated learning stats for the dashboard. */
export async function getStats(telegramId: string) {
  const user = await prisma.user.findUnique({ where: { telegramId } });
  const empty = {
    total: 0,
    mastered: 0,
    learning: 0,
    due: 0,
    trainedToday: 0,
    streak: 0,
    days: [] as { date: string; added: number; reviews: number }[],
  };
  if (!user) return empty;

  const now = Date.now();
  const words = await prisma.word.findMany({
    where: { userId: user.id },
    select: { reviewCount: true, nextReviewAt: true, createdAt: true },
  });
  const since = new Date(now - 13 * 86400_000);
  since.setHours(0, 0, 0, 0);
  const events = await prisma.reviewEvent.findMany({
    where: { userId: user.id, createdAt: { gte: since } },
    select: { createdAt: true },
  });

  const total = words.length;
  const mastered = words.filter((w) => w.reviewCount >= 5).length;
  const due = words.filter((w) => !w.nextReviewAt || w.nextReviewAt.getTime() <= now).length;

  const key = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.toISOString().slice(0, 10);
  };
  const addedMap = new Map<string, number>();
  for (const w of words) addedMap.set(key(w.createdAt), (addedMap.get(key(w.createdAt)) ?? 0) + 1);
  const reviewMap = new Map<string, number>();
  for (const e of events) reviewMap.set(key(e.createdAt), (reviewMap.get(key(e.createdAt)) ?? 0) + 1);

  const days: { date: string; added: number; reviews: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 86400_000);
    d.setHours(0, 0, 0, 0);
    const k = d.toISOString().slice(0, 10);
    days.push({ date: k, added: addedMap.get(k) ?? 0, reviews: reviewMap.get(k) ?? 0 });
  }

  const todayKey = key(new Date(now));
  const trainedToday = reviewMap.get(todayKey) ?? 0;

  // streak: consecutive days (ending today or yesterday) with >=1 review
  let streak = 0;
  for (let i = 0; i < days.length; i++) {
    const day = days[days.length - 1 - i];
    if (day.reviews > 0) streak++;
    else if (i === 0) continue; // allow today to be empty without breaking
    else break;
  }

  return { total, mastered, learning: total - mastered, due, trainedToday, streak, days };
}
