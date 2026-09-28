// What makes an HSK word page right — shared by scripts/build-hsk-pages.ts, which
// writes them, and scripts/check-word-pages.ts, which reads the shipped file back
// through the same rules. Not a script of its own.
import { cedictLookup, isMeaningGloss, toneMarked } from "../src/services/cedict.js";
import { headGloss, readingInPhrase, readsAs, type WordPage } from "../src/services/wordPages.js";
import { hskTagFor } from "../src/services/hsk.js";

// --- The inventory the model picks from ---

export type Gloss = { n: number; reading: string; text: string; rare: boolean };

// Glosses a learner's page leaves out unless the word has nothing else. "(Taiwan pr. …)"
// is how Taiwan says it, not a Taiwan-only sense: 和's "and" carries one.
const RARE = /\((archaic|literary|old|dialect|vulgar|slang|Cantonese|classical|obsolete|Buddhism)\b|\((Taiwan|Tw)\b(?! pr\.)/i;
const MAX_GLOSSES = 24;

/**
 * CC-CEDICT's senses for a word, numbered straight through its readings so a sense
 * can cite them ("refs": [2, 3]) and the check can see which reading it is under.
 * Proper-noun readings (Huan2, the surname) and cross-references are left out —
 * unless the word has no other (中国, 汉语, 春节 are Zhong1 guo2 …); each reading
 * gets a share of the budget, as in `cedictInventory`.
 */
export function pageInventory(word: string): Gloss[] | null {
  const entry = cedictLookup(word, { count: false });
  if (!entry) return null;
  const common = entry.readings.filter((r) => r.pinyin[0] === r.pinyin[0].toLowerCase());
  const readings = common.length ? common : entry.readings;
  const share = Math.max(4, Math.floor(MAX_GLOSSES / Math.max(1, readings.length)));
  const out: Gloss[] = [];
  for (const r of readings)
    for (const g of r.glosses.filter(isMeaningGloss).slice(0, share))
      out.push({ n: out.length + 1, reading: toneMarked(r.pinyin), text: g, rare: RARE.test(g) });
  return out.length ? out : null;
}

/** The inventory as the prompt shows it: one line per reading. */
export function inventoryText(inv: Gloss[]): string {
  const lines = new Map<string, string[]>();
  for (const g of inv) lines.set(g.reading, [...(lines.get(g.reading) ?? []), `${g.n}. ${g.text}`]);
  return [...lines].map(([r, gs]) => `[${r}] ${gs.join(" | ")}`).join("\n");
}

// --- A page as the model writes it ---

export type DraftPhrase = { text: string; reading: string; translation: string };
export type DraftSense = { refs: number[]; pos: string; meaning: string; phrases: DraftPhrase[] };
export type Draft = { pos: string; senses: DraftSense[]; synonyms: string[]; antonyms: string[] };

/** The word as the list gives it: the reading its card shows and its meaning (`hsk-ru`). */
export type ListWord = { word: string; pinyin: string; level: number; meaning: string };

// `hard`: the part can't be shown (dropped if a rewrite doesn't fix it). Soft: shown,
// noted for the hand read.
export type Problem = { sense?: number; phrase?: number; note: string; hard: boolean };

/** The parts of speech a page may name, in the prompt's words; a sense may join two ("прилагательное / наречие"). */
export const POS = [
  "существительное", "глагол", "прилагательное", "наречие", "местоимение", "числительное", "счётное слово",
  "предлог", "союз", "частица", "междометие", "модальный глагол", "устойчивое выражение",
];
const yo = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е");
const knownPos = (s: string) => s.split("/").every((p) => POS.some((q) => yo(q) === yo(p)));

const HAN = /\p{Script=Han}/u;
const russian = (s: string) => /\p{Script=Cyrillic}/u.test(s) && !HAN.test(s);
// English left in the Russian: the model carries CC-CEDICT's gloss over («редко, seldom»,
// «tolerировать»). Names and acronyms are capitalised (Apple, WeChat, SMS); email is Russian now.
const englishIn = (s: string) => (s.match(/\b[a-z]{3,}\b/g) ?? []).filter((x) => x !== "email");
const hanOf = (s: string) => Array.from(s).filter((ch) => HAN.test(ch)).join("");

/** The reading a sense is under: its refs' one reading, or null when they don't agree. */
export function senseReading(s: DraftSense, inv: Gloss[]): string | null {
  const rs = new Set(s.refs.map((n) => inv[n - 1]?.reading).filter(Boolean));
  return rs.size === 1 ? [...rs][0]! : null;
}

/** Everything wrong with a draft, as notes a rewrite can act on. */
export function pageProblems(w: ListWord, d: Draft, inv: Gloss[]): Problem[] {
  const out: Problem[] = [];
  if (!d.senses.length) return [{ note: "no senses: give 1–5 from the inventory", hard: true }];
  d.senses.forEach((s, i) => {
    const at = { sense: i + 1 };
    const bad = s.refs.filter((n) => !inv[n - 1]);
    if (!s.refs.length) out.push({ ...at, note: "give the numbers of the inventory glosses it covers in \"refs\"", hard: true });
    else if (bad.length) out.push({ ...at, note: `refs ${bad.join(", ")} are not in the inventory: every sense must be one of its glosses`, hard: true });
    const reading = senseReading(s, inv);
    if (s.refs.length && !bad.length && !reading)
      out.push({ ...at, note: "its refs are under different readings: one reading per sense, split it", hard: true });
    if (s.refs.length && !bad.length && s.refs.every((n) => inv[n - 1].rare) && inv.some((g) => !g.rare))
      out.push({ ...at, note: "a rare, literary, dialect or slang sense: leave it out", hard: true });
    if (!russian(s.meaning)) out.push({ ...at, note: "\"meaning\" must be Russian", hard: true });
    else if (englishIn(s.meaning).length)
      out.push({ ...at, note: `"meaning" has English in it (${englishIn(s.meaning).join(", ")}): all Russian`, hard: false });
    if (!s.pos.trim()) out.push({ ...at, note: "give its part of speech", hard: false });
    else if (!knownPos(s.pos)) out.push({ ...at, note: `"pos" "${s.pos}" is not a part of speech: one of ${POS.join(", ")}`, hard: false });
    if (s.phrases.length < 2) out.push({ ...at, note: "give 2 phrases", hard: false });
    s.phrases.forEach((p, j) => {
      const here = { ...at, phrase: j + 1 };
      if (!hanOf(p.text).includes(w.word)) {
        out.push({ ...here, note: `it must contain "${w.word}" written exactly so`, hard: true });
        return;
      }
      const got = readingInPhrase(w.word, p.text, p.reading);
      if (got === null)
        out.push({ ...here, note: "\"reading\": one pinyin syllable per character, separated by spaces", hard: true });
      else if (reading && !readsAs(w.word, got, reading))
        out.push({ ...here, note: `"${w.word}" in this sense is read ${reading}; this phrase reads it otherwise — use it in this sense`, hard: true });
      if (!russian(p.translation)) out.push({ ...here, note: "\"translation\" must be Russian", hard: true });
      else if (englishIn(p.translation).length)
        out.push({ ...here, note: `"translation" has English in it (${englishIn(p.translation).join(", ")}): all Russian`, hard: false });
      // Not "the word as a word of its own", as a pool sentence must have it: 上课 and
      // 打电话 are one word to jieba and exactly the collocations a page is for.
      if (hanOf(p.text) === w.word)
        out.push({ ...here, note: `a collocation of "${w.word}" with another word, not the word alone`, hard: true });
      else if (hanOf(p.text).length > 10) out.push({ ...here, note: "shorter: a phrase or collocation, not a sentence", hard: false });
    });
  });
  // Senses differ in meaning, not in grammar: two citing one gloss are one sense.
  // And a phrase shows one sense: the same one under two (打架, 过年) is in the wrong place once.
  d.senses.forEach((s, i) => {
    const j = d.senses.findIndex((t, k) => k < i && t.refs.some((n) => s.refs.includes(n)));
    if (j >= 0) out.push({ sense: i + 1, note: `cites the same gloss as sense ${j + 1}: merge them into one sense`, hard: false });
    s.phrases.forEach((p, pi) => {
      const k = d.senses.findIndex((t, ti) => ti < i && t.phrases.some((q) => hanOf(q.text) === hanOf(p.text)));
      if (k >= 0) out.push({ sense: i + 1, phrase: pi + 1, note: `"${p.text}" is already under sense ${k + 1}: a phrase for this sense only`, hard: false });
    });
  });
  // The card's meaning is on the page: each of its segments opens a sense (the
  // word page ticks the senses the card tests by exactly this rule).
  const heads = new Set(d.senses.map((s) => headGloss(s.meaning)));
  for (const seg of w.meaning.split(/[;；]/).map((x) => x.trim()).filter(Boolean)) {
    const head = headGloss(seg);
    if (head && !heads.has(head))
      out.push({ note: `the card says "${seg}": make it one of the senses, its "meaning" starting with "${head}"`, hard: false });
  }
  // At least one sense under the reading the card shows, when the dictionary has it.
  if (inv.some((g) => readsAs(w.word, g.reading, w.pinyin)) && !d.senses.some((s) => {
    const r = senseReading(s, inv);
    return r !== null && readsAs(w.word, r, w.pinyin);
  }))
    out.push({ note: `no sense is read ${w.pinyin}, the reading on the card: include its most common one`, hard: false });
  if (!d.pos.trim()) out.push({ note: "give the card's part of speech in \"pos\"", hard: false });
  else if (!knownPos(d.pos)) out.push({ note: `"pos" "${d.pos}" is not a part of speech: one of ${POS.join(", ")}`, hard: false });
  return out;
}

/** How the problems read in a rewrite request. */
export function problemText(ps: Problem[]): string {
  return ps
    .map((p) => (p.sense ? `sense ${p.sense}${p.phrase ? `, phrase ${p.phrase}` : ""}: ` : "") + p.note)
    .join("; ");
}

// A family word is one of the list's own: a word a learner uses on its own (not 良 or
// 疾, which live inside compounds, nor 鄙人), and a tap on it makes a card with a page.
const cleanWords = (list: string[], self: string, max: number) =>
  [...new Set(list.map((s) => hanOf(s)).filter((s) => s && s !== self && hskTagFor(s)))].slice(0, max);

/**
 * What of a draft can be shown: the parts with a hard problem go (a phrase, or a
 * sense left without a phrase), at most five senses; the soft notes stay on it for
 * the hand read. null when no sense survives.
 */
export function pageOf(w: ListWord, d: Draft, inv: Gloss[]): WordPage | null {
  const ps = pageProblems(w, d, inv);
  const hardAt = (i: number, j?: number) =>
    ps.some((p) => p.hard && p.sense === i + 1 && (j === undefined ? p.phrase === undefined : p.phrase === j + 1));
  const senses = d.senses
    .map((s, i) => ({ s, i }))
    .filter(({ i }) => !hardAt(i))
    .map(({ s, i }) => ({
      r: senseReading(s, inv) ?? "",
      pos: s.pos.trim(),
      m: s.meaning.trim(),
      g: s.refs,
      p: s.phrases
        .filter((_, j) => !hardAt(i, j))
        .slice(0, 2)
        .map((p) => ({ t: p.text.trim(), r: p.reading.trim(), ru: p.translation.trim() })),
    }))
    .filter((s) => s.p.length)
    .slice(0, 5);
  if (!senses.length) return null;
  const page: WordPage = {
    w: w.word,
    pos: d.pos.trim(),
    s: senses,
    syn: cleanWords(d.synonyms, w.word, 4),
    ant: cleanWords(d.antonyms, w.word, 3),
  };
  const notes = pageProblems(w, draftOf(page), inv).map((p) => problemText([p]));
  return notes.length ? { ...page, f: notes } : page;
}

/** A shipped page back in the draft's shape, to run the rules over it again. */
export function draftOf(page: WordPage): Draft {
  return {
    pos: page.pos,
    senses: page.s.map((s) => ({
      refs: s.g,
      pos: s.pos,
      meaning: s.m,
      phrases: s.p.map((p) => ({ text: p.t, reading: p.r, translation: p.ru })),
    })),
    synonyms: page.syn,
    antonyms: page.ant,
  };
}

/** Hard problems first, then soft: the lower, the better. */
export const score = (ps: Problem[]) => ps.reduce((n, p) => n + (p.hard ? 100 : 1), 0);
