import { prisma } from "./db.js";
import { env } from "../lib/env.js";

// Friends + referral. Public profiles expose only aggregate progress (languages,
// counts, streak) — never a friend's actual words. Visible only between accepted
// friends.

type UserRow = { id: string; telegramId: string; firstName: string | null; lastName: string | null; username: string | null; referralCode: string | null };

// Throw an error carrying a machine-readable code so the frontend can localize it.
function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

async function userByTelegramId(telegramId: string) {
  return prisma.user.findUnique({ where: { telegramId } });
}

function displayName(u: { firstName: string | null; lastName: string | null; username: string | null; telegramId: string }): string {
  const name = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  return name || u.username || `Learner ${u.telegramId.slice(-4)}`;
}

// Compact public stats for a friend card: totals, streak, and languages studied.
// (No words are exposed — aggregates only.)
export async function publicStats(userId: string) {
  const words = await prisma.word.findMany({ where: { userId }, select: { reviewCount: true, sourceLang: true } });
  const reviews = await prisma.reviewEvent.count({ where: { userId } });
  const total = words.length;
  const mastered = words.filter((w) => w.reviewCount >= 5).length;
  const languages = Array.from(new Set(words.map((w) => w.sourceLang))).sort();

  // streak: consecutive days (ending today or yesterday) with >=1 review.
  const now = Date.now();
  const since = new Date(now - 14 * 86400_000);
  since.setHours(0, 0, 0, 0);
  const events = await prisma.reviewEvent.findMany({ where: { userId, createdAt: { gte: since } }, select: { createdAt: true } });
  const dayKey = (d: Date) => {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x.toISOString().slice(0, 10);
  };
  const reviewedDays = new Set(events.map((e) => dayKey(e.createdAt)));
  let streak = 0;
  for (let i = 0; i < 14; i++) {
    const k = dayKey(new Date(now - i * 86400_000));
    if (reviewedDays.has(k)) streak++;
    else if (i === 0) continue; // today may be empty without breaking the streak
    else break;
  }
  return { total, mastered, reviews, languages, streak };
}

// Get (or lazily create) the user's referral code.
export async function ensureReferralCode(telegramId: string): Promise<string> {
  const u = await userByTelegramId(telegramId);
  if (!u) throw new Error("Account not found");
  if (u.referralCode) return u.referralCode;
  // Generate a short, unique, unambiguous code.
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = Math.random().toString(36).slice(2, 8).toUpperCase().replace(/[O0I1]/g, "X");
    const clash = await prisma.user.findUnique({ where: { referralCode: code }, select: { id: true } });
    if (!clash) {
      await prisma.user.update({ where: { id: u.id }, data: { referralCode: code } });
      return code;
    }
  }
  throw new Error("Could not generate a referral code");
}

export async function getReferral(telegramId: string) {
  const code = await ensureReferralCode(telegramId);
  const base = env.FRONTEND_URL.replace(/\/$/, "");
  return { code, link: `${base}/friends?add=${code}` };
}

// Shape a friendship + the other user into a friend card with public stats.
async function friendCard(otherUserId: string, friendshipId: string) {
  const u = await prisma.user.findUnique({ where: { id: otherUserId } });
  if (!u) return null;
  const stats = await publicStats(otherUserId);
  return { friendshipId, telegramId: u.telegramId, name: displayName(u), ...stats };
}

// Accepted friends, each with their public stats.
export async function listFriends(telegramId: string) {
  const me = await userByTelegramId(telegramId);
  if (!me) return [];
  const links = await prisma.friendship.findMany({
    where: { status: "accepted", OR: [{ requesterId: me.id }, { addresseeId: me.id }] },
    orderBy: { createdAt: "desc" },
  });
  const cards = await Promise.all(
    links.map((l) => friendCard(l.requesterId === me.id ? l.addresseeId : l.requesterId, l.id)),
  );
  return cards.filter((c): c is NonNullable<typeof c> => c !== null);
}

// Incoming friend requests (people who added me and I haven't accepted).
export async function listRequests(telegramId: string) {
  const me = await userByTelegramId(telegramId);
  if (!me) return [];
  const links = await prisma.friendship.findMany({
    where: { status: "pending", addresseeId: me.id },
    orderBy: { createdAt: "desc" },
    include: { requester: true },
  });
  return links.map((l) => ({ friendshipId: l.id, telegramId: l.requester.telegramId, name: displayName(l.requester) }));
}

// Send a friend request by referral code. If the other person already sent me one,
// this accepts it instead (mutual add = instant friends).
export async function sendRequestByCode(telegramId: string, code: string) {
  const me = await userByTelegramId(telegramId);
  if (!me) throw new Error("Account not found");
  const other = await prisma.user.findUnique({ where: { referralCode: code.trim().toUpperCase() } });
  if (!other) fail("no_code", "No one has that code");
  if (other.id === me.id) fail("own_code", "That's your own code");

  // Already linked either way?
  const existing = await prisma.friendship.findFirst({
    where: { OR: [{ requesterId: me.id, addresseeId: other.id }, { requesterId: other.id, addresseeId: me.id }] },
  });
  if (existing) {
    if (existing.status === "accepted") return { status: "accepted" as const };
    // They already requested me → accept. I already requested them → still pending.
    if (existing.addresseeId === me.id) {
      await prisma.friendship.update({ where: { id: existing.id }, data: { status: "accepted" } });
      return { status: "accepted" as const };
    }
    return { status: "pending" as const };
  }
  await prisma.friendship.create({ data: { requesterId: me.id, addresseeId: other.id, status: "pending" } });
  return { status: "pending" as const };
}

export async function acceptRequest(telegramId: string, friendshipId: string) {
  const me = await userByTelegramId(telegramId);
  if (!me) throw new Error("Account not found");
  // Only the addressee can accept.
  const link = await prisma.friendship.findFirst({ where: { id: friendshipId, addresseeId: me.id, status: "pending" } });
  if (!link) fail("not_found", "Request not found");
  await prisma.friendship.update({ where: { id: link.id }, data: { status: "accepted" } });
  return { ok: true };
}

// Remove a friend or decline/cancel a request (either party may do this).
export async function removeFriendship(telegramId: string, friendshipId: string) {
  const me = await userByTelegramId(telegramId);
  if (!me) throw new Error("Account not found");
  await prisma.friendship.deleteMany({
    where: { id: friendshipId, OR: [{ requesterId: me.id }, { addresseeId: me.id }] },
  });
  return { ok: true };
}
