import { prisma } from "./db.js";
import {
  asHskVersion,
  clampLevel,
  dayStart,
  frontierInputs,
  frontierOrder,
  hskLevelWords,
  hskReading,
  hskTagFor,
  normalizeHanzi,
  type HskVersion,
  type HskWord,
} from "./hsk.js";
import { hskDailyWords, nextGroup, type GroupWord } from "./wordGroups.js";
import { dictCardFields, pageCardFields } from "./capture.js";
import { exampleLevel, pickPoolSentence, poolExample } from "./sentences.js";
import { recordReview, recordWriting, shapeWord, undoLastReview } from "./vocab.js";
import { importWordsForUser } from "./importWords.js";
import { savePlacementAnswers } from "./learnerPrefs.js";
import { hskSituations, type Situation } from "./wordPages.js";

/**
 * New words in Flashcards and Writing without adding them first (BACKLOG 1e,
 * PLAN-word-groups.md part 3): "make the whole day for Chinese". The words come
 * from the dictionary as ready-made cards — meaning, pinyin, page, the pool's
 * sentence — and none is written to the account until its first grade, so the list
 * only holds words actually studied and a quit session adds nothing unseen.
 */

/** An id the client can tell from a card's: a dictionary word not yet on the account. */
export const NEW_PREFIX = "new:";

/**
 * The next new words: what is left of today's group first (the same choice Today
 * offers), then, once today's are taken, the group after it.
 */
export async function hskNextWords(
  telegramId: string,
  n: number,
): Promise<{ version: HskVersion; level: number; theme: Situation | null; words: GroupWord[] }> {
  const day = await hskDailyWords(telegramId);
  const { version, level } = day;
  const left = day.words.filter((w) => !w.added);
  if (left.length) return { version, level, theme: day.theme, words: left.slice(0, n).map(({ added: _, ...w }) => w) };
  const input = await frontierInputs(telegramId);
  if (!input) return { version, level, theme: null, words: [] };
  const today = new Set(day.words.map((w) => w.word));
  const order = frontierOrder(version, level, (w) => input.status.has(w) || today.has(w), input.tapped, input.have);
  const group = nextGroup(order, n, new Set(), input.tapped);
  return { version, level, theme: group.theme, words: group.words };
}

/**
 * The whole level in Flashcards (the author, 2026-10-15: "I just see all words and
 * scroll HSK 4"): every word of the learner's level with no card and no "I know it",
 * in the frontier's order — the words they said they don't know first, then the most
 * useful. Light (word, pinyin); Flashcards asks for a few at a time as cards
 * (`levelCards`), so a session of 900 words starts at once.
 */
export async function hskLevelLeft(
  telegramId: string,
): Promise<{ version: HskVersion; level: number; total: number; words: HskWord[] }> {
  const input = await frontierInputs(telegramId);
  const version = asHskVersion(input?.user.hskVersion) ?? "3.0";
  const level = clampLevel(version, input?.user.hskTarget ?? 4);
  const total = hskLevelWords(version, level).length;
  if (!input) return { version, level, total, words: [] };
  const order = frontierOrder(version, level, (w) => input.status.has(w), input.tapped, input.have);
  return { version, level, total, words: order.filter((w) => w.level === level) };
}

/** List words as ready-made cards, as /hsk/next gives them. A word on neither list is left out. */
export async function levelCards(telegramId: string, words: string[]) {
  const listed = words
    .map(normalizeHanzi)
    .filter((w, i, all) => w && all.indexOf(w) === i)
    .flatMap((w) => {
      const tag = hskTagFor(w);
      if (!tag) return [];
      return [{ word: w, pinyin: hskReading(w) ?? "", level: tag["3.0"] ?? tag["2.0"] ?? 0, situation: hskSituations(w)[0] ?? null }];
    });
  return readyCards(telegramId, listed);
}

/** The words as cards the review and writing screens can show: everything an add would write, nothing written. */
export async function readyCards(telegramId: string, words: GroupWord[]) {
  const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true, nativeLang: true } });
  if (!user) return [];
  const native = user.nativeLang ?? "ru";
  const at = await exampleLevel(user.id);
  const now = new Date();
  return Promise.all(
    words.map(async (w) => {
      const id = `${NEW_PREFIX}${w.word}`;
      const dict = await dictCardFields(w.word, "zh", native);
      const page = pageCardFields(w.word, "zh", native);
      const pick = pickPoolSentence(w.word, at, native);
      return {
        ...shapeWord({
          id,
          userId: user.id,
          word: w.word,
          sourceLang: "zh",
          targetLang: native,
          phonetic: dict?.phonetic ?? w.pinyin,
          partOfSpeech: page?.partOfSpeech || null,
          meaningZh: dict?.meaningZh ?? null,
          collocations: page?.collocations ?? [],
          synonyms: page?.synonyms ?? [],
          antonyms: page?.antonyms ?? [],
          notes: null,
          senses: null,
          reviewCount: 0,
          nextReviewAt: null,
          stability: null,
          difficulty: null,
          due: null,
          reps: 0,
          lapses: 0,
          state: 0,
          learningSteps: 0,
          lastReview: null,
          writeStability: null,
          writeDue: null,
          createdAt: now,
          examples: pick ? [{ id: `${id}:ex`, wordId: id, createdAt: now, ...poolExample(w.word, pick) }] : [],
          collections: [],
        }),
        situation: w.situation,
      };
    }),
  );
}

async function cardOf(userId: string, word: string) {
  return prisma.word.findFirst({ where: { userId, word, sourceLang: "zh" }, orderBy: { createdAt: "desc" }, select: { id: true } });
}

/**
 * A new word's first grade, in one call: the ready-made card (the add with no
 * model call) and the grade on it — on the reading schedule from Flashcards, on the
 * writing one from Writing, whose reading schedule then starts as a new card.
 * "Easy" on first sight in Flashcards is "I know it": the sweep's status, no card.
 * A word that is a card already (an "Again" earlier in the session) is just graded.
 */
export async function learnWord(
  telegramId: string,
  p: { word: string; grade: 1 | 2 | 3 | 4; source: "review" | "write"; retention?: number; tz?: string },
): Promise<{ known: true } | { card: ReturnType<typeof shapeWord> }> {
  const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true, nativeLang: true, hskTarget: true } });
  if (!user) throw new Error("No such account");
  const native = user.nativeLang ?? "ru";
  let card = await cardOf(user.id, p.word);
  if (!card && p.source === "review" && p.grade === 4) {
    await savePlacementAnswers(telegramId, { sourceLang: "zh", targetLang: native, known: [p.word], unknown: [] });
    return { known: true };
  }
  if (!card) {
    await importWordsForUser({
      telegramId,
      sourceLang: "zh",
      targetLang: native,
      items: [{ word: p.word, meaning: "", example: "", exampleTranslation: "", synonyms: [] }],
      level: user.hskTarget != null ? String(user.hskTarget) : undefined,
      generateDetails: false,
      generateExamples: false,
      poolExamples: true,
    });
    // Taken, as Today's words are: not a claim until this first review says whether it was new.
    await savePlacementAnswers(telegramId, { sourceLang: "zh", targetLang: native, known: [], unknown: [], took: [p.word] });
    card = await cardOf(user.id, p.word);
    if (!card) throw new Error("The card could not be made");
  }
  if (p.source === "write") await recordWriting(card.id, p.grade, p.retention, p.tz);
  else await recordReview(card.id, p.grade, p.retention, "review", p.tz);
  const row = await prisma.word.findUniqueOrThrow({
    where: { id: card.id },
    include: { examples: { orderBy: { createdAt: "desc" } }, collections: { select: { id: true, name: true } } },
  });
  return { card: shapeWord(row) };
}

/**
 * Undo of a first grade (Flashcards' Undo): as if it never happened. The grade
 * comes off; a card that grade made, with no other review on it, goes, and so do
 * the day's "taken" or "I know it" answers that came with it.
 */
export async function unlearnWord(telegramId: string, word: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  if (!user) return false;
  const today = { gte: dayStart() };
  const card = await cardOf(user.id, word);
  if (card) {
    if (!(await undoLastReview(card.id))) return false;
    const reviewed = await prisma.reviewEvent.count({ where: { wordId: card.id } });
    const madeToday = await prisma.word.count({ where: { id: card.id, createdAt: today } });
    if (!reviewed && madeToday) {
      await prisma.word.delete({ where: { id: card.id } });
      await prisma.placementAnswer.deleteMany({ where: { userId: user.id, word, sourceLang: "zh", took: true, createdAt: today } });
    }
    return true;
  }
  const { count } = await prisma.placementAnswer.deleteMany({
    where: { userId: user.id, word, sourceLang: "zh", known: true, createdAt: today },
  });
  return count > 0;
}
