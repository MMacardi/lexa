import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./db.js";

// Take-my-data, load-it-back and delete-my-account, kept in one file on purpose:
// a table added to the export but not to the delete is a privacy promise we
// quietly break (and one not added to the import is a copy that won't restore).
//
// Ownership in this schema comes in two shapes and only one of them cleans up:
//   • Rows with a real User relation (collections, folders, reader texts, scenes,
//     coach memories, identities, placement answers, import jobs, friendships,
//     deck reports) carry onDelete: Cascade and go with the account. `Word` is the
//     one exception — its relation has no cascade, so a plain user.delete() fails
//     on a foreign key for anybody who ever added a card. Cards go by hand below.
//   • Rows that only *carry* an id as a plain string have no foreign key at all:
//     ReviewEvent.userId, ProductionEvent.userId, AnalyticsEvent.telegramId and
//     UsageCounter.key. Postgres leaves them behind without a word. They are the
//     learner model (F2/F3) and the activity log (F1) — exactly what /privacy
//     promises to delete — so they are removed explicitly.

/** Everything we hold about one learner, as plain JSON they can keep. */
export async function exportAccount(telegramId: string): Promise<Record<string, unknown> | null> {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: {
      id: true,
      telegramId: true,
      firstName: true,
      lastName: true,
      displayName: true,
      username: true,
      photoUrl: true,
      email: true,
      authVia: true,
      plan: true,
      planUntil: true,
      preferredSource: true,
      preferredTarget: true,
      levels: true,
      nativeLang: true,
      dailyGoal: true,
      retention: true,
      hskVersion: true,
      topic: true,
      topicPool: true,
      hskTarget: true,
      botChatId: true,
      reminderHour: true,
      reminderDays: true,
      referralCode: true,
      profileVisibility: true,
      decksVisibility: true,
      hideEmail: true,
      hideTag: true,
      invited: true,
      invitedAt: true,
      createdAt: true,
      identities: { select: { provider: true, subject: true, createdAt: true } },
    },
  });
  if (!user) return null;
  const uid = user.id;

  const [
    words,
    collections,
    folders,
    readerTexts,
    sceneSessions,
    coachMemories,
    placementAnswers,
    reviewEvents,
    productionEvents,
    analyticsEvents,
    importJobs,
    friendships,
    deckReports,
    aiUsage,
  ] = await Promise.all([
    prisma.word.findMany({
      where: { userId: uid },
      include: { examples: true, collections: { select: { id: true, name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.collection.findMany({ where: { userId: uid }, orderBy: { createdAt: "asc" } }),
    prisma.folder.findMany({ where: { userId: uid }, orderBy: { createdAt: "asc" } }),
    prisma.readerText.findMany({ where: { userId: uid }, orderBy: { createdAt: "asc" } }),
    prisma.sceneSession.findMany({ where: { userId: uid }, orderBy: { createdAt: "asc" } }),
    prisma.coachMemory.findMany({ where: { userId: uid } }),
    prisma.placementAnswer.findMany({ where: { userId: uid }, orderBy: { createdAt: "asc" } }),
    prisma.reviewEvent.findMany({ where: { userId: uid }, orderBy: { createdAt: "asc" } }),
    prisma.productionEvent.findMany({ where: { userId: uid }, orderBy: { createdAt: "asc" } }),
    // BigInt ids aren't JSON-serializable and mean nothing to the learner, so the
    // append-only logs are exported by their contents, not their row numbers.
    prisma.analyticsEvent.findMany({
      where: { telegramId },
      select: { createdAt: true, name: true, surface: true, props: true },
      orderBy: { createdAt: "asc" },
    }),
    // `cards` holds the whole uploaded list again — the resulting words are already
    // in `words`, so the job is exported as its status, not its payload.
    prisma.importJob.findMany({
      where: { userId: uid },
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
      orderBy: { createdAt: "asc" },
    }),
    prisma.friendship.findMany({
      where: { OR: [{ requesterId: uid }, { addresseeId: uid }] },
      select: { requesterId: true, addresseeId: true, status: true, createdAt: true },
    }),
    prisma.deckReport.findMany({ where: { reporterId: uid } }),
    // Their AI spend, as the totals the admin dashboard reads — per-call rows carry
    // BigInt ids and say nothing a learner would want.
    prisma.tokenUsage.groupBy({
      by: ["feature"],
      where: { telegramId },
      _count: { _all: true },
      _sum: { totalTokens: true },
    }),
  ]);

  return {
    _meta: {
      exportedAt: new Date().toISOString(),
      note: "Your Onomika data. Dates are ISO 8601 UTC. Cards, reviews and 'can use' attempts are the parts worth keeping.",
    },
    account: user,
    words,
    collections,
    folders,
    readerTexts,
    sceneSessions,
    coachMemories,
    placementAnswers,
    reviewEvents,
    productionEvents,
    analyticsEvents,
    importJobs,
    friendships,
    deckReports,
    aiUsage: aiUsage.map((r) => ({ feature: r.feature, calls: r._count._all, totalTokens: r._sum.totalTokens ?? 0 })),
  };
}

// --- Loading a copy back ---
//
// The download used to be a file with no way back in: someone who deleted their
// account and returned, or signed up again with another sign-in, had their
// history on disk and an empty deck in the app. This reads that same file into
// the signed-in account.
//
// It adds and never overwrites, so a file loaded twice changes nothing the second
// time. Rows are matched by what they are and when they were made — a card by its
// spelling, language pair and createdAt, a review or a "can use" attempt by its
// timestamp and source — never by the ids in the file: those belong to the old
// account, which may still hold them for its whole grace period. Only the
// learning data comes back. Settings were just chosen in the new account's
// onboarding; friendships and deck reports name other people; the activity log
// and AI spend describe the old account, not what the learner knows.

type Rec = Record<string, unknown>;
const recs = (v: unknown): Rec[] =>
  Array.isArray(v) ? v.filter((x): x is Rec => !!x && typeof x === "object" && !Array.isArray(x)) : [];
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const strN = (v: unknown): string | null => (typeof v === "string" ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const int = (v: unknown): number => (Number.isInteger(v) ? (v as number) : 0);
const intN = (v: unknown): number | null => (Number.isInteger(v) ? (v as number) : null);
const numN = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const json = (v: unknown) => (v === null || v === undefined ? undefined : (v as Prisma.InputJsonValue));
function date(v: unknown): Date | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
// Ids are minted here so a card and its examples go in as two createMany calls
// instead of a query per card. Same length and alphabet as Prisma's cuid(), so
// nothing that stores or passes a card id (bot callback data has 64 bytes) sees
// a difference.
const newId = () => "c" + randomBytes(16).toString("hex").slice(0, 24);

export type ImportSummary = {
  words: number;
  collections: number;
  reviews: number;
  uses: number;
  texts: number;
  /** Cards the account already had — the file's copy was left out. */
  skipped: number;
};

/** Add the learning data from an export file to this account. Null if there's no account. */
export async function importAccount(telegramId: string, file: Rec): Promise<ImportSummary | null> {
  const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  if (!user) return null;
  const uid = user.id;

  return prisma.$transaction(
    async (tx) => {
      // Folders and decks are unique by name per account; one that already exists
      // under that name is reused, so cards land back in the deck they came from.
      const folders = recs(file.folders).filter((x) => str(x.name));
      await tx.folder.createMany({
        data: folders.map((x) => ({ userId: uid, name: str(x.name)!, createdAt: date(x.createdAt) ?? undefined })),
        skipDuplicates: true,
      });
      const folderByName = new Map(
        (await tx.folder.findMany({ where: { userId: uid }, select: { id: true, name: true } })).map((x) => [x.name, x.id]),
      );
      const folderId = new Map(folders.map((x) => [str(x.id) ?? "", folderByName.get(str(x.name)!) ?? null]));

      // Decks come back private. A share code is unique across everyone and the
      // old account may still be using it; sharing again is one tap.
      const decksBefore = await tx.collection.count({ where: { userId: uid } });
      await tx.collection.createMany({
        data: recs(file.collections)
          .filter((x) => str(x.name))
          .map((x) => ({
            userId: uid,
            name: str(x.name)!,
            description: strN(x.description),
            folderId: folderId.get(str(x.folderId) ?? "") ?? null,
            copiedFromId: strN(x.copiedFromId),
            createdAt: date(x.createdAt) ?? undefined,
          })),
        skipDuplicates: true,
      });
      const deckByName = new Map(
        (await tx.collection.findMany({ where: { userId: uid }, select: { id: true, name: true } })).map((x) => [x.name, x.id]),
      );

      const cardKey = (w: string, s: string, t: string, at: Date) => `${w}\u0000${s}\u0000${t}\u0000${at.getTime()}`;
      const have = new Map(
        (
          await tx.word.findMany({
            where: { userId: uid },
            select: { id: true, word: true, sourceLang: true, targetLang: true, createdAt: true },
          })
        ).map((w) => [cardKey(w.word, w.sourceLang, w.targetLang, w.createdAt), w.id]),
      );
      const wordId = new Map<string, string>(); // id in the file → id in this account
      const words: Prisma.WordCreateManyInput[] = [];
      const examples: Prisma.ExampleCreateManyInput[] = [];
      const inDeck = new Map<string, string[]>(); // deck id → new card ids
      let skipped = 0;
      for (const w of recs(file.words)) {
        const text = str(w.word);
        if (!text?.trim()) continue;
        const sourceLang = str(w.sourceLang) ?? "en";
        const targetLang = str(w.targetLang) ?? "zh";
        const createdAt = date(w.createdAt) ?? new Date();
        const key = cardKey(text, sourceLang, targetLang, createdAt);
        let id = have.get(key);
        if (id) {
          skipped++;
        } else {
          id = newId();
          have.set(key, id);
          // The schedule and the "can use" ledger come across as they were: they
          // are the learner model, and the review log below is their history.
          words.push({
            id,
            userId: uid,
            word: text,
            sourceLang,
            targetLang,
            phonetic: strN(w.phonetic),
            partOfSpeech: strN(w.partOfSpeech),
            meaningZh: strN(w.meaningZh),
            collocations: strs(w.collocations),
            synonyms: strs(w.synonyms),
            antonyms: strs(w.antonyms),
            notes: strN(w.notes),
            explainCache: strN(w.explainCache),
            senses: json(w.senses),
            familyAt: date(w.familyAt),
            reviewCount: int(w.reviewCount),
            nextReviewAt: date(w.nextReviewAt),
            stability: numN(w.stability),
            difficulty: numN(w.difficulty),
            due: date(w.due),
            reps: int(w.reps),
            lapses: int(w.lapses),
            state: int(w.state),
            learningSteps: int(w.learningSteps),
            lastReview: date(w.lastReview),
            writeStability: numN(w.writeStability),
            writeDifficulty: numN(w.writeDifficulty),
            writeDue: date(w.writeDue),
            writeReps: int(w.writeReps),
            writeLapses: int(w.writeLapses),
            writeState: int(w.writeState),
            writeSteps: int(w.writeSteps),
            writeLast: date(w.writeLast),
            produceAttempts: int(w.produceAttempts),
            produceCorrect: int(w.produceCorrect),
            produceStreak: int(w.produceStreak),
            lastProducedAt: date(w.lastProducedAt),
            canUseAt: date(w.canUseAt),
            createdAt,
            sharedFrom: strN(w.sharedFrom),
            sharedDeck: strN(w.sharedDeck),
            sharedDeckId: strN(w.sharedDeckId),
          });
          for (const e of recs(w.examples)) {
            if (!str(e.sentenceEn) && !str(e.sentenceZh)) continue;
            examples.push({
              wordId: id,
              sentenceEn: str(e.sentenceEn) ?? "",
              sentenceZh: str(e.sentenceZh) ?? "",
              sourceName: str(e.sourceName) ?? "",
              sourceUrl: str(e.sourceUrl) ?? "",
              register: strN(e.register),
              level: strN(e.level),
              createdAt: date(e.createdAt) ?? undefined,
            });
          }
          for (const c of recs(w.collections)) {
            const deck = deckByName.get(str(c.name) ?? "");
            if (deck) inDeck.set(deck, [...(inDeck.get(deck) ?? []), id]);
          }
        }
        const fileId = str(w.id);
        if (fileId) wordId.set(fileId, id);
      }
      await tx.word.createMany({ data: words });
      await tx.example.createMany({ data: examples });
      for (const [deck, ids] of inDeck) {
        await tx.collection.update({ where: { id: deck }, data: { words: { connect: ids.map((id) => ({ id })) } } });
      }

      // A review whose card was deleted before the export still counts for the
      // streak and the pace, so it comes back with no card, as it was.
      const seenReview = new Set(
        (await tx.reviewEvent.findMany({ where: { userId: uid }, select: { createdAt: true, source: true } })).map(
          (e) => `${e.createdAt.getTime()}|${e.source}`,
        ),
      );
      const reviews: Prisma.ReviewEventCreateManyInput[] = [];
      for (const e of recs(file.reviewEvents)) {
        const at = date(e.createdAt);
        const source = str(e.source) ?? "review";
        if (!at || seenReview.has(`${at.getTime()}|${source}`)) continue;
        seenReview.add(`${at.getTime()}|${source}`);
        reviews.push({
          userId: uid,
          wordId: wordId.get(str(e.wordId) ?? "") ?? null,
          grade: intN(e.grade),
          source,
          prev: json(e.prev),
          createdAt: at,
        });
      }
      await tx.reviewEvent.createMany({ data: reviews });

      const seenUse = new Set(
        (await tx.productionEvent.findMany({ where: { userId: uid }, select: { createdAt: true, source: true } })).map(
          (e) => `${e.createdAt.getTime()}|${e.source}`,
        ),
      );
      const uses: Prisma.ProductionEventCreateManyInput[] = [];
      for (const e of recs(file.productionEvents)) {
        const at = date(e.createdAt);
        const verdict = str(e.verdict);
        const source = str(e.source) ?? "drill";
        if (!at || !verdict || seenUse.has(`${at.getTime()}|${source}`)) continue;
        seenUse.add(`${at.getTime()}|${source}`);
        uses.push({
          userId: uid,
          wordId: wordId.get(str(e.wordId) ?? "") ?? null,
          verdict,
          source,
          errorKind: strN(e.errorKind),
          createdAt: at,
        });
      }
      await tx.productionEvent.createMany({ data: uses });

      await tx.placementAnswer.createMany({
        data: recs(file.placementAnswers)
          .filter((x) => str(x.word) && str(x.sourceLang) && str(x.targetLang) && typeof x.known === "boolean")
          .map((x) => ({
            userId: uid,
            word: str(x.word)!,
            sourceLang: str(x.sourceLang)!,
            targetLang: str(x.targetLang)!,
            level: strN(x.level),
            known: x.known as boolean,
            fake: x.fake === true,
            took: x.took === true,
            createdAt: date(x.createdAt) ?? undefined,
          })),
        skipDuplicates: true,
      });
      await tx.coachMemory.createMany({
        data: recs(file.coachMemories)
          .filter((x) => str(x.lang))
          .map((x) => ({
            userId: uid,
            lang: str(x.lang)!,
            goal: str(x.goal) ?? "",
            interests: str(x.interests) ?? "",
            notes: str(x.notes) ?? "",
          })),
        skipDuplicates: true,
      });

      // Reader texts that were still generating (or failed) have nothing in them.
      const seenText = new Set(
        (await tx.readerText.findMany({ where: { userId: uid }, select: { title: true, createdAt: true } })).map(
          (x) => `${x.title}|${x.createdAt.getTime()}`,
        ),
      );
      const texts: Prisma.ReaderTextCreateManyInput[] = [];
      for (const x of recs(file.readerTexts)) {
        const title = str(x.title);
        const content = str(x.content);
        const at = date(x.createdAt);
        if (!title || !content || !at || (x.status !== undefined && x.status !== "ready")) continue;
        if (seenText.has(`${title}|${at.getTime()}`)) continue;
        seenText.add(`${title}|${at.getTime()}`);
        texts.push({
          userId: uid,
          title,
          content,
          collection: strN(x.collection),
          translation: strN(x.translation),
          clickedWords: strs(x.clickedWords),
          level: strN(x.level),
          sourceLang: strN(x.sourceLang),
          targetLang: strN(x.targetLang),
          createdAt: at,
          updatedAt: date(x.updatedAt) ?? at,
        });
      }
      await tx.readerText.createMany({ data: texts });

      return {
        words: words.length,
        collections: (await tx.collection.count({ where: { userId: uid } })) - decksBefore,
        reviews: reviews.length,
        uses: uses.length,
        texts: texts.length,
        skipped,
      };
    },
    // A few createMany calls, but on a big file each is thousands of rows.
    { timeout: 60_000, maxWait: 10_000 },
  );
}

// --- The grace period (BACKLOG "A grace period on account deletion") ---
//
// "Delete my account" used to erase on the spot: one typed word and the learner
// model was gone. That weighed the privacy promise against nothing — a mis-tap on
// a phone, a change of heart the next morning, and the author being user #1 with
// no backup yet. Now it schedules: DELETE_GRACE_DAYS in which nothing is erased and
// signing in offers "keep my account", then the purge erases for good. "Delete
// now" stays one tap away on the same screen, for anyone who wants it gone at once.

export const DELETE_GRACE_DAYS = 14;

/** Schedule the erase; returns when it will happen, or null if there's no account. */
export async function scheduleDeletion(telegramId: string, now = new Date()): Promise<Date | null> {
  const deleteAfter = new Date(now.getTime() + DELETE_GRACE_DAYS * 86_400_000);
  const r = await prisma.user.updateMany({ where: { telegramId }, data: { deleteAfter } });
  return r.count ? deleteAfter : null;
}

/** "Keep my account": the erase is off. */
export async function cancelDeletion(telegramId: string): Promise<boolean> {
  const r = await prisma.user.updateMany({ where: { telegramId, deleteAfter: { not: null } }, data: { deleteAfter: null } });
  return r.count > 0;
}

/** Erase every account whose grace period has run out. Returns how many went. */
export async function purgeDueDeletions(now = new Date()): Promise<number> {
  const due = await prisma.user.findMany({ where: { deleteAfter: { lte: now } }, select: { telegramId: true } });
  let n = 0;
  for (const u of due) {
    try {
      if (await deleteAccount(u.telegramId)) n++;
    } catch (err) {
      // One account failing must not keep the rest waiting another hour.
      console.error(`[purge] could not delete ${u.telegramId}:`, (err as Error).message);
    }
  }
  return n;
}

/** Run the purge now and then hourly, for as long as the process lives. */
export function startDeletionPurge(): void {
  const run = () =>
    purgeDueDeletions()
      .then((n) => n && console.log(`[purge] erased ${n} account(s) past their grace period`))
      .catch((err) => console.error("[purge] failed:", err));
  void run();
  setInterval(run, 3_600_000).unref?.();
}

/** Erase the account and everything attached to it. Returns false if it was already gone. */
export async function deleteAccount(telegramId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  if (!user) return false;
  const uid = user.id;

  // One transaction, in order: the foreign-key-less tables first (nothing else
  // will ever collect them), then cards, then the account whose cascades sweep
  // the rest. The array form runs sequentially, so the order here is the order
  // Postgres sees.
  await prisma.$transaction([
    prisma.reviewEvent.deleteMany({ where: { userId: uid } }),
    prisma.productionEvent.deleteMany({ where: { userId: uid } }),
    prisma.analyticsEvent.deleteMany({ where: { telegramId } }),
    prisma.usageCounter.deleteMany({
      where: {
        OR: [{ key: { startsWith: `d:${telegramId}:` } }, { key: { startsWith: `m:${telegramId}:` } }],
      },
    }),
    // The AI cost ledger stays, but stops naming anyone. These rows are what a
    // month of Bailian actually cost us (UNIT_ECONOMICS); deleting them would
    // silently under-report spend, and with the id gone they identify nobody.
    prisma.tokenUsage.updateMany({ where: { telegramId }, data: { telegramId: null } }),
    // Word is the relation without onDelete: Cascade. Examples hang off Word and
    // do cascade, so this one deleteMany takes both.
    prisma.word.deleteMany({ where: { userId: uid } }),
    prisma.user.delete({ where: { id: uid } }),
  ]);
  return true;
}
