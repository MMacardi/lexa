import type { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

/** Lock the card before inserting: a learner edit/removal invalidates older work. */
export async function saveGeneratedExample(wordId: string, revision: number, data: Omit<Prisma.ExampleUncheckedCreateInput, "wordId">) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.word.updateMany({
      where: { id: wordId, exampleRevision: revision },
      data: { exampleRevision: { increment: 0 } },
    });
    if (!current.count) return null;
    return tx.example.create({ data: { ...data, wordId } });
  });
}

/** Delete just this example; all remaining rows and the review schedule stay intact. */
export async function removeExample(wordId: string, exampleId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.word.update({ where: { id: wordId }, data: { exampleRevision: { increment: 1 }, autoExamples: false, exampleStatus: "disabled" } });
    const removed = await tx.example.deleteMany({ where: { id: exampleId, wordId } });
    if (!removed.count) throw new Error("Example not found");
  });
}
