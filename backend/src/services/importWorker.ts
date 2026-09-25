import { z } from "zod";
import { runExampleSearch } from "../agents/exampleSearch.js";
import { runTutor } from "../agents/tutor.js";
import { enrichWordEntry } from "../agents/enrich.js";
import { translateText } from "./translate.js";
import { prisma } from "./db.js";
import { runAsUser } from "../lib/usageContext.js";
import { translateDictMeanings, upgradeCard } from "./capture.js";
import { isChinese } from "./cedict.js";

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
      await claimAndProcessImportJob();
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

/** Claim one queued (or abandoned) job and process it as its owner (for token attribution). */
async function claimAndProcessImportJob() {
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

  const job = await prisma.importJob.findUniqueOrThrow({
    where: { id: candidate.id },
    include: { user: { select: { telegramId: true } } },
  });
  await runAsUser(job.user.telegramId, () => processImportJob(job));
}

/** Process a claimed job's cards sequentially and persist progress. */
async function processImportJob(job: Awaited<ReturnType<typeof prisma.importJob.findUniqueOrThrow>>) {
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
  // The whole batch in the learner's language first, in one call, so no card
  // waits two minutes in the dictionary's English for its turn below. Best
  // effort: if it fails, each card's upgrade still writes its own meaning.
  if (job.processed === 0 && job.generateDetails && job.exampleSource !== "web") {
    await translateDictMeanings(cards.map((c) => c.id)).catch((error) => {
      console.error("Batch meanings failed", (error as Error).message);
    });
  }
  try {
    for (let index = job.processed; index < cards.length; index++) {
      // The learner can stop enrichment mid-way to save tokens: re-check before
      // each card and leave the rest as they are (they already exist as cards).
      const current = await prisma.importJob.findUnique({ where: { id: job.id }, select: { status: true } });
      if (current?.status === "cancelled") return;
      const card = cards[index];
      const word = await prisma.word.findUnique({
        where: { id: card.id },
        select: { id: true, word: true, userId: true, sourceLang: true, targetLang: true, meaningZh: true },
      });

      if (!word || word.userId !== job.userId) {
        errors.push(`${card.word}: card no longer exists`);
      } else {
        let failed = false;
        try {
          const wantAiExample = job.generateExamples && job.exampleSource !== "web";
          if (job.generateDetails && isChinese(word.sourceLang) && job.exampleSource !== "web") {
            // Chinese: the card already stands on the dictionary (instant capture).
            // One grounded call upgrades it — the meaning in the learner's language,
            // in the sense its Reader sentence uses — and a provided sentence still
            // gets its translation.
            await upgradeCard(word.id, {
              withExample: wantAiExample,
              level: job.level ?? undefined,
              exampleStyle: job.exampleStyle ?? undefined,
            });
            if (!job.generateExamples) await translateProvidedExample(word);
          } else if (job.generateDetails && wantAiExample) {
            // Common case (full AI enrich, no provided example) → ONE combined call
            // for the dictionary entry + example + translation, instead of three.
            const entry = await enrichWordEntry({
              word: word.word,
              sourceLang: word.sourceLang,
              targetLang: word.targetLang,
              level: job.level ?? undefined,
              exampleStyle: job.exampleStyle ?? undefined,
              withExample: true,
            });
            const preserveMeaning = Boolean(word.meaningZh?.trim());
            await prisma.word.update({
              where: { id: word.id },
              data: {
                phonetic: entry.phonetic || null,
                partOfSpeech: entry.partOfSpeech || null,
                ...(preserveMeaning ? {} : { meaningZh: entry.meaningZh || null }),
                collocations: entry.collocations,
                synonyms: entry.synonyms,
                antonyms: entry.antonyms,
              },
            });
            if (entry.example) {
              await prisma.example.create({
                data: {
                  wordId: word.id,
                  sentenceEn: entry.example,
                  sentenceZh: entry.exampleTranslation,
                  sourceName: "Onomika AI",
                  sourceUrl: "",
                  register: job.exampleStyle ?? "casual",
                  level: job.level ?? null,
                },
              });
            }
          } else {
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
            await translateProvidedExample(word);
          }
          }
        } catch (error) {
          console.error(`Import enrichment failed for ${card.word}`, error);
          failed = true;
        }
        // Never leave a blank card. If enrichment threw or produced no meaning,
        // fall back to a plain translation so the card is at least usable. Only a
        // card that is STILL blank afterwards counts as skipped — a card that got
        // its meaning (just missing example/synonyms) is fine and isn't reported.
        const fresh = await prisma.word.findUnique({ where: { id: word.id }, select: { meaningZh: true } });
        if (!fresh?.meaningZh?.trim()) {
          try {
            const { translation } = await translateText({
              text: word.word,
              sourceLang: word.sourceLang,
              targetLang: word.targetLang,
            });
            const meaning = translation.trim();
            if (meaning) await prisma.word.update({ where: { id: word.id }, data: { meaningZh: meaning } });
            else if (failed) errors.push(card.word);
          } catch {
            if (failed) errors.push(card.word);
          }
        }
      }

      // Persist after every card, and renew the lease. A restart resumes at
      // this exact index instead of repeating the entire import.
      await prisma.importJob.update({
        where: { id: job.id },
        data: { processed: index + 1, errors, leaseUntil: nextLease() },
      });
    }

    // updateMany + status filter: a Stop that lands during the last card wins.
    await prisma.importJob.updateMany({
      where: { id: job.id, status: "processing" },
      data: { status: "completed", completedAt: new Date(), leaseUntil: null },
    });
  } catch (error) {
    await prisma.importJob.updateMany({
      where: { id: job.id, status: "processing" },
      data: { status: "failed", errorMessage: (error as Error).message, completedAt: new Date(), leaseUntil: null },
    });
  }
}

/**
 * A provided example (e.g. from the Reader) may have no translation yet — fill
 * it in so the card's back shows both lines.
 */
async function translateProvidedExample(word: { id: string; sourceLang: string; targetLang: string }) {
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

/** Stop a queued/running job; cards already enriched keep their data. */
/**
 * Stop = undo the add. Learners pressed Stop on a batch in progress and found
 * every card still there ("I stopped but it still created"): the cards exist
 * from the moment the batch is added (instant capture), and Stop only halted
 * the model. Now it also takes back the batch's cards, except any the learner
 * has already reviewed — those have a schedule and are theirs.
 */
export async function cancelImportJobForUser(jobId: string, telegramId: string) {
  const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  if (!user) return null;
  const job = await prisma.importJob.findFirst({ where: { id: jobId, userId: user.id }, select: { cards: true } });
  if (!job) return null;
  await prisma.importJob.updateMany({
    where: { id: jobId, userId: user.id, status: { in: ["queued", "processing"] } },
    data: { status: "cancelled", completedAt: new Date(), leaseUntil: null },
  });
  const parsed = queuedCardsSchema.safeParse(job.cards);
  const ids = parsed.success ? parsed.data.map((c) => c.id) : [];
  const removed = ids.length
    ? (await prisma.word.deleteMany({ where: { id: { in: ids }, userId: user.id, reps: 0, reviewCount: 0 } })).count
    : 0;
  const state = await getImportJobForUser(jobId, telegramId);
  return state ? { ...state, removed } : null;
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
