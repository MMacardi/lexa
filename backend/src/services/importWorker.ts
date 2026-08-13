import { z } from "zod";
import { runExampleSearch } from "../agents/exampleSearch.js";
import { runTutor } from "../agents/tutor.js";
import { translateText } from "./translate.js";
import { prisma } from "./db.js";

const queuedCardsSchema = z.array(z.object({ id: z.string(), word: z.string() }));
const LEASE_MS = 5 * 60_000;
const POLL_MS = 2_000;
let working = false;

function nextLease() {
  return new Date(Date.now() + LEASE_MS);
}

/** Start one durable worker for this API instance. It is safe to call once. */
export function startImportWorker() {
  const tick = async () => {
    if (working) return;
    working = true;
    try {
      await processOneImportJob();
    } catch (error) {
      // Keep the server alive if a malformed legacy job appears in the queue.
      console.error("Import worker error", error);
    } finally {
      working = false;
    }
  };

  void tick();
  setInterval(() => void tick(), POLL_MS).unref();
}

/** Claim one queued (or abandoned) job, process its cards sequentially, and persist progress. */
async function processOneImportJob() {
  const now = new Date();
  const candidate = await prisma.importJob.findFirst({
    where: {
      OR: [
        { status: "queued" },
        { status: "processing", leaseUntil: { lt: now } },
      ],
    },
    orderBy: { createdAt: "asc" },
  });
  if (!candidate) return;

  // Conditional update is our lightweight DB lock: two Railway instances
  // cannot both claim the same queued/expired job.
  const claim = await prisma.importJob.updateMany({
    where: {
      id: candidate.id,
      OR: [
        { status: "queued" },
        { status: "processing", leaseUntil: { lt: now } },
      ],
    },
    data: { status: "processing", startedAt: now, leaseUntil: nextLease(), errorMessage: null },
  });
  if (claim.count !== 1) return;

  const job = await prisma.importJob.findUniqueOrThrow({ where: { id: candidate.id } });
  let cards: { id: string; word: string }[];
  try {
    cards = queuedCardsSchema.parse(job.cards);
  } catch {
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: "The queued card data is invalid.", completedAt: new Date(), leaseUntil: null },
    });
    return;
  }

  const errors = [...job.errors];
  try {
    for (let index = job.processed; index < cards.length; index++) {
      const card = cards[index];
      const word = await prisma.word.findUnique({
        where: { id: card.id },
        select: { id: true, word: true, userId: true, sourceLang: true, targetLang: true, meaningZh: true },
      });

      if (!word || word.userId !== job.userId) {
        errors.push(`${card.word}: card no longer exists`);
      } else {
        try {
          if (job.generateDetails) {
            await runTutor({
              wordId: word.id,
              word: word.word,
              sourceLang: word.sourceLang,
              targetLang: word.targetLang,
              // Keep a meaning the user reviewed (list import); generate one when
              // the card has none yet (Reader adds a bare word with no meaning).
              preserveMeaning: Boolean(word.meaningZh?.trim()),
            });
          }
          if (job.generateExamples) {
            await runExampleSearch({
              userId: job.userId,
              word: word.word,
              wordId: word.id, // enrich the existing imported card, don't duplicate it
              sourceLang: word.sourceLang,
              targetLang: word.targetLang,
              level: job.level ?? undefined,
              exampleStyle: job.exampleStyle ?? undefined,
              exampleSource: job.exampleSource ?? undefined,
            });
          } else {
            // A provided example (e.g. from the Reader) may have no translation yet —
            // fill it in so the card's back shows both lines.
            const ex = await prisma.example.findFirst({
              where: { wordId: word.id },
              orderBy: { createdAt: "desc" },
              select: { id: true, sentenceEn: true, sentenceZh: true },
            });
            if (ex?.sentenceEn && !ex.sentenceZh.trim()) {
              const { translation } = await translateText({
                text: ex.sentenceEn,
                sourceLang: word.sourceLang,
                targetLang: word.targetLang,
              });
              await prisma.example.update({ where: { id: ex.id }, data: { sentenceZh: translation } });
            }
          }
        } catch (error) {
          console.error(`Import enrichment failed for ${card.word}`, error);
          errors.push(card.word);
        }
      }

      // Persist after every card, and renew the lease. A restart resumes at
      // this exact index instead of repeating the entire import.
      await prisma.importJob.update({
        where: { id: job.id },
        data: { processed: index + 1, errors, leaseUntil: nextLease() },
      });
    }

    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "completed", completedAt: new Date(), leaseUntil: null },
    });
  } catch (error) {
    await prisma.importJob.update({
      where: { id: job.id },
      data: { status: "failed", errorMessage: (error as Error).message, completedAt: new Date(), leaseUntil: null },
    });
  }
}

export async function getImportJobForUser(jobId: string, telegramId: string) {
  const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  if (!user) return null;
  return prisma.importJob.findFirst({
    where: { id: jobId, userId: user.id },
    select: {
      id: true,
      status: true,
      total: true,
      processed: true,
      errors: true,
      errorMessage: true,
      createdAt: true,
      completedAt: true,
    },
  });
}
