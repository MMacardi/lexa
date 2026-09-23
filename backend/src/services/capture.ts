import { prisma } from "./db.js";
import { enrichWordEntry } from "../agents/enrich.js";
import { cedictCard, isCedictGloss, isChinese } from "./cedict.js";

/**
 * Instant capture: the dictionary makes the card, the model comes second.
 *
 * A word the learner meets has to be a reviewable card by the time the tap
 * returns — capture slower than "Pleco lookup + star" is the first thing
 * STRATEGY §E says kills the product. So a Chinese word CC-CEDICT knows is
 * written at once with its pinyin and the dictionary's English gloss, and the
 * model runs after, only for what a dictionary can't do: the meaning in the
 * learner's language, the sense the source sentence uses, an example made of
 * words they already have. It upgrades the card; it never gates it, and a
 * failed or cancelled upgrade leaves a card that is still usable.
 */

const AI_SOURCE = "Onomika AI";

/** The fields the dictionary fills with no model call, or null (not Chinese, not in the subset). */
export async function dictCardFields(word: string, sourceLang: string): Promise<{ phonetic: string; meaningZh: string } | null> {
  if (!isChinese(sourceLang)) return null;
  const card = await cedictCard(word);
  return card ? { phonetic: card.phonetic, meaningZh: card.gloss } : null;
}

/**
 * Is the card's meaning still the dictionary's English placeholder? Derived on
 * read like the HSK badge, never stored: the client labels it and polls for the
 * upgrade, and the upgrade knows it may replace it.
 */
export function hasDictMeaning(w: { word: string; sourceLang: string; meaningZh: string | null }): boolean {
  return isChinese(w.sourceLang) && isCedictGloss(w.word, w.meaningZh);
}

export type UpgradeOptions = {
  level?: string;
  synonymLevel?: string;
  exampleStyle?: string;
  withExample?: boolean; // default true; only ever adds one to a card that has none
  meaningInstruction?: string;
  sense?: string;
};

/**
 * Fill in what a card is missing with one grounded model call: the meaning when
 * it is empty or still the dictionary's English, the details it has none of,
 * and an example when it has none. Never overwrites what the learner wrote.
 * Shared by the add path (in the background), the import worker, and the word
 * page's "fill this in" (`POST /api/words/:id/enrich`).
 */
export async function upgradeCard(wordId: string, opts: UpgradeOptions = {}): Promise<void> {
  const card = await prisma.word.findUnique({
    where: { id: wordId },
    include: { examples: { orderBy: { createdAt: "asc" }, select: { sentenceEn: true, sourceName: true } } },
  });
  if (!card) return;
  // The sentence the learner met the word in: a Reader, import or hand-typed
  // example, never one the model wrote for it.
  const met = card.examples.find((e) => e.sourceName !== AI_SOURCE)?.sentenceEn;
  const withExample = opts.withExample !== false && opts.exampleStyle !== "none" && card.examples.length === 0;
  const known = withExample
    ? (
        await prisma.word.findMany({
          where: { userId: card.userId, sourceLang: card.sourceLang, NOT: { id: card.id } },
          orderBy: [{ reps: "desc" }, { createdAt: "desc" }],
          take: 40,
          select: { word: true },
        })
      ).map((w) => w.word)
    : [];

  const entry = await enrichWordEntry({
    word: card.word,
    sourceLang: card.sourceLang,
    targetLang: card.targetLang,
    level: opts.level,
    synonymLevel: opts.synonymLevel,
    exampleStyle: opts.exampleStyle,
    withExample,
    meaningInstruction: opts.meaningInstruction,
    sense: opts.sense,
    context: met,
    knownWords: known,
  });

  // Compare-and-set on the meaning we read: a learner who edited it while the
  // model was thinking keeps their edit.
  if (entry.meaningZh.trim() && (!card.meaningZh?.trim() || hasDictMeaning(card))) {
    await prisma.word.updateMany({
      where: { id: card.id, meaningZh: card.meaningZh },
      data: { meaningZh: entry.meaningZh.trim() },
    });
  }
  await prisma.word.update({
    where: { id: card.id },
    data: {
      ...(card.phonetic ? {} : { phonetic: entry.phonetic || null }),
      ...(card.partOfSpeech ? {} : { partOfSpeech: entry.partOfSpeech || null }),
      ...(card.collocations.length ? {} : { collocations: entry.collocations }),
      ...(card.synonyms.length ? {} : { synonyms: entry.synonyms }),
      ...(card.antonyms.length ? {} : { antonyms: entry.antonyms }),
    },
  });
  if (withExample && entry.example) {
    await prisma.example.create({
      data: {
        wordId: card.id,
        sentenceEn: entry.example,
        sentenceZh: entry.exampleTranslation,
        sourceName: AI_SOURCE,
        sourceUrl: "",
        register: opts.exampleStyle ?? "casual",
        level: opts.level ?? null,
      },
    });
  }
}
