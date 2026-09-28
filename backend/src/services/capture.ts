import { z } from "zod";
import { prisma } from "./db.js";
import { chatJson } from "./llm.js";
import { enrichWordEntry } from "../agents/enrich.js";
import { langName } from "../lib/langs.js";
import { cedictCard, isCedictGloss, isChinese } from "./cedict.js";
import { defaultMeaning, isDefaultMeaning } from "./lookup.js";
import { MAX_UNKNOWN, addPoolExample, exampleBrief, holdToLevel, isPoolSentence, pickPoolSentence, poolRegister, writtenLabel } from "./sentences.js";
import { hskPage } from "./wordPages.js";

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

/**
 * The fields the dictionary fills with no model call, or null (not Chinese, not
 * in the subset). The meaning is the shared default in the learner's language
 * when there is one (services/lookup.ts), else the dictionary's English.
 */
export async function dictCardFields(
  word: string,
  sourceLang: string,
  targetLang: string,
): Promise<{ phonetic: string; meaningZh: string } | null> {
  if (!isChinese(sourceLang)) return null;
  const card = await cedictCard(word);
  return card ? { phonetic: card.phonetic, meaningZh: defaultMeaning(word, targetLang) ?? card.gloss } : null;
}

/**
 * Is the card's meaning still the dictionary's English placeholder? Derived on
 * read like the HSK badge, never stored: the client labels it and polls for the
 * upgrade, and the upgrade knows it may replace it.
 */
export function hasDictMeaning(w: { word: string; sourceLang: string; meaningZh: string | null }): boolean {
  return isChinese(w.sourceLang) && isCedictGloss(w.word, w.meaningZh);
}

const batchMeaningSchema = z.object({
  items: z.array(z.object({ word: z.string(), meaning: z.string().default("") })).default([]),
});

/**
 * The meaning in the learner's language for a batch of fresh dictionary cards,
 * in ONE model call ahead of the per-card upgrades. Those run one after another
 * at ~6 s each, so the 20 words of an onboarding plan sat in English for two
 * minutes — and English is a third language to a Russian speaker. Grounded like
 * the upgrade: the model gets the dictionary's senses and the sentence the word
 * came from, and only picks and translates. The upgrade then leaves the meaning
 * alone (it replaces only an empty one or the dictionary's English) and adds the
 * rest. An English speaker's card is already in their language.
 */
export async function translateDictMeanings(cardIds: string[]): Promise<void> {
  const cards = await prisma.word.findMany({
    where: { id: { in: cardIds } },
    include: { examples: { orderBy: { createdAt: "asc" }, select: { sentenceEn: true, sourceName: true } } },
  });
  const todo = cards.filter((c) => c.targetLang !== "en" && hasDictMeaning(c));
  const byTarget = new Map<string, typeof todo>();
  for (const c of todo) byTarget.set(c.targetLang, [...(byTarget.get(c.targetLang) ?? []), c]);

  for (const [target, group] of byTarget) {
    for (let i = 0; i < group.length; i += 25) {
      const chunk = group.slice(i, i + 25);
      const lines = chunk.map((c) => {
        const met = c.examples.find((e) => e.sourceName !== AI_SOURCE)?.sentenceEn;
        return { word: c.word, pinyin: c.phonetic ?? "", senses: c.meaningZh ?? "", ...(met ? { sentence: met } : {}) };
      });
      const r = await chatJson({
        system:
          `You write flashcard meanings for a ${langName(target)} speaker learning Chinese. For each item, give the ` +
          `word's meaning in ${langName(target)}: 1–4 words, the sense its sentence uses when a sentence is given, ` +
          `otherwise its most common sense. Base it on the English dictionary senses given — pick and translate, ` +
          `don't invent. Keep the words exactly as given. ` +
          'Respond as JSON: {"items":[{"word": string, "meaning": string}]}.',
        user: JSON.stringify(lines),
        schema: batchMeaningSchema,
        label: "capture.batchMeaning",
      });
      const meaningOf = new Map((r.items ?? []).map((it) => [it.word.trim(), (it.meaning ?? "").trim()]));
      for (const c of chunk) {
        const meaning = meaningOf.get(c.word);
        // Compare-and-set, like the upgrade: an edit made meanwhile wins.
        if (meaning) await prisma.word.updateMany({ where: { id: c.id, meaningZh: c.meaningZh }, data: { meaningZh: meaning } });
      }
    }
  }
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
 * Examples are one step above the learner (services/sentences.ts). An HSK word
 * has the pool's checked sentence at their level the moment it is added; this
 * writes their own on top — their interests, their register, their level —
 * which goes first. It is held to one unknown like the pool; one that stays
 * over the line gives way to the pool sentence rather than join it.
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
  // Only the pool's sentence on it (placed at add) still counts as "no example of its own".
  const pooled = card.examples.filter((e) => isPoolSentence(card.word, card.targetLang, e.sentenceEn)).length;
  const withExample = opts.withExample !== false && opts.exampleStyle !== "none" && card.examples.length === pooled;
  const brief = withExample ? await exampleBrief(card.userId, card.sourceLang, card.id) : null;
  // The pool's sentence first, when the add path didn't place one (the import
  // worker, "fill this in"). A typed sense asks for that sense, which the pool's
  // everyday one may not be.
  const pool =
    brief?.reading && !pooled && poolRegister(opts.exampleStyle) && !opts.sense
      ? pickPoolSentence(card.word, brief.reading.knows, card.targetLang)
      : null;
  const placed = Boolean(pool && pool.unknown <= MAX_UNKNOWN);
  if (placed) await addPoolExample(card.id, card.word, pool!.s);
  const hasPool = pooled > 0 || placed;
  // Their own on top of it only when there is something to make it theirs with.
  const personal = withExample && (!hasPool || Boolean(brief?.themes || brief?.reading?.checked));

  const entry = await enrichWordEntry({
    word: card.word,
    sourceLang: card.sourceLang,
    targetLang: card.targetLang,
    level: opts.level,
    synonymLevel: opts.synonymLevel,
    exampleStyle: opts.exampleStyle,
    withExample: personal,
    meaningInstruction: opts.meaningInstruction,
    sense: opts.sense,
    context: met,
    knownWords: brief?.knownWords ?? [],
    hskLevel: brief?.reading?.checked ? (brief.reading.level ?? 1) : null,
    themes: brief?.themes,
  });

  // Compare-and-set on the meaning we read: a learner who edited it while the
  // model was thinking keeps their edit. The shared default gives way only to a
  // sense the learner pointed at — the sentence they met the word in, or the
  // meaning they typed to find it; otherwise the model would just reword it.
  const replaceable = hasDictMeaning(card) || (isDefaultMeaning(card) && Boolean(met || opts.sense));
  if (entry.meaningZh.trim() && (!card.meaningZh?.trim() || replaceable)) {
    await prisma.word.updateMany({
      where: { id: card.id, meaningZh: card.meaningZh },
      data: { meaningZh: entry.meaningZh.trim() },
    });
  }
  // The example before the details: the pages poll until the part of speech lands,
  // so their own sentence has to be there by then to be seen without a reload.
  if (personal && entry.example && brief) {
    const held = await holdToLevel({
      word: card.word,
      sentence: entry.example,
      translation: entry.exampleTranslation,
      targetLang: card.targetLang,
      brief,
    });
    if (hasPool && held.unknown > MAX_UNKNOWN) {
      // Too hard to sit beside a checked one they can read: the pool's stays alone.
    } else if (!hasPool && pool && pool.unknown < held.unknown) {
      // Over the line either way: the pool's best still wins if they read more of it.
      await addPoolExample(card.id, card.word, pool.s);
    } else {
      // Newest first on every page, so their own leads.
      await prisma.example.create({
        data: {
          wordId: card.id,
          sentenceEn: held.sentence,
          sentenceZh: held.translation,
          sourceName: AI_SOURCE,
          sourceUrl: "",
          register: opts.exampleStyle ?? "casual",
          level: writtenLabel(brief, opts.level ?? null),
        },
      });
    }
  }
  // An HSK word's part of speech and family are its page's, the same for everyone
  // (services/wordPages.ts); the model's stand in for the words off the lists.
  const page = isChinese(card.sourceLang) ? hskPage(card.word, card.targetLang) : null;
  await prisma.word.update({
    where: { id: card.id },
    data: {
      ...(card.phonetic ? {} : { phonetic: entry.phonetic || null }),
      ...(card.partOfSpeech ? {} : { partOfSpeech: page?.pos || entry.partOfSpeech || null }),
      ...(card.collocations.length ? {} : { collocations: entry.collocations }),
      ...(card.synonyms.length ? {} : { synonyms: page ? page.syn : entry.synonyms }),
      ...(card.antonyms.length ? {} : { antonyms: page ? page.ant : entry.antonyms }),
    },
  });
}
