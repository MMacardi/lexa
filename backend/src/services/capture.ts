import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { chatJson } from "./llm.js";
import { enrichWordEntry } from "../agents/enrich.js";
import { langName } from "../lib/langs.js";
import { hasLocalPhonetic, localPhonetic } from "../lib/transcribe.js";
import { cedictCard, isCedictGloss, isChinese } from "./cedict.js";
import { defaultMeaning, isDefaultMeaning } from "./lookup.js";
import {
  MAX_UNKNOWN,
  addPoolExample,
  exampleBrief,
  holdToLevel,
  isFormalWord,
  isPoolSentence,
  keepIfNatural,
  pickPoolSentence,
  poolRegister,
  sentenceWords,
  unknownIn,
  writtenLabel,
} from "./sentences.js";
import { headGloss, hskPage, readsAs } from "./wordPages.js";

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
 * The pinyin a card is written with, never a model's: the dictionary's reading,
 * else pinyin-pro's (a word CC-CEDICT doesn't have — 拮据的 — or one added with
 * its meaning typed). Such a card used to wait for the upgrade's last write for
 * its pinyin, and showed none when that never came (2026-10-02).
 */
export async function cardPhonetic(word: string, sourceLang: string): Promise<string | null> {
  if (isChinese(sourceLang)) {
    const card = await cedictCard(word, { count: false });
    if (card) return card.phonetic;
  }
  return localPhonetic(word, sourceLang);
}

/** Cards opened with no pinyin get theirs now (see `cardPhonetic`). Called before a card is read. */
export async function fillMissingPhonetic(id: string): Promise<void> {
  const w = await prisma.word.findUnique({ where: { id }, select: { word: true, sourceLang: true, phonetic: true } });
  if (!w || w.phonetic?.trim() || !hasLocalPhonetic(w.sourceLang)) return;
  const phonetic = await cardPhonetic(w.word, w.sourceLang);
  if (phonetic) await prisma.word.updateMany({ where: { id, phonetic: w.phonetic }, data: { phonetic } });
}

// The pinyin a card used to be made with, per word, where the dictionary has since
// read it otherwise (data/card-pinyin-old.jsonl, scripts/card-pinyin-moves.ts).
let oldPinyin: Map<string, Set<string>> | null = null;

function oldPinyinIndex(): Map<string, Set<string>> {
  if (oldPinyin) return oldPinyin;
  oldPinyin = new Map();
  const path = fileURLToPath(new URL("../../data/card-pinyin-old.jsonl", import.meta.url));
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return oldPinyin;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim(); // CRLF on a Windows checkout
    if (!line) continue;
    const row = JSON.parse(line) as { w?: string; o?: string[] };
    if (row.w && row.o?.length) oldPinyin.set(row.w, new Set(row.o));
  }
  return oldPinyin;
}

/**
 * Cards still carrying a pinyin the dictionary used to give them move to the
 * current one: an HSK card now reads as the list does (东西 dōng xī "east and
 * west" → dōng xi "thing", 告诉 gào sù → gào su, 盛 shèng → chéng), and an
 * English card whose meaning is still the old reading's gloss ("to press
 * charges") takes the new one's ("to tell"). A pinyin the learner typed is
 * never an old one, so it stays; so does a card whose meaning is in the old
 * reading's sense (a 盛 card kept as «процветающий» is still shèng). A card moved
 * to another word whose meaning is now the shared default takes that word's part
 * of speech too (盛 «накладывать» is a verb, «процветающий» was an adjective).
 * Called before a card or the list is read, after `refreshDefaultMeanings`.
 */
export async function refreshCardReadings(where: Prisma.WordWhereInput): Promise<number> {
  const old = oldPinyinIndex();
  if (!old.size) return 0;
  const cards = await prisma.word.findMany({
    where: { ...where, sourceLang: { in: ["zh", "zh-Hant"] }, word: { in: [...old.keys()] } },
    select: { id: true, word: true, sourceLang: true, targetLang: true, phonetic: true, meaningZh: true, partOfSpeech: true },
  });
  let n = 0;
  for (const c of cards) {
    const was = c.phonetic?.trim();
    if (!was || !old.get(c.word)?.has(was)) continue;
    const now = await cedictCard(c.word, { count: false });
    if (!now || now.phonetic === was) continue;
    const dictGloss = isCedictGloss(c.word, c.meaningZh);
    if (!dictGloss && meansOtherReading(c.word, c.meaningZh, was, now.phonetic)) continue;
    const meaning = dictGloss && c.meaningZh !== now.gloss ? { meaningZh: now.gloss } : {};
    const pos = !readsAs(c.word, was, now.phonetic) && isDefaultMeaning(c) ? hskPage(c.word, c.targetLang)?.pos : undefined;
    // Compare-and-set on what was read: an edit made meanwhile wins.
    n += (
      await prisma.word.updateMany({
        where: { id: c.id, phonetic: c.phonetic, meaningZh: c.meaningZh },
        data: { phonetic: now.phonetic, ...meaning, ...(pos && c.partOfSpeech && pos !== c.partOfSpeech ? { partOfSpeech: pos } : {}) },
      })
    ).count;
  }
  return n;
}

// Is the card's meaning a sense of the old reading and not the new one? Read off the
// word page: the sense its first segment opens (as the page ticks it, `headGloss`).
function meansOtherReading(word: string, meaning: string | null, was: string, now: string): boolean {
  if (readsAs(word, was, now) || !meaning?.trim()) return false;
  const head = headGloss(meaning.split(/[;；]/)[0] ?? "");
  const sense = hskPage(word, "ru")?.s.find((s) => headGloss(s.m) === head);
  return Boolean(sense && readsAs(word, sense.r, was) && !readsAs(word, sense.r, now));
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
  // A formal word (以, 之所以) has no natural everyday sentence: theirs is written, and
  // labelled, in the register the word lives in — unless they asked for another.
  const style = isChinese(card.sourceLang) && isFormalWord(card.word) && poolRegister(opts.exampleStyle) ? "news" : opts.exampleStyle;

  const entry = await enrichWordEntry({
    word: card.word,
    sourceLang: card.sourceLang,
    targetLang: card.targetLang,
    level: opts.level,
    synonymLevel: opts.synonymLevel,
    exampleStyle: style,
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
    let held = await holdToLevel({
      word: card.word,
      sentence: entry.example,
      translation: entry.exampleTranslation,
      targetLang: card.targetLang,
      brief,
    });
    // The word must be in it as a word, as the pool's are: 出发之前 has 之 only inside
    // 之前, and teaches 之前 (the author's 之 card, 2026-09-29). Then the editor's read.
    const chinese = isChinese(card.sourceLang);
    let ownWord = !chinese || sentenceWords(held.sentence, card.word).own;
    let checked = false;
    if (ownWord && chinese) {
      const kept = await keepIfNatural({ word: card.word, sentence: held.sentence, translation: held.translation, targetLang: card.targetLang });
      if (!kept) ownWord = false;
      else checked = !kept.unread;
      if (kept && kept.sentence !== held.sentence) {
        const reading = brief.reading;
        const unknown = reading?.checked ? unknownIn(sentenceWords(kept.sentence, card.word).words, reading.knows) : 0;
        held = { ...kept, unknown };
      }
    }
    if (!ownWord) {
      // Not saved: the pool's sentence stays alone, or "add example" writes another.
    } else if (hasPool && held.unknown > MAX_UNKNOWN) {
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
          register: style ?? "casual",
          level: writtenLabel(brief, opts.level ?? null),
          ...(checked ? { checkedAt: new Date() } : {}),
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
