// The learner model's settings half: CEFR level per studied language, the
// language the learner already knows, the daily card goal and the FSRS desired
// retention. These used to live in the browser's localStorage, which meant the
// Telegram bot (and every other server-side surface) could not see them and a
// second device started from scratch. They live on the User now; the client keeps
// a local copy as an offline cache and uploads it once if the server has none.

import { z } from "zod";
import { prisma } from "./db.js";

export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

// A language code is usually "en"/"zh", but a user-defined language is a slug of
// its full name ("brazilian-portuguese"), so the cap has to clear those.
const langCode = z.string().min(2).max(40);

/** { [sourceLang]: "A1".."C2" } — one level per language being studied. */
const levelsSchema = z.record(langCode, z.enum(CEFR_LEVELS));

// Every field is optional: a PATCH carries only what changed. `null` is a real
// value here — it clears a setting back to "never set" — so nullable, not just
// optional. Bounds match the pickers in the UI and are re-checked here because a
// client is not trusted.
export const learnerPrefsSchema = z.object({
  levels: levelsSchema.nullable().optional(),
  nativeLang: langCode.nullable().optional(),
  dailyGoal: z.number().int().min(1).max(100).nullable().optional(),
  retention: z.number().min(0.7).max(0.98).nullable().optional(),
});

export type LearnerPrefs = z.infer<typeof learnerPrefsSchema>;

/** The columns to `select` wherever the prefs are read. */
export const learnerPrefsSelect = {
  levels: true,
  nativeLang: true,
  dailyGoal: true,
  retention: true,
} as const;

// --- Placement test answers ---
// The onboarding mini-test asks the learner to tap the words they do NOT know.
// Both halves of that answer are worth keeping: the taps say what to teach, and
// the untapped words are an explicit "I already know this" about vocabulary that
// never enters the deck — the only cheap evidence we have for a readiness mark.

export const placementAnswersSchema = z.object({
  sourceLang: langCode,
  targetLang: langCode,
  level: z.enum(CEFR_LEVELS).optional(),
  // The whole list the learner was shown, split by their taps.
  known: z.array(z.string().min(1).max(80)).max(200),
  unknown: z.array(z.string().min(1).max(80)).max(200),
});

export type PlacementAnswers = z.infer<typeof placementAnswersSchema>;

/**
 * Store one run of the placement test. Re-taking it overwrites the previous
 * answer for the same word (the newer tap is the better evidence), which the
 * (userId, word, sourceLang) unique key makes a plain upsert.
 */
export async function savePlacementAnswers(telegramId: string, a: PlacementAnswers): Promise<number> {
  const user = await prisma.user.upsert({
    where: { telegramId },
    create: { telegramId },
    update: {},
    select: { id: true },
  });

  const rows = [
    ...a.known.map((word) => ({ word: word.trim(), known: true })),
    ...a.unknown.map((word) => ({ word: word.trim(), known: false })),
  ].filter((r) => r.word);

  // A word can only be on one side; if the client sends both, the tap ("I don't
  // know it") wins because it is the deliberate action.
  const seen = new Map<string, boolean>();
  for (const r of rows) if (!seen.has(r.word) || !r.known) seen.set(r.word, r.known);

  await prisma.$transaction(
    [...seen].map(([word, known]) =>
      prisma.placementAnswer.upsert({
        where: { userId_word_sourceLang: { userId: user.id, word, sourceLang: a.sourceLang } },
        create: { userId: user.id, word, known, sourceLang: a.sourceLang, targetLang: a.targetLang, level: a.level ?? null },
        update: { known, targetLang: a.targetLang, level: a.level ?? null, createdAt: new Date() },
      }),
    ),
  );
  return seen.size;
}
