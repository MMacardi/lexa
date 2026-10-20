import { z } from "zod";
import { prisma } from "./db.js";
import type { UpgradeOptions } from "./capture.js";

export const queuedCardsSchema = z.array(z.object({
  id: z.string(),
  word: z.string(),
  undoAdd: z.boolean().optional(),
  upgrade: z.object({
    level: z.string().optional(),
    synonymLevel: z.string().optional(),
    exampleStyle: z.string().optional(),
    withExample: z.boolean().optional(),
    meaningInstruction: z.string().optional(),
    sense: z.string().optional(),
  }).optional(),
}));

/** Queue the existing card, preserving the original sense and example choice on retry. */
export async function queueCardUpgrade(wordId: string, options?: UpgradeOptions) {
  return prisma.$transaction(async (tx) => {
    const card = await tx.word.findUniqueOrThrow({ where: { id: wordId } });
    if (["queued", "generating"].includes(card.enrichmentStatus)) return null;
    let upgrade = options;
    if (!upgrade) {
      const previous = await tx.importJob.findFirst({
        where: { userId: card.userId, cards: { array_contains: [{ id: card.id }] } },
        orderBy: { createdAt: "desc" },
        select: { cards: true, generateExamples: true, level: true, exampleStyle: true },
      });
      const cards = queuedCardsSchema.safeParse(previous?.cards);
      upgrade = (cards.success ? cards.data.find((c) => c.id === card.id)?.upgrade : undefined) ?? {
        withExample: previous ? previous.generateExamples : true,
        level: previous?.level ?? undefined,
        exampleStyle: previous?.exampleStyle ?? undefined,
      };
    }
    const withExample = upgrade.withExample !== false && upgrade.exampleStyle !== "none";
    // Compare-and-set makes simultaneous retries create just one job.
    const claimed = await tx.word.updateMany({
      where: { id: card.id, enrichmentStatus: { notIn: ["queued", "generating"] } },
      data: { enrichmentStatus: "queued", exampleStatus: withExample || card.exampleStatus !== "disabled" ? "queued" : "disabled" },
    });
    if (!claimed.count) return null;
    return tx.importJob.create({
      data: {
        userId: card.userId, total: 1, generateDetails: true, generateExamples: withExample,
        level: upgrade.level, exampleStyle: upgrade.exampleStyle,
        cards: [{ id: card.id, word: card.word, upgrade, undoAdd: options !== undefined }], errors: [],
      },
      select: { id: true, status: true, total: true, processed: true },
    });
  });
}
