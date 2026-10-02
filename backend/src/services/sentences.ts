import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { prisma } from "./db.js";
import { chatJson } from "./llm.js";
import { langName, scriptNote } from "../lib/langs.js";
import { segmentChinese } from "./segment.js";
import { asHskVersion, hskTagFor, learnerStatus, normalizeHanzi } from "./hsk.js";
import { learnerRates } from "./studyPlan.js";

/**
 * Sentences one step above you (i+1): an example uses the one new word and,
 * besides it, words the learner already has. A sentence that suits HSK 5 is
 * unreadable at HSK 2, so "one good example per word" can't be shared — but
 * three can: every HSK word has a pool of three written once, offline
 * (`scripts/build-hsk-sentences.ts` → `data/hsk-sentences.jsonl`), each under a
 * stated ceiling and checked against it:
 *   1 — besides the headword, HSK 1–2 words only;
 *   2 — nothing above the word's own level;
 *   3 — natural, any words.
 * A learner gets the one with the fewest words they likely don't know. When even
 * that one has more than one, the per-card call writes a sentence from their own
 * words instead, kept on their card only (services/capture.ts), and that one is
 * checked the same way.
 *
 * "Know" is what the rest of the app means by it: a card past learning or an "I
 * know it" (learnerStatus, the readiness mark's "recognise"), and for a word never
 * asked about, the share of its level the check says they know (studyPlan.levelRates)
 * — an HSK 4 learner has no card for 我, and a count that took the cards alone would
 * call every sentence unreadable.
 */

const HAN = /^\p{Script=Han}+$/u;

/** A word's list tags; 一下 is the list's 一下儿, as a card keeps it (services/capture.ts). */
function listTag(word: string) {
  return hskTagFor(word) ?? hskTagFor(`${word}儿`);
}

/** The lowest level a word is taught at on either list, or null when it is on neither. */
export function minLevel(word: string): number | null {
  const tag = listTag(word);
  const levels = tag ? Object.values(tag) : [];
  return levels.length ? Math.min(...levels) : null;
}

/**
 * A token as list words, longest first (桌上 → 桌 上). What no list word covers
 * stays together as one word off the lists — a name is one unknown, not two.
 */
function listPieces(token: string): string[] {
  if (listTag(token)) return [token];
  const chars = Array.from(token);
  const out: string[] = [];
  let off = "";
  for (let i = 0; i < chars.length; ) {
    let n = Math.min(4, chars.length - i);
    while (n >= 1 && !listTag(chars.slice(i, i + n).join(""))) n--;
    if (n === 0) {
      off += chars[i++];
      continue;
    }
    if (off) out.push(off);
    off = "";
    out.push(chars.slice(i, i + n).join(""));
    i += n;
  }
  if (off) out.push(off);
  return out;
}

/**
 * The words of a Chinese sentence a learner has to know besides `headword`: the
 * Reader's segmentation, a token the lists don't have cut into list words
 * (喝咖啡 → 喝 咖啡), punctuation and numbers left out. `own` says whether the
 * headword stood as a word of its own: the cut doesn't run across its edges —
 * 上 inside 上班 teaches 上班, not 上; the list's phrase 打篮球 as 打 + 篮球 is fine.
 */
export function sentenceWords(zh: string, headword: string): { words: string[]; own: boolean } {
  const head = normalizeHanzi(headword);
  const units = (text: string) =>
    segmentChinese(text)
      .filter((t) => t.wordLike && HAN.test(t.text))
      .flatMap((t) => listPieces(t.text));
  const all = units(zh);
  for (let i = 0; head && i < all.length; i++) {
    let joined = "";
    for (let j = i; j < all.length && joined.length < head.length; j++) {
      joined += all[j];
      if (joined === head) return { words: [...all.slice(0, i), ...all.slice(j + 1)].filter((w) => w !== head), own: true };
    }
  }
  // Glued into a longer token (or missing): cut it out and read what is left.
  return { words: head ? zh.split(head).flatMap(units) : all, own: false };
}

// --- Ceilings, for the pool's build and its check ---

export const CEILINGS = [1, 2, 3] as const;
export type Ceiling = (typeof CEILINGS)[number];

/** The highest level a sentence under this ceiling may use besides the headword; null = any word. */
export function ceilingLevel(c: Ceiling, headword: string): number | null {
  if (c === 3) return null;
  return c === 1 ? 2 : Math.max(2, minLevel(headword) ?? 7);
}

/** The words that break the ceiling: above its level, or on neither list. */
export function overCeiling(words: string[], c: Ceiling, headword: string): string[] {
  const cap = ceilingLevel(c, headword);
  if (cap === null) return [];
  return [...new Set(words.filter((w) => (minLevel(w) ?? Infinity) > cap))];
}

/** How a ceiling reads next to the example ("HSK 1–2"); the natural one has no label. */
export function ceilingLabel(c: Ceiling, headword: string): string | null {
  const cap = ceilingLevel(c, headword);
  return cap === null ? null : levelLabel(cap);
}

// 7 is the HSK 7–9 band: its words are "HSK 1–9", not "1–7".
export const levelLabel = (level: number) => (level <= 1 ? "HSK 1" : `HSK 1–${level >= 7 ? 9 : level}`);

/**
 * The label for a sentence written for this learner: the HSK range it was held to
 * when they took the check — beside a pool sentence's "HSK 1–3", a CEFR "B2" from
 * the add form's settings read as a different scale — else what the caller had.
 */
export function writtenLabel(brief: ExampleBrief | null | undefined, fallback: string | null): string | null {
  return brief?.reading?.checked ? levelLabel(brief.reading.level ?? 1) : fallback;
}

// --- The pool ---

// `t` is the sentence's words as checked, space-separated: the segmentation is
// stored, not redone per request, so the words scored are the words checked.
export type PoolSentence = { c: Ceiling; zh: string; ru: string; t: string };

let pool: Map<string, PoolSentence[]> | null = null;
// From the naturalness pass (scripts/build-hsk-sentences.ts --judge): words formal
// by nature (以, 之所以, 颇), whose sentences are formal too, and the sentences it
// replaced — a card may still carry one, and it gives way on open.
const formal = new Set<string>();
const retired = new Map<string, Set<string>>();

function poolIndex(): Map<string, PoolSentence[]> {
  if (pool) return pool;
  pool = new Map();
  // `../../data` is the same directory from src/services and from dist/services.
  const path = fileURLToPath(new URL("../../data/hsk-sentences.jsonl", import.meta.url));
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    console.error("[sentences] no sentence pool at", path, "— every example is written per card", err);
    return pool;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim(); // CRLF on a Windows checkout
    if (!line) continue;
    const row = JSON.parse(line) as { w?: string; s?: PoolSentence[]; f?: number; o?: string[] };
    if (!row.w) continue;
    if (row.s?.length) pool.set(row.w, row.s);
    if (row.f) formal.add(row.w);
    if (row.o?.length) retired.set(row.w, new Set(row.o));
  }
  return pool;
}

// The pool keeps an 儿 word under its base, as a card does (一下儿 → 一下).
function poolKey(word: string): string {
  const head = normalizeHanzi(word);
  poolIndex();
  return !pool!.has(head) && head.length > 1 && head.endsWith("儿") ? head.slice(0, -1) : head;
}

/** Is this HSK word formal by nature (以, 之所以, 颇)? Its examples are written and labelled so. */
export function isFormalWord(word: string): boolean {
  return formal.has(poolKey(word));
}

/** A sentence the naturalness pass took out of the pool: a card carrying it gets another on open. */
function isRetired(word: string, zh: string): boolean {
  return retired.get(poolKey(word))?.has(zh) ?? false;
}

/** The pool's sentences for an HSK word (none off the lists). They are in Russian: other learners get none. */
export function poolSentences(word: string, targetLang = "ru"): PoolSentence[] {
  if (targetLang !== "ru") return [];
  return poolIndex().get(poolKey(word)) ?? [];
}

/** Is this example one of the pool's, now or before the naturalness pass? (Derived by text: nothing on the row says so.) */
export function isPoolSentence(word: string, targetLang: string, zh: string): boolean {
  return poolSentences(word, targetLang).some((s) => s.zh === zh) || (targetLang === "ru" && isRetired(word, zh));
}

// --- Reading it as this learner ---

/** How likely the learner knows a word, 0–1. */
export type Knows = (word: string) => number;

/**
 * `knows`: a card past learning or an "I know it" is 1 — adding a word is not
 * knowing it, as the readiness mark says (hsk.ts). Any other list word is priced
 * at its level's share from the check, as the plan prices the words nobody asked
 * about; a word off the lists, or with no check to go on, is 0. `level`: the highest
 * level whose words, and every level's below it, they know at least SURE of — what
 * a per-card example may draw on besides their own words. `checked`: there is a
 * check to count against at all.
 */
export type Reading = { knows: Knows; level: number | null; checked: boolean };

// An example is ~8 words besides the new one; at 90% known each, that is under one
// unknown. At 80% it was 1.4, and the first learner's own sentences, written "at
// HSK 4" against a check of 10 of 12 there, were all too hard to keep.
const SURE = 0.9;

export async function learnerReading(userId: string): Promise<Reading> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { telegramId: true, hskVersion: true } });
  if (!user) return { knows: () => 0, level: null, checked: false };
  const version = asHskVersion(user.hskVersion) ?? "3.0";
  const [status, rates] = await Promise.all([learnerStatus(user.telegramId), learnerRates(user.telegramId, version)]);
  let level: number | null = null;
  for (let n = 1; (rates.get(n) ?? 0) >= SURE; n++) level = n;
  const checked = [...rates.values()].some((r) => r !== null);
  const knows: Knows = (word) => {
    const has = status.get(word);
    if (has && has !== "learning") return 1;
    const tag = listTag(word);
    const at = tag ? (tag[version] ?? Math.min(...Object.values(tag))) : null;
    return at ? (rates.get(at) ?? 0) : 0;
  };
  return { knows, level, checked };
}

/** How many of these words the learner likely doesn't know (an expected count). */
export function unknownIn(words: string[], knows: Knows): number {
  return words.reduce((n, w) => n + 1 - knows(w), 0);
}

/** i+1: besides the new word, at most one the learner may not know. */
export const MAX_UNKNOWN = 1;

type Pick = { s: PoolSentence; unknown: number };

// To half a word: 0.1 and 0.3 of a word read the same.
const half = (n: number) => Math.round(n * 2) / 2;

/** Easier to read, or as easy and more natural (the higher ceiling). */
const better = (a: Pick, b: Pick) => half(a.unknown) < half(b.unknown) || (half(a.unknown) === half(b.unknown) && a.s.c > b.s.c);

const scored = (s: PoolSentence, knows: Knows): Pick => ({ s, unknown: unknownIn(s.t.split(" ").filter(Boolean), knows) });

/** The pool sentence this learner reads best: the fewest likely-unknown words, then the more natural one. */
export function pickPoolSentence(word: string, knows: Knows, targetLang = "ru"): Pick | null {
  let best: Pick | null = null;
  for (const s of poolSentences(word, targetLang)) {
    const p = scored(s, knows);
    if (!best || better(p, best)) best = p;
  }
  return best;
}

// --- On the card ---

// Written by the model like every per-card example, so it carries the same source
// (services/capture.ts tells the sentence a word was met in by any other one).
const AI_SOURCE = "Onomika AI";

/** The pool is everyday language; a learner who picked another register gets theirs written per card. */
export const poolRegister = (style?: string | null) => !style || style === "casual";

// A formal word's sentences are formal ("news" reads «Формальный» on the page).
// The pool was read by the editor (build-hsk-sentences.ts --judge): stamped as read.
function poolExample(word: string, s: PoolSentence) {
  return {
    sentenceEn: s.zh,
    sentenceZh: s.ru,
    sourceName: AI_SOURCE,
    sourceUrl: "",
    register: isFormalWord(word) ? "news" : null,
    level: ceilingLabel(s.c, word),
    checkedAt: new Date(),
  };
}

/**
 * Fresh cards get the pool sentence they read best, with no model call — when it
 * has at most one word besides the new one they may not know. A card it can't
 * serve is left without, and the upgrade writes one from their own words.
 */
export async function placePoolExamples(userId: string, cards: { id: string; word: string; targetLang: string }[]): Promise<number> {
  const served = cards.filter((c) => poolSentences(c.word, c.targetLang).length);
  if (!served.length) return 0;
  const { knows } = await learnerReading(userId);
  let n = 0;
  for (const c of served) {
    const pick = pickPoolSentence(c.word, knows, c.targetLang);
    if (!pick || pick.unknown > MAX_UNKNOWN) continue;
    await prisma.example.create({ data: { wordId: c.id, ...poolExample(c.word, pick.s) } });
    n++;
  }
  return n;
}

/** Write one pool sentence onto a card (the upgrade, once it has decided). */
export async function addPoolExample(wordId: string, word: string, s: PoolSentence): Promise<void> {
  await prisma.example.create({ data: { wordId, ...poolExample(word, s) } });
}

/**
 * On open, a pool sentence the learner has outgrown gives way to the one they read
 * best now — the natural sentence once the simple one's words are all theirs. Only
 * the pool's own sentence is swapped; one they met, wrote or asked for stays. It
 * moves only for a strictly better one, so it doesn't flip between two on the edge.
 */
export async function refreshPoolExample(wordId: string): Promise<boolean> {
  const card = await prisma.word.findUnique({
    where: { id: wordId },
    select: {
      userId: true,
      word: true,
      targetLang: true,
      examples: { select: { id: true, sentenceEn: true, sentenceZh: true, sourceName: true } },
    },
  });
  if (!card) return false;
  const pool = poolSentences(card.word, card.targetLang);
  // One the naturalness pass took out goes whatever it takes: the best pick now, even
  // past their level, or nothing — an unnatural sentence is never kept for being easy.
  const stale = card.examples.find((e) => isRetired(card.word, e.sentenceEn));
  if (stale && card.targetLang === "ru") {
    const { knows } = await learnerReading(card.userId);
    const pick = pickPoolSentence(card.word, knows, card.targetLang);
    if (pick && !card.examples.some((e) => e.sentenceEn === pick.s.zh))
      await prisma.example.update({ where: { id: stale.id }, data: poolExample(card.word, pick.s) });
    else await prisma.example.delete({ where: { id: stale.id } });
    return true;
  }
  const current = card.examples.find((e) => e.sourceName === AI_SOURCE && pool.some((s) => s.zh === e.sentenceEn));
  if (!current) return false;
  const inPool = pool.find((s) => s.zh === current.sentenceEn)!;
  // A pool sentence whose Russian was corrected since (the review of 2026-09-29) takes
  // the new translation; the Chinese is the same sentence, so it isn't retired.
  if (current.sentenceZh !== inPool.ru) {
    await prisma.example.update({ where: { id: current.id }, data: { sentenceZh: inPool.ru } });
    return true;
  }
  const { knows } = await learnerReading(card.userId);
  const now = scored(inPool, knows);
  const pick = pickPoolSentence(card.word, knows, card.targetLang);
  if (!pick || pick.unknown > MAX_UNKNOWN || !better(pick, now)) return false;
  if (card.examples.some((e) => e.sentenceEn === pick.s.zh)) return false;
  await prisma.example.update({ where: { id: current.id }, data: poolExample(card.word, pick.s) });
  return true;
}

// --- Per-card examples ---

/**
 * The level is a wish, naturalness is the rule: held to HSK 1–2, 以 came out as
 * 他以笔写字 where anyone says 用笔 (the author, 2026-09-28). Said in every prompt
 * that writes a Chinese example under a vocabulary limit.
 */
export const NATURAL_FIRST = (word: string) =>
  `The sentence must be one a native speaker would really say or write — natural, idiomatic, with "${word}" used ` +
  `the way natives use it, as a word of its own (never only inside a longer word: 之 inside 之前, 上 inside 晚上). ` +
  `If "${word}" can't be used naturally within that vocabulary (a formal word such as 以 or 之所以 has no everyday ` +
  `context), use the words it needs and the register it lives in — modern formal Chinese, never a pseudo-classical ` +
  `line like 此乃…之…: a natural sentence always beats an easy one, and the Chinese is never bent to fit the level. `;

/** What a per-card example is written from: the learner's own words, how far past them it may go, their themes. */
export type ExampleBrief = { reading: Reading | null; knownWords: string[]; themes: string };

export async function exampleBrief(userId: string, sourceLang: string, exceptWordId?: string): Promise<ExampleBrief> {
  const [cards, memory, reading] = await Promise.all([
    // Words they know, not the ones they just took: 20 fresh cards as the building
    // blocks made 造型 "很些" — the model forced one in where 酷 had been.
    prisma.word.findMany({
      where: {
        userId,
        sourceLang,
        OR: [{ state: { gte: 2 } }, { canUseAt: { not: null } }],
        ...(exceptWordId ? { NOT: { id: exceptWordId } } : {}),
      },
      orderBy: [{ reps: "desc" }, { createdAt: "desc" }],
      take: 40,
      select: { word: true },
    }),
    // The interests picked in onboarding (HskFirstRun → coach memory).
    prisma.coachMemory.findUnique({ where: { userId_lang: { userId, lang: sourceLang } }, select: { interests: true } }),
    sourceLang === "zh" ? learnerReading(userId) : Promise.resolve(null),
  ]);
  return { reading, knownWords: cards.map((c) => c.word), themes: memory?.interests.trim() ?? "" };
}

const rewriteSchema = z.object({ sentence: z.string().default(""), translation: z.string().default("") });

const verdictSchema = z.object({
  natural: z.boolean().default(false),
  why: z.string().default(""),
  better: z.string().default(""),
  translation: z.string().default(""),
});

/**
 * A native editor's read of a per-card Chinese example — the one the pool had
 * (build-hsk-sentences.ts --judge), which the per-card path never got: the author's
 * 之 card showed 这本书是孩子之最爱 beside one written for them. Natural as it is,
 * or the editor's natural rewrite (the word still a word of its own), or null — an
 * unnatural sentence is not shown. With the model down it is kept, as before.
 */
export async function keepIfNatural(p: {
  word: string;
  sentence: string;
  translation: string;
  targetLang: string;
}): Promise<{ sentence: string; translation: string; unread?: true } | null> {
  const lang = langName(p.targetLang);
  // One read; the rewrite it offers is read again before it is kept — unread, the
  // editor's own fix came back worse (孩子之最爱 → 此书乃孩子之最爱, 以笔写字 → 以笔代口).
  const read = (sentence: string, translation: string, rewrite: boolean) =>
    chatJson({
      system:
        `You are a native Mandarin editor for a Chinese–${lang} learner's dictionary, judging as the editor of a ` +
        `modern textbook. Is this example sentence for "${p.word}" natural, idiomatic, correct modern Chinese that a ` +
        `native speaker would really say or write — "${p.word}" used as natives use it, as a word of its own; not ` +
        `stilted, not bent to use easy words, not pseudo-classical (此乃…之…, 孩子之最爱 where one says 孩子最喜爱的, ` +
        `以笔代口), not odd in logic — and is the translation right? If so: {"natural": true}. If not: ` +
        (rewrite
          ? `{"natural": false, "why": a few words, "better": a sentence of similar length and difficulty that a ` +
            `modern textbook would print, using "${p.word}" as a word of its own in the same sense — modern Chinese, ` +
            `formal only if the word is, never classical — "translation": its natural ${lang} translation}.`
          : `{"natural": false, "why": a few words}.`) +
        scriptNote("zh") +
        " Respond as JSON.",
      user: JSON.stringify({ word: p.word, sentence, translation }),
      schema: verdictSchema,
      label: "example.judge",
      model: "qwen3.5-plus",
    });
  try {
    const r = await read(p.sentence, p.translation, true);
    if (r.natural) return { sentence: p.sentence, translation: p.translation };
    const better = (r.better ?? "").trim();
    const translation = (r.translation ?? "").trim();
    if (better && translation && sentenceWords(better, p.word).own && (await read(better, translation, false)).natural)
      return { sentence: better, translation };
    console.log(`[sentences] ${p.word}: dropped an unnatural example (${r.why}): ${p.sentence}`);
    return null;
  } catch (err) {
    console.error(`[sentences] judge failed for ${p.word}`, (err as Error).message);
    return { sentence: p.sentence, translation: p.translation, unread: true };
  }
}

/**
 * Examples written for a card before the editor's read existed (`checkedAt` null)
 * get it on the card's next open — once: kept and stamped, replaced by the read
 * rewrite, or removed; one that holds the word only inside a longer word (出发之前
 * for 之) goes without a call. Only the ones the model wrote: a sentence met in the
 * Reader or typed by the learner is theirs. A pool sentence was read in the pool.
 */
export async function checkOldExamples(wordId: string): Promise<number> {
  const card = await prisma.word.findUnique({
    where: { id: wordId },
    select: {
      word: true,
      sourceLang: true,
      targetLang: true,
      examples: { where: { checkedAt: null, sourceName: AI_SOURCE }, select: { id: true, sentenceEn: true, sentenceZh: true } },
    },
  });
  if (!card || card.sourceLang !== "zh" || !card.examples.length) return 0;
  let changed = 0;
  for (const e of card.examples) {
    // A replaced pool sentence is refreshPoolExample's to swap.
    if (isRetired(card.word, e.sentenceEn)) continue;
    if (isPoolSentence(card.word, card.targetLang, e.sentenceEn)) {
      await prisma.example.update({ where: { id: e.id }, data: { checkedAt: new Date() } });
      continue;
    }
    if (!sentenceWords(e.sentenceEn, card.word).own) {
      await prisma.example.delete({ where: { id: e.id } });
      changed++;
      continue;
    }
    const kept = await keepIfNatural({ word: card.word, sentence: e.sentenceEn, translation: e.sentenceZh, targetLang: card.targetLang });
    if (!kept) {
      await prisma.example.delete({ where: { id: e.id } });
      changed++;
    } else if (!kept.unread) {
      await prisma.example.update({
        where: { id: e.id },
        data: { sentenceEn: kept.sentence, sentenceZh: kept.translation, checkedAt: new Date() },
      });
      if (kept.sentence !== e.sentenceEn) changed++;
    }
  }
  return changed;
}

/**
 * Hold a model-written Chinese example to i+1, the check "one example built from
 * the learner's words" never had: segment it, count what they likely don't know
 * besides the word. Over one, it is rewritten once with those words named; the
 * version with fewer unknowns is kept, the count comes back with it.
 */
export async function holdToLevel(p: {
  word: string;
  sentence: string;
  translation: string;
  targetLang: string;
  brief: ExampleBrief;
}): Promise<{ sentence: string; translation: string; unknown: number }> {
  const reading = p.brief.reading;
  // With no check there is nothing to count against: every word is "unknown".
  if (!reading?.checked) return { sentence: p.sentence, translation: p.translation, unknown: 0 };
  const level = reading.level ?? 1;
  const count = (s: string) => unknownIn(sentenceWords(s, p.word).words, reading.knows);
  const first = { sentence: p.sentence, translation: p.translation, unknown: count(p.sentence) };
  if (first.unknown <= MAX_UNKNOWN) return first;
  const hard = [...new Set(sentenceWords(p.sentence, p.word).words.filter((w) => reading.knows(w) < 0.5))];
  try {
    const r = await chatJson({
      system:
        `You rewrite a Chinese example sentence for a learner at HSK ${level}. Keep the word "${p.word}" exactly ` +
        `as written and in the sense it has in the sentence, and the tone (line breaks too). Besides "${p.word}", ` +
        `every word must be HSK ${level} or below; these are above it and must all go: ${hard.join(", ")}. ` +
        // "Keep the situation" kept 软件 — the situation itself was the hard word.
        `Change the situation if it needs them — a simpler everyday one is fine. Write it as a native speaker ` +
        `would say it at that level, natural and grammatical; never swap in a word that doesn't fit. ` +
        NATURAL_FIRST(p.word) +
        `Then translate it into natural ${langName(p.targetLang)}.` +
        scriptNote("zh") +
        scriptNote(p.targetLang) +
        ' Respond as JSON: {"sentence": string, "translation": string}.',
      user: p.sentence,
      schema: rewriteSchema,
      label: "example.hold",
    });
    const sentence = (r.sentence ?? "").trim();
    const translation = (r.translation ?? "").trim();
    if (!sentence.includes(p.word) || !translation) return first;
    const second = { sentence, translation, unknown: count(sentence) };
    return second.unknown < first.unknown ? second : first;
  } catch (err) {
    console.error(`[sentences] rewrite failed for ${p.word}`, (err as Error).message);
    return first;
  }
}
