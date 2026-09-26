// The learner model's settings half: CEFR level per studied language, the
// language the learner already knows, the daily card goal and the FSRS desired
// retention. These used to live in the browser's localStorage, which meant the
// Telegram bot (and every other server-side surface) could not see them and a
// second device started from scratch. They live on the User now; the client keeps
// a local copy as an offline cache and uploads it once if the server has none.

import { z } from "zod";
import { prisma } from "./db.js";
import { HSK_MAX_LEVEL, HSK_VERSIONS, type HskVersion } from "./hsk.js";

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
  // Which HSK list the learner is climbing and the level they're aiming at —
  // the readiness mark's target. 7 means the 7–9 band and only exists on 3.0;
  // the pair is checked together below because "2.0 level 7" is not a thing.
  hskVersion: z.enum(HSK_VERSIONS).nullable().optional(),
  hskTarget: z.number().int().min(1).max(7).nullable().optional(),
  // The exam day as the calendar picked it ("2026-11-22"). A past day is allowed:
  // the plan says the date has gone by rather than the save failing.
  examDate: z
    .string()
    .regex(/^20\d\d-\d\d-\d\d$/)
    .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)))
    .nullable()
    .optional(),
});

export type LearnerPrefs = z.infer<typeof learnerPrefsSchema>;

/** The columns to `select` wherever the prefs are read. */
export const learnerPrefsSelect = {
  levels: true,
  nativeLang: true,
  dailyGoal: true,
  retention: true,
  hskVersion: true,
  hskTarget: true,
  examDate: true,
} as const;

/** Keep the target on its list's ladder: HSK 2.0 has no level 7. */
export function clampHskTarget(version: HskVersion | null | undefined, target: number): number {
  const max = version ? HSK_MAX_LEVEL[version] : 7;
  return Math.min(Math.max(target, 1), max);
}

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
