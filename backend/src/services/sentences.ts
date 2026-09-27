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

export const levelLabel = (level: number) => (level <= 1 ? "HSK 1" : `HSK 1–${level}`);

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
    const row = JSON.parse(line) as { w?: string; s?: PoolSentence[] };
    if (row.w && row.s?.length) pool.set(row.w, row.s);
  }
  return pool;
}

/** The pool's sentences for an HSK word (none off the lists). They are in Russian: other learners get none. */
export function poolSentences(word: string, targetLang = "ru"): PoolSentence[] {
  if (targetLang !== "ru") return [];
  const head = normalizeHanzi(word);
  // The pool keeps an 儿 word under its base, as a card does (一下儿 → 一下).
  return poolIndex().get(head) ?? (head.length > 1 && head.endsWith("儿") ? poolIndex().get(head.slice(0, -1)) : undefined) ?? [];
}

/** Is this example one of the pool's? (Derived by text: nothing on the row says so.) */
export function isPoolSentence(word: string, targetLang: string, zh: string): boolean {
  return poolSentences(word, targetLang).some((s) => s.zh === zh);
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

function poolExample(word: string, s: PoolSentence) {
  return { sentenceEn: s.zh, sentenceZh: s.ru, sourceName: AI_SOURCE, sourceUrl: "", register: null, level: ceilingLabel(s.c, word) };
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
    select: { userId: true, word: true, targetLang: true, examples: { select: { id: true, sentenceEn: true } } },
  });
  if (!card) return false;
  const pool = poolSentences(card.word, card.targetLang);
  const current = card.examples.find((e) => pool.some((s) => s.zh === e.sentenceEn));
  if (!current) return false;
  const { knows } = await learnerReading(card.userId);
  const now = scored(pool.find((s) => s.zh === current.sentenceEn)!, knows);
  const pick = pickPoolSentence(card.word, knows, card.targetLang);
  if (!pick || pick.unknown > MAX_UNKNOWN || !better(pick, now)) return false;
  if (card.examples.some((e) => e.sentenceEn === pick.s.zh)) return false;
  await prisma.example.update({ where: { id: current.id }, data: poolExample(card.word, pick.s) });
  return true;
}

// --- Per-card examples ---

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
