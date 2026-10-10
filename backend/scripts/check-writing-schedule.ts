// Proves the writing drill's grades land on the writing schedule only.
//
// The failure this guards is silent: if a writing grade touched the reading
// fields, an HSK reader who can't yet write 接口 would see it reset in review
// with nothing on screen to say why. Also: the grade is logged as source
// "write" (so the day counts), and Undo — for review grades — passes over it to
// the review before it instead of "restoring" reading fields from a writing row.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-writing-schedule.ts
import { prisma } from "../src/services/db.js";
import { recordReview, recordWriting, undoLastReview } from "../src/services/vocab.js";

const TG = `test-write-${Date.now()}`;
let failed = false;
function expect(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  failed ||= !ok;
}

async function main() {
  const user = await prisma.user.create({ data: { telegramId: TG, firstName: "Write" } });
  try {
    const word = await prisma.word.create({
      data: { userId: user.id, word: "接口", sourceLang: "zh", targetLang: "ru", meaningZh: "интерфейс" },
    });

    // A reading review first, so there's a reading schedule to protect.
    const read = (await recordReview(word.id, 3))!;
    const reading = { stability: read.stability, due: read.due?.getTime(), reps: read.reps, state: read.state, next: read.nextReviewAt?.getTime() };

    const w1 = (await recordWriting(word.id, 1))!;
    expect(w1.writeStability != null && w1.writeDue != null && w1.writeReps === 1, "an Again starts the writing schedule");
    expect(w1.writeLapses === 0 && w1.writeState === 1, "a first Again is a learning card, not a lapse");
    const w2 = (await recordWriting(word.id, 3))!;
    expect(w2.writeReps === 2 && w2.writeDue!.getTime() > w1.writeDue!.getTime(), "a Good pushes the writing due date out");
    expect(
      w2.stability === reading.stability &&
        w2.due?.getTime() === reading.due &&
        w2.reps === reading.reps &&
        w2.state === reading.state &&
        w2.nextReviewAt?.getTime() === reading.next &&
        w2.reviewCount === read.reviewCount,
      "the reading schedule is untouched by writing grades",
    );

    const events = await prisma.reviewEvent.findMany({ where: { wordId: word.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.source).join(",") === "review,write,write", "writing grades are logged as source write");
    expect(events.filter((e) => e.source === "write").every((e) => e.prev === null), "writing rows carry no reading prev");

    // Undo skips the writing rows and takes back the reading review.
    const undone = await undoLastReview(word.id);
    expect(undone != null && undone.stability == null && undone.reps === 0, "Undo reaches past writing rows to the review");
    expect(undone?.writeReps === 2, "Undo leaves the writing schedule alone");

    expect((await recordWriting("no-such-word", 3)) === null, "an unknown word is null, not a throw");
  } finally {
    await prisma.reviewEvent.deleteMany({ where: { userId: user.id } });
    await prisma.word.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
  if (failed) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
