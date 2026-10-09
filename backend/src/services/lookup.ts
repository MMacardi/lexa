import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cedictCard, cedictEntries, cedictHas, cedictKnows, cedictLookup, isChinese, isMeaningGloss, mainReading, type CedictEntry } from "./cedict.js";
import { hskFrequency, hskTagFor, normalizeHanzi, type HskTag } from "./hsk.js";
import { hskPage, readsAs } from "./wordPages.js";
import { prisma } from "./db.js";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { FAST_MODEL, chatJson } from "./llm.js";
import { langName } from "../lib/langs.js";

/**
 * The learner's dictionary: a default meaning in Russian for every HSK headword,
 * and the add form's lookup in both directions.
 *
 * The meanings are written once, offline (`scripts/build-hsk-ru.ts`: the model
 * picks and translates CC-CEDICT's senses), and shipped as `data/hsk-ru.jsonl`.
 * Before, every fresh card sat in the dictionary's English until a per-card model
 * call translated the same word again, for every learner who ever added it. Now
 * an HSK word is a card in Russian the moment it is added; the per-card call is
 * left with what is personal — the example made of the learner's own words, and
 * the sense of the sentence the word was met in (which may replace the default).
 *
 * The file is derived from CC-CEDICT, so it carries the same CC BY-SA 4.0 licence
 * and the word page's credit line covers it. A missing file only means the old
 * path: English first, Russian from the model.
 */

let ru: Map<string, string> | null = null;
// Meanings a default used to be (scripts/reorder-hsk-ru.ts keeps them on the row, "o"):
// a card that still carries one is moved to the current default.
const oldRu = new Map<string, Set<string>>();
// The everyday words off the HSK list that the Russian table answers with (有钱,
// 什么时候, 单词), and a phrase for each row — they have no word page to take one from.
const everyday = new Map<string, { text: string; translation: string }>();

// `../../data` is the same directory from src/services and from dist/services.
function dataLines(file: string, missing: string): string[] {
  const path = fileURLToPath(new URL(`../../data/${file}`, import.meta.url));
  try {
    // Trimmed: CRLF on a Windows checkout, as with cedict.jsonl.
    return readFileSync(path, "utf8")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (err) {
    console.error("[lookup] no", path, "—", missing, err);
    return [];
  }
}

function ruIndex(): Map<string, string> {
  if (ru) return ru;
  ru = new Map();
  for (const line of dataLines("hsk-ru.jsonl", "cards start in English")) {
    const row = JSON.parse(line) as { s?: string; m?: string; o?: string[] };
    if (row.s && row.m) ru.set(row.s, row.m);
    if (row.s && row.o?.length) oldRu.set(row.s, new Set(row.o));
  }
  // Written with the table (scripts/apply-ru-zh.ts): such a word is found by Russian and
  // pinyin and starts as a Russian card, like a list word, instead of waiting on a
  // model call to put CC-CEDICT's English into Russian.
  for (const line of dataLines("everyday-ru.jsonl", "words off the HSK list start in English")) {
    const row = JSON.parse(line) as { s?: string; m?: string; p?: [string, string] };
    if (!row.s || !row.m || ru.has(row.s)) continue;
    ru.set(row.s, row.m);
    if (row.p) everyday.set(row.s, { text: row.p[0], translation: row.p[1] });
  }
  return ru;
}

/**
 * Cards still carrying a default the list has since corrected (热 «нагревать; горячий»
 * → «горячий; нагревать», 之所以 «поэтому» → «причина того, что») move to the current
 * one; a hand pick of senses made for the old wording goes along. A meaning the
 * learner wrote is never an old default, so it stays. Called before a card or the
 * list is read.
 */
export async function refreshDefaultMeanings(where: Prisma.WordWhereInput): Promise<number> {
  ruIndex();
  if (!oldRu.size) return 0;
  const cards = await prisma.word.findMany({
    where: { ...where, targetLang: "ru", word: { in: [...oldRu.keys()] } },
    select: { id: true, word: true, sourceLang: true, meaningZh: true, senses: true },
  });
  let n = 0;
  for (const c of cards) {
    const m = c.meaningZh?.trim();
    if (!m || !isChinese(c.sourceLang) || !oldRu.get(c.word)?.has(m)) continue;
    const next = defaultMeaning(c.word, "ru");
    if (!next || next === m) continue;
    const senses = c.senses as { for?: string } | null;
    const carried = senses && typeof senses === "object" && senses.for === m ? { senses: { ...senses, for: next } as Prisma.InputJsonValue } : {};
    // Compare-and-set on the meaning read: an edit made meanwhile wins.
    n += (await prisma.word.updateMany({ where: { id: c.id, meaningZh: c.meaningZh }, data: { meaningZh: next, ...carried } })).count;
  }
  return n;
}

/** The shared default meaning of a Chinese headword in the learner's language, or null. */
export function defaultMeaning(word: string, lang: string | null | undefined): string | null {
  if (lang !== "ru") return null;
  const head = normalizeHanzi(word);
  if (!head) return null;
  const hit = ruIndex().get(head);
  if (hit) return hit;
  // 一下儿 means what 一下 means.
  return head.length > 1 && head.endsWith("儿") ? (ruIndex().get(head.slice(0, -1)) ?? null) : null;
}

/**
 * Is this card's meaning still the shared default? Derived on read like
 * `dictMeaning`: the upgrade may replace it with the sense of the sentence the
 * word was met in, and the client keeps polling until the rest of the card lands.
 */
export function isDefaultMeaning(w: { word: string; sourceLang: string; targetLang: string; meaningZh: string | null }): boolean {
  const m = w.meaningZh?.trim();
  return Boolean(m) && isChinese(w.sourceLang) && defaultMeaning(w.word, w.targetLang) === m;
}

/**
 * Does the default settle what this word means, whatever the sentence? One sense
 * and one reading (not 打's "бить; драться", not 地 dì / de): then a Reader tap
 * has its answer and no model call is spent picking the sense in context — about
 * half the HSK list.
 */
export function defaultIsSettled(word: string, lang: string | null | undefined): boolean {
  const m = defaultMeaning(word, lang);
  if (!m || m.includes(";")) return false;
  const entry = cedictLookup(word, { count: false });
  const readings = entry?.readings.filter((r) => r.pinyin[0] === r.pinyin[0].toLowerCase()) ?? [];
  return readings.length <= 1;
}

// --- Lookup: type hanzi, pinyin or a meaning, get Chinese words ---

// The word page's sense a Russian query found (世界 «мир» · 全世界 «весь мир», 和平
// «мир» · 世界和平): which of two «мир» rows is which. `index` points into the page,
// so picking the row makes the card in that sense (a word off the list has no page,
// and no index); `reading` is set only where the sense reads otherwise than the card
// (背 «нести на себе» bēi).
export type LookupSense = {
  index?: number;
  meaning: string;
  reading?: string;
  phrase?: { text: string; translation: string };
};

// Why a row is not the everyday word: written (何处), official (拨打), colloquial, regional.
export type Register = "book" | "formal" | "coll" | "dial";

export type LookupHit = {
  word: string;
  pinyin: string;
  meaning: string;
  english: boolean; // the meaning is CC-CEDICT's English (no default in the learner's language)
  hsk: HskTag | null;
  sense?: LookupSense;
  register?: Register;
};
export type Lookup = { kind: "zh" | "meaning" | "none"; hits: LookupHit[] };

const MAX_HITS = 8;

// Lowest level on either list, so 访问 (HSK 2 in 2.0, 3 in 3.0) ranks as a level-2 word.
function levelOf(word: string): number {
  const tag = hskTagFor(word);
  const levels = tag ? Object.values(tag).filter((n): n is number => typeof n === "number") : [];
  return levels.length ? Math.min(...levels) : 10;
}

// Best score first; among equals the easier word, then the more frequent ("shi": 是
// before 事, both HSK 1), then the shorter. Frequency only breaks ties: weighed into
// the score it made the Russian results worse (the audit of 2026-10-02).
function rank(scored: Map<string, number>): string[] {
  return [...scored.entries()]
    .sort(
      (a, b) =>
        b[1] - a[1] || levelOf(a[0]) - levelOf(b[0]) || hskFrequency(b[0]) - hskFrequency(a[0]) || a[0].length - b[0].length,
    )
    .slice(0, MAX_HITS)
    .map(([w]) => w);
}

// The question words' meanings end in "?" (什么 «что?»): left on, «что» never matched
// them exactly and 什么 came 8th.
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\([^)]*\)/g, " ")
    .replace(/[?!.…]/g, "")
    .replace(/\s+/g, " ")
    .trim();

// How well one dictionary phrase ("посещать", "to visit") answers the query.
// Exact beats whole-word beats "still typing it".
function phraseScore(phrase: string, q: string): number {
  const p = norm(phrase).replace(/^to /, "");
  if (!p) return 0;
  if (p === q) return 100;
  const tokens = p.split(/[^\p{L}-]+/u).filter(Boolean);
  if (tokens.includes(q)) return 60 - Math.min(20, tokens.length * 4);
  if (q.length >= 3 && p.startsWith(q)) return 45;
  if (q.length >= 3 && tokens.some((t) => t.startsWith(q))) return 25;
  return 0;
}

// --- Russian: the forms a learner types, and the word pages' senses ---

// Russian verbs come in aspect pairs and a dictionary glosses a word with one of
// them: 买 is «покупать», 看见 «увидеть», 累 «уставать». A learner types the other one
// as often, and купить, устать, выучить found nothing (the audit of 2026-10-02).
// The pairs of every verb the defaults and the pages use were written once
// (data/ru-aspect.tsv, 2,230): drafted by rule (-ывать/-авать/-ить → -ать, empty
// prefixes по-/с-/на-), each partner checked against OpenCorpora's dictionary
// (pymorphy3), then read by hand — купить/покупать, сказать/говорить, взять/брать
// are no rule's, and подписать is not писать.
let aspects: Map<string, string[]> | null = null;

function aspectPartners(verb: string): string[] {
  if (!aspects) {
    aspects = new Map();
    try {
      const text = readFileSync(fileURLToPath(new URL("../../data/ru-aspect.tsv", import.meta.url)), "utf8");
      for (const line of text.split("\n")) {
        const [a, b] = line.trim().replace(/ё/g, "е").split("\t");
        if (!a || !b) continue;
        aspects.set(a, [...(aspects.get(a) ?? []), b]);
        aspects.set(b, [...(aspects.get(b) ?? []), a]);
      }
    } catch (err) {
      console.error("[lookup] no aspect pairs — Russian verbs match only as typed", err);
    }
  }
  return aspects.get(verb) ?? [];
}

// What else a Russian query is looked up as, and how much a match on it counts:
// the verb's other aspect (купить → покупать), an adverb's adjective (быстро →
// быстрый: 快 is «быстрый»), a past participle's verb (уставший → устать, and so
// уставать). A form that is no word matches nothing, so the rules can be loose.
function ruForms(q: string): [string, number][] {
  const forms = new Map<string, number>([[q, 1]]);
  const add = (w: string, f: number) => {
    if (w.length > 2 && f > (forms.get(w) ?? 0)) forms.set(w, f);
  };
  if (!/^[а-я-]+$/.test(q)) return [...forms];
  for (const p of aspectPartners(q)) add(p, 0.9);
  if (q.length >= 4 && q.endsWith("о")) for (const end of ["ый", "ий", "ой"]) add(q.slice(0, -1) + end, 0.9);
  const participle = /^(.+[аяеиыу])(вшийся|вший|нный|тый)$/.exec(q);
  if (participle) {
    const verb = participle[1] + (participle[2] === "вшийся" ? "ться" : "ть");
    add(verb, 0.9);
    for (const p of aspectPartners(verb)) add(p, 0.85);
  }
  return [...forms];
}

// One phrase of a meaning, prepared once: a query is scored against every
// default and page sense on each keystroke. Senses in order: the first sense, and
// the first phrase in it, count for more (`bonus`). A clarifier goes before the split — «брать (в руки, с собой)»
// cut at its comma left «брать (в руки» to match only as a word inside a phrase.
type RuPhrase = { text: string; tokens: string[]; bonus: number };
type RuWord = { word: string; card: RuPhrase[]; senses: RuPhrase[][] };
let ruWords: RuWord[] | null = null;

function ruPhrases(meaning: string, lead: boolean): RuPhrase[] {
  const out: RuPhrase[] = [];
  meaning
    .replace(/\([^)]*\)/g, " ")
    .split(/\s*;\s*/)
    .forEach((sense, i) =>
      sense.split(/\s*,\s*/).forEach((phrase, j) => {
        const text = norm(phrase);
        if (text) out.push({ text, tokens: text.split(/[^\p{L}-]+/u).filter(Boolean), bonus: (lead && i === 0 ? 8 : 0) + (j === 0 ? 4 : 0) });
      }),
    );
  return out;
}

// Every HSK word's default and its page's senses. The pages carry the senses a
// one-line default leaves out (汽车 «машина», 背 «учить наизусть»), and their
// clarifiers say which sense a row answers.
function ruWordList(): RuWord[] {
  if (ruWords) return ruWords;
  ruWords = [...ruIndex()].map(([word, meaning]) => ({
    word,
    card: ruPhrases(meaning, true),
    senses: (hskPage(word, "ru")?.s ?? []).map((s, i) => ruPhrases(s.m, i === 0)),
  }));
  return ruWords;
}

// `phraseScore` on a prepared phrase. Only what was typed matches as a prefix
// ("still typing it"); a derived form must be the whole word.
function ruPhraseScore(p: RuPhrase, q: string, typed: boolean): number {
  if (p.text === q) return 100;
  if (p.tokens.includes(q)) return 60 - Math.min(20, p.tokens.length * 4);
  if (!typed || q.length < 3) return 0;
  if (p.text.startsWith(q)) return 45;
  return p.tokens.some((t) => t.startsWith(q)) ? 25 : 0;
}

function ruBest(phrases: RuPhrase[], q: string, typed: boolean): number {
  let best = 0;
  for (const p of phrases) {
    const s = ruPhraseScore(p, q, typed);
    if (s) best = Math.max(best, s + p.bonus);
  }
  return best;
}

// A page sense counts a little less than the default the card is made with, so a
// default match of the same strength wins; a later sense less than the first.
const SENSE_WEIGHT = 0.85;
// An HSK 7–9 word gives way to an HSK 1–6 one that answers nearly as well: «сказать»
// found 曰 (classical) before 说, «посмотреть» 瞅 (dialect) before 看. Measured on the
// audit's 111 everyday queries: 0 → 92 natural first, 10 → 94, 15 → 95, none worse.
const ADVANCED_PENALTY = 15;

// The Russian words learners type, each with its Chinese answers in the order a native
// speaker reaches for them and a line saying which sense each one is (BACKLOG 8c,
// data/ru-zh.jsonl): богатый → 有钱 «богатый (о человеке, при деньгах)», 富, 丰富
// «богатый (чем-то), обильный»; где → 哪儿 before 何处 (книжн.). The scorer below finds
// what the meanings say, not what people say: 有钱 is off the HSK list, 曰 and 何处 are
// exact matches, and 拨打 «звонить» beat 打电话 «звонить по телефону». Read once by one
// Claude editor and checked by a second: the 1,023 Russian words heard most often in
// films (OpenSubtitles) and the audit's everyday queries; 855 got a row, the rest the
// scorer already answers.
type RuAnswer = { w: string; si?: number; m: string; reg?: Register };
type RuEntry = { a: RuAnswer[]; x?: string[] };
let ruTable: Map<string, RuEntry> | null = null;

function ruEntry(q: string): RuEntry | undefined {
  if (!ruTable) {
    ruTable = new Map();
    for (const line of dataLines("ru-zh.jsonl", "Russian queries go by the scorer alone")) {
      const row = JSON.parse(line) as { q?: string; k?: string[]; a?: RuAnswer[]; x?: string[] };
      if (!row.q || !row.a?.length) continue;
      for (const key of row.k ?? [row.q]) ruTable.set(norm(key), { a: row.a, ...(row.x?.length ? { x: row.x } : {}) });
    }
  }
  return ruTable.get(q);
}

/**
 * Russian query → score per word, and the page sense that answers it best. `whole`:
 * the query is a word the table knows, so it was typed whole and a prefix match is
 * noise — «ключ» filled its rows with 重点, 要素 and 画龙点睛 for «ключевой».
 */
function ruMatches(q: string, whole = false): { scored: Map<string, number>; senses: Map<string, number> } {
  const forms = ruForms(q);
  const scored = new Map<string, number>();
  const senses = new Map<string, number>();
  for (const w of ruWordList()) {
    let best = 0;
    let bestSense = 0;
    let senseAt = -1;
    for (const [form, weight] of forms) {
      const typed = !whole && form === q;
      best = Math.max(best, weight * ruBest(w.card, form, typed));
      w.senses.forEach((phrases, i) => {
        const s = weight * SENSE_WEIGHT * (ruBest(phrases, form, typed) - (i ? 8 : 0));
        if (s > bestSense) [bestSense, senseAt] = [s, i];
      });
    }
    best = Math.max(best, bestSense);
    // Not an everyday word off the list (有钱): it is off the list for being everyday.
    if (best > 0) scored.set(w.word, best - (levelOf(w.word) >= 7 && !everyday.has(w.word) ? ADVANCED_PENALTY : 0));
    if (senseAt >= 0) senses.set(w.word, senseAt);
  }
  return { scored, senses };
}

// "fǎngwèn", "fang3 wen4", "fangwen" → "fangwen"; CC-CEDICT's "lu:4" → "lv".
function plainPinyin(s: string): string {
  return s
    .normalize("NFD")
    .replace(/u\u0308/g, "v") // ü (and ǚ): u + diaeresis (+ tone) once split
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/u:/g, "v")
    .replace(/[^a-z]/g, "");
}

// The subset's readings, prepared once for Latin queries. `main` is the reading
// the row shows (`mainReading`); a match on another ranks below every match on a
// shown one — 见's xiàn "to appear" put it among "xian" with jiàn on the row.
// Other proper-noun readings go (还's surname Huán), but not a word's only one:
// 汉语 is Han4 yu3 and 中国 Zhong1 guo2, and "hanyu" found nothing. A reading with
// no meaning of its own goes too: 虾's ha2 is only "used in 虾蟆", so "ha" found
// 虾 as xiā. So do pronunciation notes — 好处's "also pr. [hao3chu4]" made it an
// English match for "hao".
type PinyinEntry = { word: string; readings: { syllables: string[]; glosses: string[]; main: boolean }[] };
let pinyinIdx: Promise<PinyinEntry[]> | null = null;

function pinyinIndex(): Promise<PinyinEntry[]> {
  pinyinIdx ??= (async () => {
    const out: PinyinEntry[] = [];
    // The subset, and the everyday words the Russian table added: "youqian" → 有钱.
    ruIndex();
    const extra = [...everyday.keys()].filter((w) => !cedictHas(w)).map((w) => cedictLookup(w, { count: false }));
    for (const e of [...cedictEntries(), ...extra.filter((e): e is CedictEntry => Boolean(e))]) {
      const main = e.readings.length > 1 ? (await mainReading(e)).reading : e.readings[0];
      const readings = e.readings.flatMap((r) => {
        if (r !== main && r.pinyin[0] !== r.pinyin[0].toLowerCase()) return [];
        const glosses = r.glosses.filter(isMeaningGloss);
        return glosses.length ? [{ syllables: r.pinyin.split(" ").map(plainPinyin).filter(Boolean), glosses, main: r === main }] : [];
      });
      if (readings.length) out.push({ word: e.word, readings });
    }
    return out;
  })();
  return pinyinIdx;
}

// Does the reading start with exactly these whole syllables and go on? "hao" →
// 好处 hao chu; "ha" stays off hai, han and hang.
function startsWithSyllables(syllables: string[], py: string): boolean {
  let head = "";
  for (let i = 0; i < syllables.length - 1 && head.length < py.length; i++) {
    head += syllables[i];
    if (head === py) return true;
  }
  return false;
}

// Longest known word at each position — for a phrase typed or drawn whole
// ("拜访老师"), so the learner can pick the word they meant out of it. A list word
// first; where none longer than a character starts, a word from the rest of
// CC-CEDICT: 背单词 was 背 | 单 | 词, because 单词 is off the list.
function wordsIn(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let len = Math.min(4, text.length - i);
    while (len > 1 && !cedictHas(text.slice(i, i + len))) len--;
    if (len === 1) {
      len = Math.min(4, text.length - i);
      while (len > 1 && !cedictKnows(text.slice(i, i + len))) len--;
    }
    const w = text.slice(i, i + len);
    if (cedictKnows(w) && !out.includes(w)) out.push(w);
    i += len;
  }
  return out;
}

// A row of the add form. `senseAt` is the page sense the query matched; `answer` the
// table's row for it, whose line says which sense of the Russian word this is.
async function hit(word: string, lang: string, senseAt?: number, answer?: RuAnswer): Promise<LookupHit | null> {
  const card = await cedictCard(word, { count: false });
  if (!card) return null;
  const meaning = defaultMeaning(word, lang);
  const s = senseAt === undefined ? undefined : hskPage(word, "ru")?.s[senseAt];
  const phrase = s?.p[0] ? { text: s.p[0].t, translation: s.p[0].ru } : answer ? everyday.get(word) : undefined;
  const sense: LookupSense | undefined =
    s || answer
      ? {
          ...(s ? { index: senseAt } : {}),
          meaning: answer?.m ?? s!.m,
          ...(s?.r && !readsAs(word, s.r, card.phonetic) ? { reading: s.r } : {}),
          ...(phrase ? { phrase } : {}),
        }
      : undefined;
  return {
    word,
    pinyin: card.phonetic,
    meaning: meaning ?? card.gloss,
    english: !meaning,
    hsk: hskTagFor(word),
    ...(sense ? { sense } : {}),
    ...(answer?.reg ? { register: answer.reg } : {}),
  };
}

/**
 * The add form's dictionary, with no model call. Hanzi: the word itself, then
 * longer words that start with it (so a character drawn on the pad already
 * offers 访问 for 访), or the words inside a phrase. Anything else is a meaning
 * or pinyin: Cyrillic is matched against the default Russian meanings and the
 * word pages' senses, in the forms a learner types (`ruForms`), and each row
 * says which sense it answers; Latin against pinyin and CC-CEDICT's English.
 * Easier words rank first — a learner typing «посещать» wants 访问 before 造访.
 */
export async function lookup(query: string, lang: string): Promise<Lookup> {
  const q = query.trim().slice(0, 40);
  if (!q) return { kind: "none", hits: [] };

  let words: string[];
  let kind: Lookup["kind"];
  if (/\p{Script=Han}/u.test(q)) {
    kind = "zh";
    const head = normalizeHanzi(q);
    const scored = new Map<string, number>();
    // The word itself from all of CC-CEDICT: a word met outside the list (算法) is
    // still what the learner typed, not 算 and 法. Off the list it comes after the
    // list words it starts — 访 drawn on the pad is on the way to 访问. Those stay
    // on the subset: the full dump would bury 好's under idioms.
    if (cedictHas(head)) scored.set(head, 1000);
    else if (cedictKnows(head)) scored.set(head, 5);
    for (const e of cedictEntries()) if (e.word !== head && e.word.startsWith(head)) scored.set(e.word, 10);
    words = rank(scored);
    if (!words.length && head.length > 1) words = wordsIn(head).slice(0, MAX_HITS);
  } else {
    kind = "meaning";
    const nq = norm(q).replace(/^to /, "");
    if (nq.length < 2) return { kind, hits: [] };
    const scored = new Map<string, number>();
    if (/\p{Script=Cyrillic}/u.test(nq)) {
      // The table's answers first, in its order; then the scorer's, less those it says
      // don't answer the word at all («ключ» → 拳头 «ключевой»).
      const entry = ruEntry(nq);
      const ru = ruMatches(nq, Boolean(entry));
      const answers = entry?.a ?? [];
      const skip = new Set([...answers.map((a) => a.w), ...(entry?.x ?? [])]);
      const rest = rank(new Map([...ru.scored].filter(([w]) => !skip.has(w)))).slice(0, Math.max(0, MAX_HITS - answers.length));
      const hits = await Promise.all([
        ...answers.slice(0, MAX_HITS).map((a) => hit(a.w, lang, a.si, a)),
        ...rest.map((w) => hit(w, lang, ru.senses.get(w))),
      ]);
      return { kind, hits: hits.filter((h): h is LookupHit => Boolean(h)) };
    } else {
      const py = plainPinyin(q);
      for (const e of await pinyinIndex()) {
        let s = 0;
        for (const r of e.readings) {
          const p = r.syllables.join("");
          let ps = 0;
          if (py && p === py) ps = 90;
          // The words a syllable starts, after the words it is: 好 and 号, then 好处.
          else if (py && startsWithSyllables(r.syllables, py)) ps = 40;
          else if (py.length >= 4 && p.startsWith(py)) ps = 20;
          s = Math.max(s, r.main ? ps : ps / 3);
          // Sense order counts, as in `ruPhrases`: "to visit" is 访问's first
          // sense and only a late one of 走, which would otherwise win as the easier word.
          r.glosses.forEach((g, i) => {
            // A gloss is often several phrases: "to visit; to call on (a person or place)".
            const gs = Math.max(...g.split(/\s*;\s*/).map((part) => phraseScore(part, nq)));
            if (gs) s = Math.max(s, gs * 0.8 + (i === 0 ? 8 : i === 1 ? 4 : 0));
          });
        }
        if (s) scored.set(e.word, s);
      }
    }
    words = rank(scored);
  }

  const hits = (await Promise.all(words.map((w) => hit(w, lang)))).filter((h): h is LookupHit => Boolean(h));
  return { kind, hits };
}

// --- The rows the default doesn't cover, in the learner's language ---

const glossSchema = z.object({
  items: z.array(z.object({ word: z.string(), meaning: z.string().default("") })).default([]),
});
// word|lang → meaning, for the life of the process: the same rows come back as the
// learner types on, and the dictionary under them doesn't change.
const glossCache = new Map<string, string>();
const GLOSS_CACHE_MAX = 20_000;

/**
 * A lookup row off the HSK list (有钱) has only CC-CEDICT's English, a third
 * language to a Russian speaker. The lookup itself stays instant and model-free;
 * the form asks for these after it, and the row switches from the English once
 * they land. One fast call for the rows not cached, grounded on the dictionary's
 * senses (pick and translate, never invent). An English interface keeps the
 * English: the rows follow the interface language, not the card's (2026-10-02).
 */
export async function translateGlosses(words: string[], lang: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  // A Chinese interface keeps the English: a gloss in Chinese would only restate the word.
  if (!lang || lang === "en" || isChinese(lang)) return out;
  const todo: { word: string; senses: string }[] = [];
  for (const word of new Set(words.map((w) => w.trim()).filter(Boolean).slice(0, MAX_HITS))) {
    const cached = glossCache.get(`${word}|${lang}`);
    if (cached) {
      out[word] = cached;
      continue;
    }
    const card = await cedictCard(word, { count: false });
    if (card && !defaultMeaning(word, lang)) todo.push({ word, senses: card.gloss });
  }
  if (!todo.length) return out;
  const r = await chatJson({
    system:
      `You write dictionary meanings for a ${langName(lang)} speaker learning Chinese. For each item, give the ` +
      `word's meaning in ${langName(lang)}: its senses in the order given, 1–4 words each, separated by "; ", at ` +
      `most three. Base it on the English dictionary senses given — pick and translate, don't invent. Keep the ` +
      `words exactly as given. Respond as JSON: {"items":[{"word": string, "meaning": string}]}.`,
    user: JSON.stringify(todo),
    schema: glossSchema,
    model: FAST_MODEL,
    label: "lookup.gloss",
  });
  const asked = new Set(todo.map((t) => t.word));
  for (const it of r.items ?? []) {
    const word = it.word.trim();
    const meaning = (it.meaning ?? "").trim();
    if (!asked.has(word) || !meaning) continue;
    out[word] = meaning;
    if (glossCache.size >= GLOSS_CACHE_MAX) glossCache.delete(glossCache.keys().next().value!);
    glossCache.set(`${word}|${lang}`, meaning);
  }
  return out;
}
