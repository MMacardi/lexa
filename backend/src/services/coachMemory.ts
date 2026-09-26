import { z } from "zod";
import { prisma } from "./db.js";
import { chatJson, FAST_MODEL } from "./llm.js";
import { langName } from "../lib/langs.js";

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
  const u = await prisma.user.findUnique({
    where: { telegramId },
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
  // Upsert the user: a bot-only learner may set a goal before any other write created the row.
  const u = await prisma.user.upsert({
    where: { telegramId },
    create: { telegramId },
    update: {},
    select: { id: true },
  });
  const m = await prisma.coachMemory.upsert({
    where: { userId_lang: { userId: u.id, lang } },
    create: { userId: u.id, lang, goal: goal ?? "", interests: interests ?? "", notes: notes ?? "" },
    update: {
      ...(goal !== undefined ? { goal } : {}),
      ...(interests !== undefined ? { interests } : {}),
      ...(notes !== undefined ? { notes } : {}),
    },
    select: { goal: true, interests: true, notes: true },
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

const notesSchema = z.object({ notes: z.string().default("") });

/**
 * After a session, fold what just happened into the durable notes FOR THAT LANGUAGE:
 * one cheap call that merges the old notes with new observations and returns a short,
 * de-duplicated summary. Best-effort — a failure never blocks the session.
 */
export async function rememberFromSession(params: {
  telegramId: string;
  lang: string;
  messages: { role: "user" | "assistant"; content: string }[];
}): Promise<void> {
  const transcript = params.messages
    .slice(-20)
    .map((m) => `${m.role === "user" ? "Learner" : "Coach"}: ${m.content}`)
    .join("\n")
    .slice(0, 4000);
  if (!transcript.trim()) return;
  const existing = (await getProfile(params.telegramId, params.lang)).notes;
  try {
    const r = await chatJson({
      system:
        `You maintain a language learner's coaching notes. The learner was practising ${langName(params.lang)}. ` +
        `These notes are ONLY about that language — do NOT record goals, exams, tests or facts that belong to ` +
        `any other language they may also study. Given the existing notes and a transcript of their latest ` +
        `practice, output an UPDATED short notes summary of DURABLE facts worth remembering: recurring mistakes, ` +
        `grammar/vocabulary they struggle with or have mastered, their apparent level in ${langName(params.lang)}, ` +
        `and any preferences or interests they revealed. Merge with the existing notes; drop anything stale ` +
        `or duplicated. Be concise — at most 4 short bullet-like lines, under 500 characters total. Write ` +
        `the notes in the learner's own language if evident, else English. ` +
        'Respond as JSON: {"notes": string}.',
      user: `Existing notes:\n${existing || "(none yet)"}\n\nLatest session transcript:\n${transcript}`,
      schema: notesSchema,
      label: "coach.remember",
      model: FAST_MODEL,
      timeoutMs: 20000,
    });
    const notes = (r.notes ?? "").trim().slice(0, NOTES_CAP);
    if (notes) await updateProfile(params.telegramId, params.lang, { notes });
  } catch (err) {
    console.error("coach remember failed:", (err as Error).message);
  }
}
