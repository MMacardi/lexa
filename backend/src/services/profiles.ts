import { prisma } from "./db.js";
import { displayName } from "./friends.js";
import { friendIds, summarize, summarySelect } from "./community.js";
import { LIBRARY_TELEGRAM_ID } from "./librarySeed.js";
import { getStats } from "./vocab.js";

// Per-learner profile page: progress (review activity graph, streak, mastered,
// languages) + their shared decks. Two privacy switches on the user decide who
// sees what — "hidden" | "friends" | "everyone" — and the owner always sees all.
// Aggregates only: a profile never exposes the person's actual cards. There is
// deliberately no "add friend" from a profile: friends are added by referral code only.

export const PRIVACY_LEVELS = ["hidden", "friends", "everyone"] as const;
export type PrivacyLevel = (typeof PRIVACY_LEVELS)[number];

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function allowed(level: string, isMe: boolean, isFriend: boolean): boolean {
  return isMe || level === "everyone" || (level === "friends" && isFriend);
}

export async function getProfile(viewerTelegramId: string, userId: string) {
  const me = await prisma.user.findUnique({ where: { telegramId: viewerTelegramId }, select: { id: true } });
  const u = await prisma.user.findUnique({ where: { id: userId } });
  // 404 for missing, the library system account, and profiles closed to this viewer
  // alike, so a hidden profile doesn't reveal that it exists.
  if (!me || !u || u.telegramId === LIBRARY_TELEGRAM_ID) fail("no_profile", "Profile not found");

  const isMe = u.id === me.id;
  const isFriend = !isMe && (await friendIds(me.id)).includes(u.id);
  const showStats = allowed(u.profileVisibility, isMe, isFriend);
  const showDecks = allowed(u.decksVisibility, isMe, isFriend);
  if (!showStats && !showDecks) fail("no_profile", "Profile not found");

  let stats = null;
  if (showStats) {
    const s = await getStats(u.telegramId);
    stats = { total: s.total, mastered: s.mastered, streak: s.streak, reviews: s.reviews, languages: s.languages, heat: s.heat };
  }

  let decks: ReturnType<typeof summarize>[] = [];
  if (showDecks) {
    // Friends (and the owner) see friends-only decks too; everyone else just public.
    const visible = isMe ? ["friends", "code", "public"] : isFriend ? ["friends", "public"] : ["public"];
    const rows = await prisma.collection.findMany({
      where: { userId: u.id, visibility: { in: visible } },
      select: summarySelect,
      orderBy: { createdAt: "desc" },
    });
    decks = rows.map((r) => summarize(r, me.id)).filter((d) => d.count > 0);
  }

  return {
    id: u.id,
    name: displayName(u),
    since: u.createdAt,
    isMe,
    isFriend,
    stats,
    decks,
    decksHidden: !showDecks,
    // Only the owner learns their own switch values (shown as a hint on the page).
    privacy: isMe ? { profile: u.profileVisibility, decks: u.decksVisibility } : null,
  };
}
