import { prisma } from "./db.js";
import { displayName } from "./friends.js";
import { author, canView, REPORT_HIDE_AT } from "./community.js";

// Reports + moderation for shared decks. Any learner who can see someone else's
// deck can flag it once; the admin works through open reports and either
// dismisses them (deck stays) or delists the deck (made private, and the owner
// can't publish it to Community again until the admin restores it).

export const REPORT_REASONS = ["spam", "offensive", "wrong", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

export async function reportDeck(
  telegramId: string,
  deckId: string,
  body: { reason: ReportReason; note?: string; code?: string },
) {
  const me = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  if (!me) fail("no_account", "Account not found");
  const deck = await prisma.collection.findUnique({
    where: { id: deckId },
    select: { id: true, userId: true, name: true, description: true, visibility: true, shareCode: true, mikaPick: true, createdAt: true },
  });
  if (!deck || !(await canView(deck, me.id, body.code))) fail("no_deck", "Deck not found");
  if (deck.userId === me.id) fail("own_deck", "That's your own deck");
  // One report per learner per deck; reporting again doesn't reopen a reviewed one.
  const existing = await prisma.deckReport.findUnique({
    where: { collectionId_reporterId: { collectionId: deck.id, reporterId: me.id } },
    select: { id: true },
  });
  if (!existing) {
    await prisma.deckReport.create({
      data: { collectionId: deck.id, reporterId: me.id, reason: body.reason, note: body.note?.trim() || null },
    });
  }
  return { ok: true };
}

/** Admin queue: decks with open reports (most reported first) + delisted decks. */
export async function moderationQueue() {
  const userSelect = { id: true, telegramId: true, firstName: true, lastName: true, displayName: true, username: true, hideTag: true };
  const deckSelect = {
    id: true,
    name: true,
    visibility: true,
    delistedAt: true,
    user: { select: userSelect },
    _count: { select: { words: true } },
  };
  const [open, delisted] = await Promise.all([
    prisma.deckReport.findMany({
      where: { status: "open" },
      orderBy: { createdAt: "desc" },
      select: {
        reason: true,
        note: true,
        createdAt: true,
        reporter: { select: userSelect },
        collection: { select: deckSelect },
      },
    }),
    prisma.collection.findMany({
      where: { delistedAt: { not: null } },
      orderBy: { delistedAt: "desc" },
      take: 50,
      select: deckSelect,
    }),
  ]);

  type DeckOut = ReturnType<typeof deckOut>;
  const deckOut = (c: (typeof delisted)[number]) => ({
    id: c.id,
    name: c.name,
    visibility: c.visibility,
    words: c._count.words,
    author: author(c.user),
    delisted: Boolean(c.delistedAt),
  });
  const byDeck = new Map<string, { deck: DeckOut; reports: { reason: string; note: string | null; by: string; at: Date }[] }>();
  for (const r of open) {
    const entry = byDeck.get(r.collection.id) ?? { deck: deckOut(r.collection), reports: [] };
    entry.reports.push({ reason: r.reason, note: r.note, by: displayName(r.reporter), at: r.createdAt });
    byDeck.set(r.collection.id, entry);
  }
  return {
    hideAt: REPORT_HIDE_AT,
    reported: [...byDeck.values()].sort((a, b) => b.reports.length - a.reports.length),
    delisted: delisted.map(deckOut),
  };
}

export type ModerationAction = "dismiss" | "delist" | "restore";

export async function moderateDeck(deckId: string, action: ModerationAction) {
  const deck = await prisma.collection.findUnique({ where: { id: deckId }, select: { id: true } });
  if (!deck) fail("no_deck", "Deck not found");
  const now = new Date();
  if (action === "restore") {
    // Lets the owner publish again; it stays private until they choose to.
    await prisma.collection.update({ where: { id: deckId }, data: { delistedAt: null } });
    return { ok: true };
  }
  await prisma.$transaction([
    prisma.deckReport.updateMany({
      where: { collectionId: deckId, status: "open" },
      data: { status: action === "delist" ? "delisted" : "dismissed", resolvedAt: now },
    }),
    ...(action === "delist"
      ? [prisma.collection.update({ where: { id: deckId }, data: { visibility: "private", delistedAt: now } })]
      : []),
  ]);
  return { ok: true };
}
