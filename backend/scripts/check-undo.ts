// Proves "Undo" puts a card back exactly (BACKLOG "Undo the last grade in review").
//
// On a phone a mis-tap on Easy silently pushes a card out for weeks. Undo is only
// worth having if it is exact: the schedule byte-for-byte as it was and the log
// row gone, or the learner model keeps a grade that never really happened.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-undo.ts
import { prisma } from "../src/services/db.js";
import { recordCram, recordReview, undoLastReview } from "../src/services/vocab.js";
import { deleteAccount } from "../src/services/accountData.js";

const TG = `test-undo-${Date.now()}`;
const SCHEDULE = ["stability", "difficulty", "due", "reps", "lapses", "state", "learningSteps", "lastReview", "nextReviewAt", "reviewCount"] as const;

type Row = Awaited<ReturnType<typeof prisma.word.findUniqueOrThrow>>;
const diff = (a: Row, b: Row) =>
  SCHEDULE.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).map((k) => `${k}: ${JSON.stringify(a[k])} → ${JSON.stringify(b[k])}`);

async function main() {
  const user = await prisma.user.create({ data: { telegramId: TG, firstName: "Undo" } });
  const word = await prisma.word.create({
    data: { userId: user.id, word: "后悔", sourceLang: "zh", targetLang: "ru", meaningZh: "сожалеть" },
  });
  const fails: string[] = [];
  const log = () => prisma.reviewEvent.count({ where: { wordId: word.id } });

  // 1. A brand-new card graded by mistake goes back to brand new.
  const fresh = await prisma.word.findUniqueOrThrow({ where: { id: word.id } });
  await recordReview(word.id, 4);
  const undone1 = await undoLastReview(word.id);
  if (!undone1) fails.push("undo of a first grade returned null");
  const back1 = await prisma.word.findUniqueOrThrow({ where: { id: word.id } });
  fails.push(...diff(fresh, back1).map((d) => `fresh card: ${d}`));
  if ((await log()) !== 0) fails.push("fresh card: the review log row survived the undo");

  // 2. A card mid-schedule: Good, then a mis-tapped Easy, undo → exactly the Good state.
  await recordReview(word.id, 3);
  const afterGood = await prisma.word.findUniqueOrThrow({ where: { id: word.id } });
  await recordReview(word.id, 4);
  await undoLastReview(word.id);
  const back2 = await prisma.word.findUniqueOrThrow({ where: { id: word.id } });
  fails.push(...diff(afterGood, back2).map((d) => `mid-schedule: ${d}`));
  if ((await log()) !== 1) fails.push(`mid-schedule: log should hold 1 row (the Good), holds ${await log()}`);

  // 3. A cram answer since the grade doesn't block the undo, and survives it.
  await recordReview(word.id, 1);
  await recordCram(word.id, true);
  await undoLastReview(word.id);
  const back3 = await prisma.word.findUniqueOrThrow({ where: { id: word.id } });
  fails.push(...diff(afterGood, back3).map((d) => `past a cram row: ${d}`));
  if ((await prisma.reviewEvent.count({ where: { wordId: word.id, source: "cram" } })) !== 1) fails.push("the cram row was deleted by the undo");

  // 4. Too old to undo: a grade from an hour ago stays.
  await recordReview(word.id, 4);
  await prisma.reviewEvent.updateMany({ where: { wordId: word.id }, data: { createdAt: new Date(Date.now() - 3600_000) } });
  if (await undoLastReview(word.id)) fails.push("an hour-old grade was undone");

  await deleteAccount(TG);
  if (fails.length) {
    console.error("FAIL\n- " + fails.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log("PASS — undo restores a fresh card and a mid-schedule card exactly, skips cram rows, refuses an hour-old grade");
  }
}

main()
  .catch(async (e) => {
    console.error(e);
    await deleteAccount(TG).catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
