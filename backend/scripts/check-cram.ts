// Proves a cram answer leaves the schedule alone (BACKLOG "Cram a list now").
//
// The whole point of cram is drilling this week's lesson before a class quiz
// without the review schedule noticing: grade forty words "Good" the night before
// through the ordinary review path and FSRS pushes every one of them out a week.
// The only record should be the log row, tagged `cram`.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-cram.ts
import { prisma } from "../src/services/db.js";
import { recordCram, recordReview } from "../src/services/vocab.js";
import { deleteAccount } from "../src/services/accountData.js";

const TG = `test-cram-${Date.now()}`;
const SCHEDULE = ["stability", "difficulty", "due", "reps", "lapses", "state", "learningSteps", "lastReview", "nextReviewAt", "reviewCount"] as const;

async function main() {
  const user = await prisma.user.create({ data: { telegramId: TG, firstName: "Cram" } });
  const word = await prisma.word.create({
    data: { userId: user.id, word: "考试", sourceLang: "zh", targetLang: "ru", meaningZh: "экзамен" },
  });
  // A card with a real schedule, not a blank one: one ordinary review first.
  await recordReview(word.id, 3);
  const before = await prisma.word.findUniqueOrThrow({ where: { id: word.id } });

  const fails: string[] = [];
  if (!(await recordCram(word.id, true))) fails.push("recordCram(true) returned false for a word that exists");
  if (!(await recordCram(word.id, false))) fails.push("recordCram(false) returned false for a word that exists");
  if (await recordCram("no-such-word", true)) fails.push("recordCram returned true for a missing word");

  const after = await prisma.word.findUniqueOrThrow({ where: { id: word.id } });
  for (const k of SCHEDULE) {
    const a = JSON.stringify(before[k]);
    const b = JSON.stringify(after[k]);
    if (a !== b) fails.push(`${k} moved: ${a} → ${b}`);
  }

  const crams = await prisma.reviewEvent.findMany({ where: { wordId: word.id, source: "cram" }, orderBy: { createdAt: "asc" } });
  if (crams.map((e) => e.grade).join(",") !== "3,1") fails.push(`cram log should be grades 3,1, got ${crams.map((e) => e.grade).join(",") || "nothing"}`);
  if (crams.some((e) => e.userId !== user.id)) fails.push("cram row logged under the wrong user");

  await deleteAccount(TG);
  if (fails.length) {
    console.error("FAIL\n- " + fails.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log(`PASS — 2 cram answers logged, schedule unchanged (due ${after.due?.toISOString()})`);
  }
}

main()
  .catch(async (e) => {
    console.error(e);
    await deleteAccount(TG).catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
