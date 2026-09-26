import { prisma } from "./db.js";

// Take-my-data and delete-my-account, kept in one file on purpose: a table added
// to the export but not to the delete is a privacy promise we quietly break.
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
