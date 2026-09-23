import { prisma } from "./db.js";

// The production half of the learner model: whether the learner can USE a word,
// not just recognise it on a card. It deliberately lives outside vocab.ts's FSRS
// code and never calls recordReview — a drill answer used to be folded into an
// FSRS "Good", which scheduled the card *and* destroyed the only evidence that
// the learner had produced the word. The two ledgers are now separate: reviews
// move the interval, productions move the "can use" count.

/** How a use-step answer went. The coach grades; scene/chat only witness a use. */
export const PRODUCTION_VERDICTS = ["correct", "partial", "wrong"] as const;
export type ProductionVerdict = (typeof PRODUCTION_VERDICTS)[number];

/** Venues where a word can be produced (review/quiz are recognition, not use). */
export const PRODUCTION_SOURCES = ["drill", "scene", "chat"] as const;
export type ProductionSource = (typeof PRODUCTION_SOURCES)[number];

// Venues where the answer was actually judged. Only these move the "can use"
// ladder: the casual chat awards points for merely deploying a word, so letting
// it mint the status would make the number farmable by typing the word twice.
// Chat attempts are still logged — they are evidence, just not a verdict.
const GRADING_SOURCES: readonly ProductionSource[] = ["drill", "scene"];

/** What the coach said was wrong; kept coarse so it stays countable per word. */
export const PRODUCTION_ERRORS = ["meaning", "form", "collocation", "register"] as const;
export type ProductionError = (typeof PRODUCTION_ERRORS)[number];

/** Narrow untrusted input; anything unknown is treated as the plainest value. */
export function asVerdict(v: unknown): ProductionVerdict | null {
  return (PRODUCTION_VERDICTS as readonly string[]).includes(v as string) ? (v as ProductionVerdict) : null;
}
export function asProductionSource(v: unknown): ProductionSource {
  return (PRODUCTION_SOURCES as readonly string[]).includes(v as string) ? (v as ProductionSource) : "drill";
}
export function asProductionError(v: unknown): ProductionError | null {
  return (PRODUCTION_ERRORS as readonly string[]).includes(v as string) ? (v as ProductionError) : null;
}

const dayKey = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.toISOString().slice(0, 10);
};

/**
 * Log one attempt to use a word and update its production state.
 *
 * "Can use" = two correct **judged** uses on different days. One day's worth of
 * correct answers is a good session, not a skill, and the ungraded chat must not
 * be able to mint the number the readiness mark is built on. A wrong answer
 * resets the streak and takes the status away again: the count is allowed to go
 * down, which is the only way it stays worth showing.
 */
export async function recordProduction(
  id: string,
  verdict: ProductionVerdict,
  source: ProductionSource = "drill",
  errorKind: ProductionError | null = null,
) {
  const word = await prisma.word.findUnique({
    where: { id },
    select: { id: true, userId: true, produceStreak: true, canUseAt: true },
  });
  if (!word) return null;

  const now = new Date();
  const judged = GRADING_SOURCES.includes(source);
  // A correct answer is only the second step of the ladder if the previous one
  // landed on an earlier day, so look up when that was before writing this row.
  // Only judged rows count as that first step, for the same reason they can't be
  // the second one.
  const previousCorrect =
    judged && verdict === "correct" && word.produceStreak > 0
      ? await prisma.productionEvent.findFirst({
          where: { wordId: id, verdict: "correct", source: { in: [...GRADING_SOURCES] } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        })
      : null;

  // No analytics event here: the coach services already track one use_step per
  // graded turn, and this table is itself the log that outlives them.
  await prisma.productionEvent.create({
    data: { userId: word.userId, wordId: word.id, verdict, source, errorKind },
  });

  // correct: advance. partial: attempted, but no progress and no loss.
  // wrong: back to the start, and the word is no longer one you can use.
  // An unjudged venue leaves both alone — it logged evidence, not a verdict.
  const streak = !judged
    ? word.produceStreak
    : verdict === "correct"
      ? word.produceStreak + 1
      : verdict === "wrong"
        ? 0
        : word.produceStreak;
  const spread = previousCorrect ? dayKey(previousCorrect.createdAt) !== dayKey(now) : false;
  const canUseAt = !judged
    ? word.canUseAt
    : verdict === "wrong"
      ? null
      : word.canUseAt ?? (streak >= 2 && spread ? now : null);

  return prisma.word.update({
    where: { id },
    data: {
      produceAttempts: { increment: 1 },
      ...(verdict === "correct" ? { produceCorrect: { increment: 1 } } : {}),
      produceStreak: streak,
      lastProducedAt: now,
      canUseAt,
    },
  });
}

/**
 * The learner's production summary: how many words they can use, how many of
 * those crossed over this week ("know → can use"), and how many have been tried
 * at all. `canUseWeek` reads canUseAt, so a word that fell back and crossed
 * again counts on the day it came back — the status is always the current one.
 */
export async function productionSummary(userId: string) {
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const [canUse, canUseWeek, tried] = await Promise.all([
    prisma.word.count({ where: { userId, canUseAt: { not: null } } }),
    prisma.word.count({ where: { userId, canUseAt: { gte: weekAgo } } }),
    prisma.word.count({ where: { userId, produceAttempts: { gt: 0 } } }),
  ]);
  return { canUse, canUseWeek, tried };
}

/** Days (YYYY-MM-DD) the learner produced something — activity the SRS misses. */
export async function productionDays(userId: string, since: Date): Promise<string[]> {
  const events = await prisma.productionEvent.findMany({
    where: { userId, createdAt: { gte: since } },
    select: { createdAt: true },
  });
  return events.map((e) => dayKey(e.createdAt));
}
