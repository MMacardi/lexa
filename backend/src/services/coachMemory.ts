import { z } from "zod";
import { prisma } from "./db.js";
import { chatJson } from "./llm.js";

// The learner's persistent "coach memory": what the personal mentor remembers
// across sessions (goal, interests, and a short model-maintained notes summary of
// recurring mistakes / preferences). Injected into every coach/tutor/picks prompt
// so the product behaves like one agent that knows you — not a stateless chat.

export interface CoachProfile {
  goal: string;
  interests: string;
  notes: string;
}

const NOTES_CAP = 900; // keep the injected summary compact + cheap

export async function getProfile(telegramId: string): Promise<CoachProfile> {
  const u = await prisma.user.findUnique({
    where: { telegramId },
    select: { coachGoal: true, coachInterests: true, coachNotes: true },
  });
  return { goal: u?.coachGoal ?? "", interests: u?.coachInterests ?? "", notes: u?.coachNotes ?? "" };
}

export async function updateProfile(
  telegramId: string,
  data: Partial<CoachProfile>,
): Promise<CoachProfile> {
  const update = {
    ...(data.goal !== undefined ? { coachGoal: data.goal.trim().slice(0, 300) } : {}),
    ...(data.interests !== undefined ? { coachInterests: data.interests.trim().slice(0, 300) } : {}),
    ...(data.notes !== undefined ? { coachNotes: data.notes.trim().slice(0, NOTES_CAP) } : {}),
  };
  // Upsert: a learner may edit their profile before any other write created the row.
  const u = await prisma.user.upsert({
    where: { telegramId },
    create: {
      telegramId,
      coachGoal: (data.goal ?? "").trim().slice(0, 300),
      coachInterests: (data.interests ?? "").trim().slice(0, 300),
      coachNotes: (data.notes ?? "").trim().slice(0, NOTES_CAP),
    },
    update,
    select: { coachGoal: true, coachInterests: true, coachNotes: true },
  });
  return { goal: u.coachGoal, interests: u.coachInterests, notes: u.coachNotes };
}

/**
 * A compact "about this learner" preamble to prepend to a prompt. Returns "" when
 * nothing is known yet, so prompts stay lean for new users.
 */
export function profilePreamble(p: CoachProfile): string {
  const lines: string[] = [];
  if (p.goal.trim()) lines.push(`- Goal: ${p.goal.trim()}`);
  if (p.interests.trim()) lines.push(`- Interests / topics they like: ${p.interests.trim()}`);
  if (p.notes.trim()) lines.push(`- What you've learned about them (mistakes, level, preferences): ${p.notes.trim()}`);
  if (lines.length === 0) return "";
  return `About THIS learner (remember it and tailor to them):\n${lines.join("\n")}\n\n`;
}

const notesSchema = z.object({ notes: z.string().default("") });

/**
 * After a session, fold what just happened into the learner's durable notes: one
 * cheap call that merges the old notes with new observations and returns a short,
 * de-duplicated summary. Best-effort — a failure never blocks the session.
 */
export async function rememberFromSession(params: {
  telegramId: string;
  messages: { role: "user" | "assistant"; content: string }[];
}): Promise<void> {
  const transcript = params.messages
    .slice(-20)
    .map((m) => `${m.role === "user" ? "Learner" : "Coach"}: ${m.content}`)
    .join("\n")
    .slice(0, 4000);
  if (!transcript.trim()) return;
  const existing = (await getProfile(params.telegramId)).notes;
  try {
    const r = await chatJson({
      system:
        `You maintain a language learner's coaching notes. Given the existing notes and a transcript of ` +
        `their latest practice, output an UPDATED short notes summary of DURABLE facts worth remembering: ` +
        `recurring mistakes, grammar/vocabulary they struggle with or have mastered, their apparent level, ` +
        `and any preferences or interests they revealed. Merge with the existing notes; drop anything stale ` +
        `or duplicated. Be concise — at most 4 short bullet-like lines, under 500 characters total. Write ` +
        `the notes in the learner's own language if evident, else English. ` +
        'Respond as JSON: {"notes": string}.',
      user: `Existing notes:\n${existing || "(none yet)"}\n\nLatest session transcript:\n${transcript}`,
      schema: notesSchema,
      label: "coach.remember",
      timeoutMs: 20000,
    });
    const notes = (r.notes ?? "").trim().slice(0, NOTES_CAP);
    if (notes) await updateProfile(params.telegramId, { notes });
  } catch (err) {
    console.error("coach remember failed:", (err as Error).message);
  }
}
