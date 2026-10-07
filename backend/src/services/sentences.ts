import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { prisma } from "./db.js";
import { chatJson } from "./llm.js";
import { langName, scriptNote } from "../lib/langs.js";
import { segmentChinese } from "./segment.js";
import { asHskVersion, clampLevel, hskReading, hskTagFor, normalizeHanzi, type HskVersion } from "./hsk.js";
import { hskOf, isHskLang } from "../lib/level.js";

/**
 * Examples at the learner's level: the sentence around a word is written at the
 * HSK level they chose to train, whatever the word's own level — an HSK 4 learner
 * adding 吃 reads it in an HSK 4 sentence. A sentence that suits HSK 5 is a chore
 * at HSK 2, so "one good example per word" can't be shared — but three can: every
 * HSK word has a pool of three written once, offline (`scripts/build-hsk-sentences.ts`
 * → `data/hsk-sentences.jsonl`), each under a stated ceiling and checked against it:
 *   1 — besides the headword, HSK 1–2 words only;
 *   2 — nothing above the word's own level;
 *   3 — natural, any words.
 * A learner gets the hardest one that is not above their level. Where that is
 * well under it (the pool's simple one only), or the pool has none, the per-card
 * call writes a sentence at their level too, kept on their card only
 * (services/capture.ts).
 *
 * Not a level measured from the check, nor "at most one word they don't know":
 * the check couldn't be sure of HSK 3 on 12 taps, so an HSK 4 learner was held to
 * HSK 1–2 — and even a week in, the app doesn't know which words a learner knows
 * (the author, 2026-10-06).
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

// 7 is the HSK 7–9 band: its words are "HSK 1–9", not "1–7".
export const levelLabel = (level: number) => (level <= 1 ? "HSK 1" : `HSK 1–${level >= 7 ? 9 : level}`);

/**
 * The label for a sentence written for this learner: the HSK range it was written
 * at — beside a pool sentence's "HSK 1–3", a CEFR "B2" from the add form's settings
 * read as a different scale — else the level the request named, on the HSK scale
 * for Chinese ("4" or an older client's "B2" → "HSK 1–4").
 */
export function writtenLabel(brief: ExampleBrief | null | undefined, fallback: string | null, sourceLang?: string | null): string | null {
  if (brief?.level) return levelLabel(brief.level);
  if (!isHskLang(sourceLang)) return fallback;
  const n = hskOf(fallback);
  return n ? levelLabel(n) : null;
}

// --- The pool ---

// `t` is the sentence's words as checked, space-separated: the segmentation is
// stored, not redone per request, so the words scored are the words checked.
// `c` 4 is the band sentence (data/hsk-band-sentences.jsonl, scripts/build-band-sentences.ts):
// HSK 3–4 on both lists, for a word whose three had nothing there.
export type PoolSentence = { c: Ceiling | 4; zh: string; ru: string; t: string };

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
  // The band sentences ride beside the three, in a file of their own: the pool's
  // build assembles hsk-sentences.jsonl from its partials and would drop them.
  try {
    const band = readFileSync(fileURLToPath(new URL("../../data/hsk-band-sentences.jsonl", import.meta.url)), "utf8");
    for (const raw of band.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const row = JSON.parse(line) as { w: string; s: PoolSentence[] };
      pool.set(row.w, [...(pool.get(row.w) ?? []), ...row.s]);
    }
  } catch {
    /* none yet */
  }
  return pool;
}

// The pool keeps an 儿 word under its base, as a card does (一下儿 → 一下) — when the 儿
// is the erhua r: 婴儿 yīng ér is not 婴's 女婴, nor 孤儿 孤's «одинокий» (services/wordPages.ts).
function poolKey(word: string): string {
  const head = normalizeHanzi(word);
  poolIndex();
  const erhua = head.length > 1 && head.endsWith("儿") && !/ér$/.test(hskReading(head) ?? "");
  return !pool!.has(head) && erhua ? head.slice(0, -1) : head;
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

// --- At the learner's level ---

/**
 * The HSK level a learner's examples are written at, on their list: the one they
 * chose — their target, else the CEFR level the add form keeps for Chinese
 * (onboarding writes it from the target). Null: none to aim at.
 */
export type ExampleLevel = { level: number | null; version: HskVersion };

const HSK_FOR_CEFR: Record<string, number> = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

export async function exampleLevel(userId: string): Promise<ExampleLevel> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { hskTarget: true, hskVersion: true, levels: true } });
  const version = asHskVersion(user?.hskVersion) ?? "3.0";
  const cefr = (user?.levels as Record<string, string> | null)?.zh;
  const level = user?.hskTarget ?? HSK_FOR_CEFR[cefr ?? ""] ?? null;
  return { level: level === null ? null : clampLevel(version, level), version };
}

/** A word's level on the learner's list, else its lowest on the other; null when it is on neither. */
function wordLevel(word: string, version: HskVersion): number | null {
  const tag = listTag(word);
  if (!tag) return null;
  return tag[version] ?? Math.min(...Object.values(tag));
}

/**
 * How hard a pool sentence reads on this list: its hardest word besides the
 * headword. Off the lists, a one-character piece of a compound the cut split up
 * (款, 警 — 4,904 of the pool's 31,309 sentences have an off-list piece, and
 * 6,628 of those pieces are single characters) doesn't count; a whole word (敦煌,
 * 鲁迅, 预警) is a name or a rare one, one level above the rest.
 */
export function poolLevel(s: PoolSentence, version: HskVersion): number {
  let top = 1;
  let offList = false;
  for (const w of s.t.split(" ")) {
    if (!w) continue;
    const n = wordLevel(w, version);
    if (n !== null) top = Math.max(top, n);
    else if (Array.from(w).length > 1) offList = true;
  }
  return offList ? Math.min(top + 1, 7) : top;
}

type Pick = { s: PoolSentence; level: number };

/** Closer to level L: at or under it beats over it; under it, the harder; over it, the easier; then the more natural. */
function closer(a: Pick, b: Pick, L: number): boolean {
  const aFits = a.level <= L;
  if (aFits !== b.level <= L) return aFits;
  if (a.level !== b.level) return aFits ? a.level > b.level : a.level < b.level;
  return a.s.c > b.s.c;
}

/**
 * The pool sentence at the learner's level: the hardest one not above it, the
 * more natural on a tie (the higher ceiling); with none that low, or no level to
 * aim at, the easiest.
 */
export function pickPoolSentence(word: string, at: ExampleLevel, targetLang = "ru"): Pick | null {
  let best: Pick | null = null;
  for (const s of poolSentences(word, targetLang)) {
    const p = { s, level: poolLevel(s, at.version) };
    if (!best || closer(p, best, at.level ?? 0)) best = p;
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
// The label is how hard the sentence reads on the learner's list ("HSK 1–4").
function poolExample(word: string, p: Pick) {
  return {
    sentenceEn: p.s.zh,
    sentenceZh: p.s.ru,
    sourceName: AI_SOURCE,
    sourceUrl: "",
    register: isFormalWord(word) ? "news" : null,
    level: levelLabel(p.level),
    checkedAt: new Date(),
  };
}

/** Fresh cards get the pool sentence at the learner's level, with no model call. */
export async function placePoolExamples(userId: string, cards: { id: string; word: string; targetLang: string }[]): Promise<number> {
  const served = cards.filter((c) => poolSentences(c.word, c.targetLang).length);
  if (!served.length) return 0;
  const at = await exampleLevel(userId);
  let n = 0;
  for (const c of served) {
    const pick = pickPoolSentence(c.word, at, c.targetLang);
    if (!pick) continue;
    await prisma.example.create({ data: { wordId: c.id, ...poolExample(c.word, pick) } });
    n++;
  }
  return n;
}

/** Write one pool sentence onto a card (the upgrade, once it has decided). */
export async function addPoolExample(wordId: string, word: string, p: Pick): Promise<void> {
  await prisma.example.create({ data: { wordId, ...poolExample(word, p) } });
}

/** How hard the pool sentence among a card's examples reads on this list; null when none is one of the pool's now. */
export function pooledLevel(word: string, targetLang: string, examples: string[], at: ExampleLevel): number | null {
  const s = poolSentences(word, targetLang).find((p) => examples.includes(p.zh));
  return s ? poolLevel(s, at.version) : null;
}

/**
 * On open, the pool sentence on a card follows the learner's level: the pick for
 * the level they chose, so a card placed below it (the HSK 1–2 sentences of the
 * check-measured level, before 2026-10-07) or before they changed it moves to it.
 * Only the pool's own sentence is swapped; one they met, wrote or asked for stays.
 */
export async function refreshPoolExample(wordId: string): Promise<boolean> {
  const card = await prisma.word.findUnique({
    where: { id: wordId },
    select: {
      userId: true,
      word: true,
      targetLang: true,
      examples: { select: { id: true, sentenceEn: true, sentenceZh: true, sourceName: true, level: true } },
    },
  });
  if (!card) return false;
  const pool = poolSentences(card.word, card.targetLang);
  // One the naturalness pass took out goes whatever it takes: the pick now, or
  // nothing — an unnatural sentence is never kept for being easy.
  const stale = card.examples.find((e) => isRetired(card.word, e.sentenceEn));
  if (stale && card.targetLang === "ru") {
    const pick = pickPoolSentence(card.word, await exampleLevel(card.userId), card.targetLang);
    if (pick && !card.examples.some((e) => e.sentenceEn === pick.s.zh))
      await prisma.example.update({ where: { id: stale.id }, data: poolExample(card.word, pick) });
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
  const pick = pickPoolSentence(card.word, await exampleLevel(card.userId), card.targetLang);
  if (!pick) return false;
  if (pick.s.zh === inPool.zh) {
    // The same sentence, labelled by its ceiling before: now by how it reads.
    if (current.level === levelLabel(pick.level)) return false;
    await prisma.example.update({ where: { id: current.id }, data: { level: levelLabel(pick.level) } });
    return true;
  }
  if (card.examples.some((e) => e.sentenceEn === pick.s.zh)) return false;
  await prisma.example.update({ where: { id: current.id }, data: poolExample(card.word, pick) });
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

/**
 * What a per-card example is written from: the level it is written at (Chinese
 * only), words of the learner's it may reuse, their themes.
 */
export type ExampleBrief = ExampleLevel & { knownWords: string[]; themes: string };

export async function exampleBrief(userId: string, sourceLang: string, exceptWordId?: string): Promise<ExampleBrief> {
  const [cards, memory, at] = await Promise.all([
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
    exampleLevel(userId),
  ]);
  return {
    ...at,
    level: sourceLang === "zh" ? at.level : null,
    knownWords: cards.map((c) => c.word),
    themes: memory?.interests.trim() ?? "",
  };
}

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
  // The sense the card teaches, when the learner picked one (背 «нести на себе» bēi):
  // a sentence natural in another sense is still wrong for this card.
  sense?: string;
}): Promise<{ sentence: string; translation: string; unread?: true } | null> {
  const lang = langName(p.targetLang);
  const inSense = p.sense ? `the sense «${p.sense}»` : "the same sense";
  // One read; the rewrite it offers is read again before it is kept — unread, the
  // editor's own fix came back worse (孩子之最爱 → 此书乃孩子之最爱, 以笔写字 → 以笔代口).
  const read = (sentence: string, translation: string, rewrite: boolean) =>
    chatJson({
      system:
        `You are a native Mandarin editor for a Chinese–${lang} learner's dictionary, judging as the editor of a ` +
        `modern textbook. Is this example sentence for "${p.word}" natural, idiomatic, correct modern Chinese that a ` +
        `native speaker would really say or write — "${p.word}" used as natives use it, as a word of its own; not ` +
        `stilted, not bent to use easy words, not pseudo-classical (此乃…之…, 孩子之最爱 where one says 孩子最喜爱的, ` +
        `以笔代口), not odd in logic — and is the translation right? ` +
        (p.sense ? `The card teaches "${p.word}" in the sense «${p.sense}»: one that uses it in any other sense is not right. ` : "") +
        `If so: {"natural": true}. If not: ` +
        (rewrite
          ? `{"natural": false, "why": a few words, "better": a sentence of similar length and difficulty that a ` +
            `modern textbook would print, using "${p.word}" as a word of its own in ${inSense} — modern Chinese, ` +
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
