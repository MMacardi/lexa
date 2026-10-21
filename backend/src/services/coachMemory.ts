import { prisma } from "./db.js";
import { langName } from "../lib/langs.js";
import { checkpointMemory, memorySnapshot } from "./mikaMemory.js";

// The learner's persistent "coach memory": what the personal mentor remembers
// across sessions (goal, interests, and a short model-maintained notes summary of
// recurring mistakes / preferences). Injected into every coach/tutor/picks prompt
// so the product behaves like one agent that knows you — not a stateless chat.
//
// Scoped per SOURCE LANGUAGE. One global blob meant an IELTS goal mentioned once in
// an English chat followed the learner into every Chinese drill, scene and the
// site-wide tutor popup forever.

export interface CoachProfile {
  goal: string;
  interests: string;
  notes: string;
  // Chinese only: the exam from the account's own fields (target, list, day), so
  // the prompt always has today's version — the goal text used to carry "HSK 4
  // (in 1–3 months)", which was stale the week after onboarding wrote it.
  exam?: string;
}

const NOTES_CAP = 900; // keep the injected summary compact + cheap
const EMPTY: CoachProfile = { goal: "", interests: "", notes: "" };

/** Never throws: a missing user or a missing row for that language is just "nothing known yet". */
export async function getProfile(telegramId: string, lang: string): Promise<CoachProfile> {
  const u = await prisma.user.findFirst({
    where: { telegramId, deleteAfter: null },
    select: { id: true, hskVersion: true, hskTarget: true, examDate: true },
  });
  if (!u) return EMPTY;
  const m = await prisma.coachMemory.findUnique({
    where: { userId_lang: { userId: u.id, lang } },
    select: { goal: true, interests: true, notes: true },
  });
  const p = m ? { goal: m.goal, interests: m.interests, notes: m.notes } : EMPTY;
  return lang === "zh" && u.hskTarget ? { ...p, exam: examLine(u.hskTarget, u.hskVersion, u.examDate) } : p;
}

export async function updateProfile(
  telegramId: string,
  lang: string,
  data: Partial<CoachProfile>,
): Promise<CoachProfile> {
  const goal = data.goal?.trim().slice(0, 300);
  const interests = data.interests?.trim().slice(0, 300);
  const notes = data.notes?.trim().slice(0, NOTES_CAP);
  // A late background write must never recreate a deleted account.
  const u = await prisma.user.findFirst({
    where: { telegramId, deleteAfter: null },
    select: { id: true },
  });
  if (!u) return EMPTY;
  const m = await prisma.$transaction(async (tx) => {
    const memory = await tx.coachMemory.upsert({
      where: { userId_lang: { userId: u.id, lang } },
      create: { userId: u.id, lang, goal: goal ?? "", interests: interests ?? "", notes: notes ?? "", pinnedNotes: notes ?? "" },
      update: {
        revision: { increment: 1 },
        ...(goal !== undefined ? { goal } : {}),
        ...(interests !== undefined ? { interests } : {}),
        ...(notes !== undefined ? { notes, pinnedNotes: notes } : {}),
      },
      select: { id: true, goal: true, interests: true, notes: true },
    });
    await tx.coachMemoryUpdate.updateMany({
      where: { memoryId: memory.id, state: { notIn: ["done", "failed"] } },
      data: { state: "done", transcript: "" },
    });
    return memory;
  });
  return { goal: m.goal, interests: m.interests, notes: m.notes };
}

/**
 * A compact "about this learner" preamble to prepend to a prompt. Returns "" when
 * nothing is known yet, so prompts stay lean for new users.
 */
function examLine(target: number, version: string | null, day: Date | null): string {
  const level = `HSK ${target === 7 ? "7–9" : target}${version ? ` (${version} list)` : ""}`;
  if (!day) return `${level}, no date set`;
  const days = Math.ceil((day.getTime() - Date.now()) / 86_400_000);
  const iso = day.toISOString().slice(0, 10);
  return days >= 0 ? `${level} on ${iso}, ${days} days from now` : `${level}; the date set (${iso}) has passed`;
}

export function profilePreamble(p: CoachProfile, lang: string): string {
  const lines: string[] = [];
  if (p.exam) lines.push(`- Exam: ${p.exam}`);
  if (p.goal.trim()) lines.push(`- Goal: ${p.goal.trim()}`);
  if (p.interests.trim()) lines.push(`- Interests / topics they like: ${p.interests.trim()}`);
  if (p.notes.trim()) lines.push(`- What you've learned about them (mistakes, level, preferences): ${p.notes.trim()}`);
  if (lines.length === 0) return "";
  return (
    `About THIS learner for their ${langName(lang)} practice ` +
    `(it does NOT apply to any other language they study — never mention it unless it fits here):\n` +
    `${lines.join("\n")}\n\n`
  );
}

/**
 * Legacy bot/scene callers use the same durable checkpoint worker as ordinary Mika.
 * Best-effort — a failure never blocks the session.
 */
export async function rememberFromSession(params: {
  telegramId: string;
  lang: string;
  messages: { role: "user" | "assistant"; content: string }[];
}): Promise<void> {
  try {
    const snapshot = await memorySnapshot(params.telegramId, params.lang);
    for (let i = Math.max(1, params.messages.length - 20); i < params.messages.length; i++) {
      if (params.messages[i].role === "assistant" && params.messages[i - 1].role === "user") {
        await checkpointMemory(snapshot, params.messages.slice(0, i + 1));
      }
    }
  } catch (err) {
    console.error("coach remember failed:", (err as Error).message);
  }
}
