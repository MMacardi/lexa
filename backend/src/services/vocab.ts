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
}) {
  const user = await ensureUser(params.telegramId);
  const example = await runExampleSearch({ userId: user.id, word: params.word });
  await runTutor({ wordId: example.wordId, word: params.word });

  return prisma.word.findUniqueOrThrow({
    where: { id: example.wordId },
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

  return prisma.word.update({
    where: { id },
    data: { reviewCount: nextCount, nextReviewAt },
  });
}
