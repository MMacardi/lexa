import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./db.js";
import { saveGeneratedExample } from "./exampleWrites.js";
import { contextNames } from "../lib/contextNames.js";
import { chatJson } from "./llm.js";
import { enrichWordEntry } from "../agents/enrich.js";
import { runExampleSearch } from "../agents/exampleSearch.js";
import { langName } from "../lib/langs.js";
import { hasLocalPhonetic, localPhonetic } from "../lib/transcribe.js";
import { cedictCard, isCedictGloss, isChinese } from "./cedict.js";
import { cardMeaning, isDefaultMeaning } from "./lookup.js";
import { cachedDictionary, localizedDictionary } from "./localizedDictionary.js";
import {
  addPoolExample,
  exampleBrief,
  isFormalWord,
  isPoolSentence,
  keepIfNatural,
  pickPoolSentence,
  poolRegister,
  sentenceWords,
  writtenLabel,
} from "./sentences.js";
import { headGloss, hskPage, readsAs, pageSenses, matchingSenseIndexes, type WordPage } from "./wordPages.js";

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
 * in the subset). The meaning is the shared default in the learner's language,
 * worded as its word page words it, when there is one (`cardMeaning` in
 * services/lookup.ts), else the dictionary's English.
 */
export async function dictCardFields(
  word: string,
  sourceLang: string,
  targetLang: string,
): Promise<{ phonetic: string; meaningZh: string } | null> {
  if (!isChinese(sourceLang)) return null;
  const card = await cedictCard(word);
  const prepared = cardMeaning(word, targetLang);
  const cached = card && !prepared ? await cachedDictionary(word, targetLang) : null;
  return card ? { phonetic: card.phonetic, meaningZh: prepared ?? cached?.meaning ?? card.gloss } : null;
}

/**
 * What an HSK word's page settles the moment the card is made, with no model call:
 * its part of speech, synonyms, antonyms, and its lead sense's phrases as the
 * collocations the Reader and a custom card layout show. Null off the lists.
 */
export function pageCardFields(
  word: string,
  sourceLang: string,
  targetLang: string,
): { partOfSpeech: string; collocations: string[]; synonyms: string[]; antonyms: string[] } | null {
  const page = isChinese(sourceLang) ? hskPage(word, targetLang) : null;
  if (!page) return null;
  return {
    partOfSpeech: page.pos,
    collocations: (page.s[0]?.p ?? []).slice(0, 3).map((p) => p.t),
    synonyms: page.syn,
    antonyms: page.ant,
  };
}

/**
 * The page sense a card is made in, when its meaning is one (背 «нести на себе,
 * таскать на спине», picked in the lookup or on the word page), as an example
 * prompt names it: the gloss with its reading and phrases. Told only «нести на
 * себе», the model wrote 背二十个单词 — the 背 it knows best (2026-10-06).
 */
export function cardSense(card: {
  word: string;
  sourceLang: string;
  targetLang: string;
  meaningZh: string | null;
}): { sense: string; anchor?: string; described: string; pos: string } | null {
  const m = card.meaningZh?.trim();
  const s = m && isChinese(card.sourceLang) ? hskPage(card.word, card.targetLang)?.s.find((x) => x.m === m) : undefined;
  if (!s) return null;
  const anchor = [s.r && `read ${s.r}`, s.p.length && `as in ${s.p.map((p) => p.t).join(", ")}`].filter(Boolean).join(", ");
  return { sense: s.m, ...(anchor ? { anchor } : {}), described: anchor ? `${s.m} (${anchor})` : s.m, pos: s.pos };
}

/**
 * The card for the word-page sense picked in the add form's lookup: 背 found by
 * «нести» is «нести на себе, таскать на спине» read bēi, not the default «спина;
 * нести на себе» under bèi; 背 found by «учить» is «учить наизусть». An explicit
 * pick keeps exactly that sense, including the default reading.
 * `sense` is the gloss the upgrade writes the example in — with its
 * clarifier («богатый (о ресурсах, чувствах)»), which is what tells the senses apart.
 */
export function pickedSense(
  word: string,
  targetLang: string,
  index: number,
  card: { phonetic: string; meaningZh: string },
): { phonetic: string; meaningZh: string; sense: string } | null {
  const page = hskPage(word, targetLang);
  const s = page?.s[index];
  if (!page || !s) return null;
  return {
    phonetic: s.r && !readsAs(page.w, s.r, card.phonetic) ? s.r : card.phonetic,
    meaningZh: s.m,
    sense: s.m.split(/\s*[,;]\s*(?![^(]*\))/)[0],
  };
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
    include: { examples: { orderBy: { createdAt: "asc" }, select: { sentenceEn: true, sourceName: true, captured: true } } },
  });
  const pending = cards.filter((c) => c.targetLang !== "en" && hasDictMeaning(c));
  // Russian dictionary cards use the same cached adaptation as the lookup, not
  // another prompt's independently worded translation.
  for (const c of pending.filter((c) => c.targetLang === "ru")) {
    const entry = await localizedDictionary(c.word, c.targetLang);
    if (!entry) continue;
    const met = c.examples.find((e) => e.captured || e.sourceName !== AI_SOURCE)?.sentenceEn;
    let selected: number | undefined;
    if (met) {
      const r = await chatJson({
        system: 'Choose the dictionary sense used by the Chinese word in the sentence. ' +
          'Return its 1-based number, or 0 for a use absent from the dictionary (including personal names). JSON: {"n":1}.',
        user: JSON.stringify({ word: c.word, sentence: met, senses: entry.senses.map((s) => s.meaning) }),
        schema: z.object({ n: z.number().int().min(0) }), label: "capture.pageSense",
      });
      if (r.n < 1 || r.n > entry.senses.length) continue; // Let contextual enrichment fill an actual gap.
      selected = r.n - 1;
    }
    const meaning = selected === undefined ? entry.meaning : entry.senses[selected].meaning;
    await prisma.word.updateMany({ where: { id: c.id, meaningZh: c.meaningZh, phonetic: c.phonetic,
      senses: { equals: c.senses ?? Prisma.DbNull } }, data: { meaningZh: meaning,
        ...(selected === undefined ? {} : { phonetic: entry.senses[selected].reading ?? entry.phonetic }),
        senses: { v: 5, list: entry.senses.map((s, i) => ({ ...s, onCard: selected === undefined ? s.onCard : i === selected })),
          grounded: true, ...(selected === undefined ? {} : { for: meaning }) } as unknown as Prisma.InputJsonValue } });
  }
  const todo = pending.filter((c) => c.targetLang !== "ru");
  const byTarget = new Map<string, typeof todo>();
  for (const c of todo) byTarget.set(c.targetLang, [...(byTarget.get(c.targetLang) ?? []), c]);

  for (const [target, group] of byTarget) {
    for (let i = 0; i < group.length; i += 25) {
      const chunk = group.slice(i, i + 25);
      const lines = chunk.map((c) => {
        const met = c.examples.find((e) => e.captured || e.sourceName !== AI_SOURCE)?.sentenceEn;
        return { word: c.word, pinyin: c.phonetic ?? "", senses: c.meaningZh ?? "", ...(met ? { sentence: met } : {}) };
      });
      const r = await chatJson({
        system:
          `You write flashcard meanings for a ${langName(target)} speaker learning Chinese. For each item, give the ` +
          `word's meaning in ${langName(target)}: 1–4 words, the sense its sentence uses when a sentence is given, ` +
          `otherwise its most common sense. Base it on the English dictionary senses given — pick and translate, ` +
          `don't invent, except personal names clearly established by a sentence, which can be absent from a dictionary. ` + contextNames + `Keep the words exactly as given. ` +
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

const pageSenseSchema = z.object({ items: z.array(z.object({ n: z.number().int() })) });

/**
 * A meaning that came with the word — a Reader tap's gloss of the sentence it was
 * met in, an offer of Mika's — is that moment's wording, not its word page's: 响应
 * came in as «ответ», and its page, whose senses are «откликаться (на призыв)» and
 * «реагировать, отвечать на запрос», ticked neither (the author, 2026-10-14). So
 * for a word with a page, one model call names the page sense each such meaning
 * is (in its sentence, when there is one). Store that mapping while preserving
 * the contextual wording, with its reading where that sense reads otherwise. A meaning that is
 * none of them stays, as does one changed meanwhile. Runs after the add returns:
 * the card is reviewable at once either way.
 */
export async function fitMeaningsToPages(cards: { id: string; word: string; meaning: string; sentence?: string }[], targetLang: string) {
  const todo = (await Promise.all(cards.map(async (c) => {
    let page = hskPage(c.word, targetLang);
    if (!page) {
      const shared = await localizedDictionary(c.word, targetLang);
      if (shared) page = { w: c.word, pos: "", syn: [], ant: [], s: shared.senses.map((s) => ({
        r: s.reading ?? shared.phonetic, pos: s.pos ?? "", m: s.meaning, g: [], p: [],
      })) } satisfies WordPage;
    }
    // Already one of the page's senses (in its wording or by its head word).
    if (!page || !c.meaning.trim() || matchingSenseIndexes(page.s.map((s) => s.m), c.meaning).length) return null;
    const snapshot = await prisma.word.findUnique({ where: { id: c.id }, select: { phonetic: true, senses: true } });
    if (!snapshot || (snapshot.senses as { for?: string } | null)?.for === c.meaning) return null;
    return { ...c, page, snapshot };
  }))).filter((c) => c !== null);
  if (!todo.length) return;
  const picks = new Map<string, number>();
  const ask = todo;
  for (let i = 0; i < ask.length; i += 20) {
    const chunk = ask.slice(i, i + 20);
    const r = await chatJson({
      system:
        `Each item is a Chinese word, the ${langName(targetLang)} meaning a learner was shown for it, sometimes the ` +
        `sentence it was met in, and the word's senses as its dictionary page lists them, numbered from 1. Say which ` +
        `listed sense that meaning is (as the word is used in the sentence, when one is given): its number, or 0 when ` +
        `it is none of them. A contextual personal name can be absent from the page: choose 0 in that case. ` + contextNames +
        `Answer for every item, in order. Respond as JSON: {"items":[{"n": number}]}.`,
      user: JSON.stringify(
        chunk.map((c) => ({
          word: c.word,
          shown: c.meaning,
          ...(c.sentence ? { sentence: c.sentence } : {}),
          senses: c.page.s.map((s, k) => `${k + 1}. ${s.m}`),
        })),
      ),
      schema: pageSenseSchema,
      label: "capture.pageSense",
    });
    chunk.forEach((c, k) => {
      const n = r.items[k]?.n ?? 0;
      if (n >= 1 && n <= c.page.s.length) picks.set(c.id, n - 1);
    });
  }
  for (const c of todo) {
    const at = picks.get(c.id);
    if (at === undefined) continue;
    const s = c.page.s[at];
    const card = c.snapshot;
    const reading = s.r && card?.phonetic && !readsAs(c.page.w, s.r, card.phonetic) ? { phonetic: s.r } : {};
    // Compare-and-set: an edit made meanwhile wins.
    await prisma.word.updateMany({ where: { id: c.id, meaningZh: c.meaning, phonetic: card.phonetic,
      senses: { equals: card.senses ?? Prisma.DbNull } }, data: { ...reading,
        senses: { v: 5, for: c.meaning, grounded: true,
          list: pageSenses(c.page, reading.phonetic ?? card.phonetic).map((sense, i) => ({ ...sense, onCard: i === at }))
        } as unknown as Prisma.InputJsonValue } });
  }
}

const NO_ENTRY = { phonetic: "", partOfSpeech: "", meaningZh: "", collocations: [], synonyms: [], antonyms: [], example: "", exampleTranslation: "" };

export type UpgradeOptions = {
  level?: string;
  synonymLevel?: string;
  exampleStyle?: string;
  withExample?: boolean; // default true; complete the pair unless the learner edited/removed examples
  meaningInstruction?: string;
  sense?: string;
};

/**
 * Fill in what a card is missing with one grounded model call: the meaning when
 * it is empty or still the dictionary's English, the details it has none of,
 * and completes its example pair. Never overwrites what the learner wrote.
 * Examples are at the level the learner chose (services/sentences.ts). A card
 * holds two by default (the author, 2026-10-09: "one prebuilt, one personalized"):
 * an HSK word has the pool's checked sentence at their level the moment it is
 * added, and this writes their own on top — their interests, their register —
 * which goes first. A word the pool has no sentence for gets two of its own.
 * Shared by the add path (in the background), the import worker, and the word
 * page's "fill this in" (`POST /api/words/:id/enrich`).
 */
export async function upgradeCard(wordId: string, opts: UpgradeOptions = {}): Promise<void> {
  let card = await prisma.word.findUnique({
    where: { id: wordId },
    include: { examples: { orderBy: { createdAt: "asc" }, select: { sentenceEn: true, sourceName: true, captured: true } } },
  });
  if (!card) return;
  if (card.targetLang === "ru" && hasDictMeaning(card)) {
    await translateDictMeanings([wordId]);
    card = await prisma.word.findUnique({ where: { id: wordId },
      include: { examples: { orderBy: { createdAt: "asc" }, select: { sentenceEn: true, sourceName: true, captured: true } } } });
    if (!card) return;
  }
  // Original context also includes a sentence intentionally captured from Mika.
  const met = card.examples.find((e) => e.captured || e.sourceName !== AI_SOURCE)?.sentenceEn;
  // Only the pool's sentence on it (placed at add) still counts as "no example of its own".
  const pooled = card.examples.filter((e) => isPoolSentence(card.word, card.targetLang, e.sentenceEn)).length;
  const hasPersonal = card.examples.some((e) => !e.captured && e.sourceName === AI_SOURCE && !isPoolSentence(card.word, card.targetLang, e.sentenceEn));
  const withExample = card.autoExamples && opts.withExample !== false && opts.exampleStyle !== "none" &&
    (!met || card.examples.length < 2) && !hasPersonal;
  const brief = withExample ? await exampleBrief(card.userId, card.sourceLang, card.id) : null;
  // The pool's sentence first, when the add path didn't place one (the import
  // worker, "fill this in"). A typed sense asks for that sense, which the pool's
  // everyday one may not be.
  const pool =
    brief && !met && isChinese(card.sourceLang) && !pooled && poolRegister(opts.exampleStyle) && !opts.sense
      ? pickPoolSentence(card.word, brief, card.targetLang)
      : null;
  if (pool) await addPoolExample(card.id, card.word, pool, card.exampleRevision);
  const L = brief?.level ?? null;
  // Their own always goes on top of the pool's. It used to be written only when
  // there were interests to make it theirs with, or the pool's sentence was off
  // their level, so most cards had the pool's alone and a second was Pro.
  const personal = withExample;
  // A formal word (以, 之所以) has no natural everyday sentence: theirs is written, and
  // labelled, in the register the word lives in — unless they asked for another.
  const style = !met && isChinese(card.sourceLang) && isFormalWord(card.word) && poolRegister(opts.exampleStyle) ? "news" : opts.exampleStyle;
  const page = isChinese(card.sourceLang) ? hskPage(card.word, card.targetLang) : null;
  const adapted = !page && isChinese(card.sourceLang) ? await cachedDictionary(card.word, card.targetLang) : null;
  const stored = card.senses as { for?: string } | null;
  const pinned = stored?.for === card.meaningZh;
  // A card made in one of its page's senses (picked in the lookup) gets its example
  // in that sense, pinned by the sense's reading and phrases.
  const own = opts.sense || pinned ? cardSense(card) : null;
  const wantedSense = own?.sense ?? (pinned || (adapted && !met) ? card.meaningZh ?? undefined : opts.sense);
  // An HSK word with its page and the shared default meaning, and nothing pointing
  // at another sense: the meaning stays and the page has the details, so the full
  // entry would be thrown away. Only their own example is left to write — and no
  // call at all when the card takes no example.
  const settled = Boolean(page) && (isDefaultMeaning(card) || pinned) && !met;
  // What both calls write the example with: the level, their words and interests.
  const forExample = {
    level: opts.level,
    exampleStyle: style,
    knownWords: brief?.knownWords ?? [],
    hskLevel: L,
    hskVersion: brief?.version,
    themes: brief?.themes,
  };
  let entry;
  try {
    entry = settled
      ? personal
        ? await enrichWordEntry({
            word: card.word,
            sourceLang: card.sourceLang,
            targetLang: card.targetLang,
            withExample: true,
            exampleOnly: { meaning: card.meaningZh! },
            sense: own?.sense,
            senseAnchor: own?.anchor,
            ...forExample,
          })
        : NO_ENTRY
      : await enrichWordEntry({
          word: card.word,
          sourceLang: card.sourceLang,
          targetLang: card.targetLang,
          synonymLevel: opts.synonymLevel,
          withExample: personal,
          meaningInstruction: opts.meaningInstruction,
          sense: wantedSense,
          senseAnchor: own?.anchor,
          context: met,
          ...forExample,
        });

  } catch (error) {
    // Preserve a captured fragment verbatim. When generation is down, a checked
    // pool sentence can stand in only for the shared default sense/register.
    const fallback = withExample && met && isDefaultMeaning(card) && !opts.sense && poolRegister(opts.exampleStyle) && brief
      ? pickPoolSentence(card.word, brief, card.targetLang) : null;
    if (!fallback) throw error;
    await addPoolExample(card.id, card.word, fallback, card.exampleRevision);
    entry = NO_ENTRY;
  }

  // Compare-and-set on the meaning we read: a learner who edited it while the
  // model was thinking keeps their edit. The shared default gives way only to a
  // sense the learner pointed at — the sentence they met the word in, or the
  // meaning they typed to find it; otherwise the model would just reword it.
  const explicitSense = pinned || Boolean(opts.sense && cardSense(card));
  const sharedDefault = adapted?.meaning === card.meaningZh;
  const replaceable = !explicitSense && (hasDictMeaning(card) || ((isDefaultMeaning(card) || sharedDefault) && Boolean(met || opts.sense)));
  if (entry.meaningZh.trim() && (!card.meaningZh?.trim() || replaceable)) {
    const written = await prisma.word.updateMany({
      where: { id: card.id, meaningZh: card.meaningZh, phonetic: card.phonetic, senses: { equals: card.senses ?? Prisma.DbNull } },
      data: { meaningZh: entry.meaningZh.trim() },
    });
    // The sense of the sentence, in the model's words: as its page words it.
    if (written.count && (page || adapted) && met && !opts.sense) {
      await fitMeaningsToPages([{ id: card.id, word: card.word, meaning: entry.meaningZh.trim(), sentence: met }], card.targetLang).catch((err) =>
        console.error(`[capture] page sense failed for ${card.word}`, (err as Error).message),
      );
    }
  }
  // Save the personalized sentence before finishing the upgrade.
  if (personal && entry.example && brief) {
    let written = { sentence: entry.example, translation: entry.exampleTranslation };
    // The word must be in it as a word, as the pool's are: 出发之前 has 之 only inside
    // 之前, and teaches 之前 (the author's 之 card, 2026-09-29). Then the editor's read.
    const chinese = isChinese(card.sourceLang);
    let ownWord = !chinese || sentenceWords(written.sentence, card.word).own;
    let checked = false;
    if (ownWord && chinese) {
      const kept = await keepIfNatural({
        word: card.word,
        sentence: written.sentence,
        translation: written.translation,
        targetLang: card.targetLang,
        sense: own?.described,
      });
      if (!kept) ownWord = false;
      else {
        checked = !kept.unread;
        written = kept;
      }
    }
    if (!ownWord) {
      // Not saved: the second below stands in for it.
    } else {
      // Newest first on every page, so their own leads.
      await saveGeneratedExample(card.id, card.exampleRevision, {
        sentenceEn: written.sentence,
        sentenceZh: written.translation,
        sourceName: AI_SOURCE,
        sourceUrl: "",
        register: style ?? "casual",
        level: writtenLabel(brief, opts.level ?? null, card.sourceLang),
        ...(checked ? { checkedAt: new Date() } : {}),
      });
    }
  }
  // Two by default: a word the pool has no sentence for (off the lists, a sense of
  // its own), or whose own one the editor turned down, gets another of theirs,
  // written to differ from what is there.
  if (card.autoExamples && opts.withExample !== false && opts.exampleStyle !== "none") {
    if (!(await prisma.word.count({ where: { id: card.id, exampleRevision: card.exampleRevision } }))) return;
    const have = await prisma.example.findMany({ where: { wordId: card.id }, select: { sentenceEn: true } });
    if (have.length < 2) {
      await runExampleSearch({
        userId: card.userId,
        word: card.word,
        wordId: card.id,
        sourceLang: card.sourceLang,
        targetLang: card.targetLang,
        exampleStyle: style,
        level: opts.level,
        avoid: have.map((e) => e.sentenceEn),
        brief: brief ?? await exampleBrief(card.userId, card.sourceLang, card.id),
        sense: own?.described ?? (met ? entry.meaningZh || card.meaningZh || undefined : undefined),
        exampleRevision: card.exampleRevision,
      });
    }
    if (await prisma.example.count({ where: { wordId: card.id } }) < 2) throw new Error("Example generation returned no usable sentence");
  }
  // An HSK word's part of speech and family are its page's, the same for everyone
  // (services/wordPages.ts) — the picked sense's own part of speech (背 «нести на
  // себе» is a verb, the page's lead «спина» a noun); the model's stand in for the
  // words off the lists.
  await prisma.word.update({
    where: { id: card.id },
    data: {
      ...(card.phonetic ? {} : { phonetic: entry.phonetic || null }),
      ...(card.partOfSpeech ? {} : { partOfSpeech: own?.pos || page?.pos ||
        adapted?.senses.find((s) => s.meaning === card.meaningZh || (sharedDefault && s.onCard))?.pos || entry.partOfSpeech || null }),
      ...(card.collocations.length ? {} : { collocations: settled ? (pageCardFields(card.word, card.sourceLang, card.targetLang)?.collocations ?? []) : entry.collocations }),
      ...(card.synonyms.length ? {} : { synonyms: page ? page.syn : entry.synonyms }),
      ...(card.antonyms.length ? {} : { antonyms: page ? page.ant : entry.antonyms }),
    },
  });
}
