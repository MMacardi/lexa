import { prisma } from "./db.js";

// Resolves a sign-in to an account, supporting multiple linked methods per user.
//
// Rules, in order:
//   1. Known identity (provider+subject) → its account.
//   2. Linking: if a session is active, attach this identity to that account
//      (unless it's already linked to a different one that holds real work).
//   3. Auto-link: a *verified* email that matches an existing account's email
//      joins it (so Google + magic-link for one address are one account).
//   4. Otherwise create a new account (reusing a bot-created row if the canonical
//      id already exists) and attach the identity.

export type Provider = "telegram" | "google" | "email" | "dev";

export interface ResolveInput {
  provider: Provider;
  subject: string;
  email?: string | null;
  profile?: {
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
    photoUrl?: string | null;
  };
  authVia: string;
  /** When set, link the identity to this logged-in account instead of switching. */
  sessionTelegramId?: string | null;
}

async function applyProfile(userId: string, input: ResolveInput): Promise<void> {
  const data: Record<string, unknown> = { authVia: input.authVia };
  if (input.email) data.email = input.email.toLowerCase();
  const p = input.profile ?? {};
  if (p.firstName != null) data.firstName = p.firstName;
  if (p.lastName != null) data.lastName = p.lastName;
  if (p.username != null) data.username = p.username;
  if (p.photoUrl != null) data.photoUrl = p.photoUrl;
  await prisma.user.update({ where: { id: userId }, data });
}

/**
 * Move a Telegram identity off an empty bot-created account onto the account the
 * learner is signed into. "Empty" is strict — no cards, no collections and no
 * other way to sign in — so nothing can be lost; the row itself is left behind
 * (unreachable, since no identity points at it) rather than cascade-deleted.
 * Returns false when the other account holds real work: that is a genuine clash.
 */
async function absorbStub(stubId: string, intoId: string): Promise<boolean> {
  const stub = await prisma.user.findUnique({
    where: { id: stubId },
    select: {
      authVia: true,
      botChatId: true,
      reminderHour: true,
      reminderDays: true,
      _count: { select: { words: true, collections: true, identities: true } },
    },
  });
  if (!stub) return false;
  if (stub.authVia !== "telegram" || stub._count.words > 0 || stub._count.collections > 0) return false;
  if (stub._count.identities !== 1) return false;

  const target = await prisma.user.findUnique({ where: { id: intoId }, select: { reminderHour: true } });
  await prisma.$transaction([
    prisma.authIdentity.updateMany({ where: { userId: stubId }, data: { userId: intoId } }),
    prisma.user.update({
      where: { id: intoId },
      data: {
        botChatId: stub.botChatId,
        // Only carry the nudge settings over when the real account has none —
        // a reminder the learner set on the site outranks the bot's default.
        ...(target?.reminderHour == null && stub.reminderHour != null
          ? { reminderHour: stub.reminderHour, reminderDays: stub.reminderDays }
          : {}),
      },
    }),
    // Stop the reminder sweep from messaging the shell we just emptied.
    prisma.user.update({ where: { id: stubId }, data: { botChatId: null, reminderHour: null } }),
  ]);
  return true;
}

/** Returns the canonical telegramId (session subject) for the resolved account. */
export async function resolveIdentity(input: ResolveInput): Promise<{ telegramId: string }> {
  const { provider, subject } = input;
  const email = input.email?.toLowerCase() ?? null;

  const existing = await prisma.authIdentity.findUnique({
    where: { provider_subject: { provider, subject } },
    select: { userId: true, user: { select: { telegramId: true } } },
  });

  // (2) Linking into an active session.
  if (input.sessionTelegramId) {
    const me = await prisma.user.findUnique({
      where: { telegramId: input.sessionTelegramId },
      select: { id: true, telegramId: true },
    });
    if (!me) throw new Error("Session account not found");
    if (existing && existing.userId !== me.id) {
      // Before the bot learned to resolve through AuthIdentity it created a bare
      // account for anyone who opened the chat, and that shell then blocked the
      // learner from linking Telegram to the account they actually use. An empty
      // shell isn't an account: move the identity (and the chat id, so reminders
      // keep arriving) over instead of refusing.
      if (!(await absorbStub(existing.userId, me.id))) {
        throw new Error("That sign-in method is already linked to another account.");
      }
    }
    if (!existing) await prisma.authIdentity.create({ data: { userId: me.id, provider, subject } });
    await applyProfile(me.id, input);
    return { telegramId: me.telegramId };
  }

  // (1) Known identity.
  if (existing) {
    await applyProfile(existing.userId, input);
    return { telegramId: existing.user.telegramId };
  }

  // (3) Auto-link by verified email.
  if (email) {
    const byEmail = await prisma.user.findFirst({ where: { email }, select: { id: true, telegramId: true } });
    if (byEmail) {
      await prisma.authIdentity.create({ data: { userId: byEmail.id, provider, subject } });
      await applyProfile(byEmail.id, input);
      return { telegramId: byEmail.telegramId };
    }
  }

  // (4) New account — but reuse a row already created by the bot for this id.
  const canonical = email ? `email:${email}` : subject;
  const found = await prisma.user.findUnique({ where: { telegramId: canonical }, select: { id: true } });
  const userId =
    found?.id ??
    (
      await prisma.user.create({
        data: {
          telegramId: canonical,
          email,
          firstName: input.profile?.firstName ?? null,
          lastName: input.profile?.lastName ?? null,
          username: input.profile?.username ?? null,
          photoUrl: input.profile?.photoUrl ?? null,
          authVia: input.authVia,
        },
        select: { id: true },
      })
    ).id;
  await prisma.authIdentity.upsert({
    where: { provider_subject: { provider, subject } },
    create: { userId, provider, subject },
    update: {},
  });
  await applyProfile(userId, input);
  return { telegramId: canonical };
}

/** Identities linked to an account, for the "connected accounts" UI. */
export async function listIdentities(telegramId: string): Promise<{ provider: string; subject: string }[]> {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { identities: { select: { provider: true, subject: true }, orderBy: { createdAt: "asc" } } },
  });
  return user?.identities ?? [];
}

/** Unlink a provider from an account. Refuses to remove the last sign-in method. */
export async function unlinkIdentity(telegramId: string, provider: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { id: true, identities: { select: { id: true, provider: true } } },
  });
  if (!user) throw new Error("Account not found");
  const toRemove = user.identities.filter((i) => i.provider === provider);
  if (toRemove.length === 0) return;
  if (toRemove.length >= user.identities.length) {
    throw new Error("You can't remove your only sign-in method.");
  }
  await prisma.authIdentity.deleteMany({ where: { userId: user.id, provider } });
}
