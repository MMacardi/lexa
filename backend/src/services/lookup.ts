import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { cedictCard, cedictEntries, cedictHas, cedictLookup, isChinese } from "./cedict.js";
import { hskTagFor, normalizeHanzi, type HskTag } from "./hsk.js";

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

function ruIndex(): Map<string, string> {
  if (ru) return ru;
  ru = new Map();
  // `../../data` is the same directory from src/services and from dist/services.
  const path = fileURLToPath(new URL("../../data/hsk-ru.jsonl", import.meta.url));
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    console.error("[lookup] no default meanings at", path, "— cards start in English", err);
    return ru;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim(); // CRLF on a Windows checkout, as with cedict.jsonl
    if (!line) continue;
    const row = JSON.parse(line) as { s?: string; m?: string };
    if (row.s && row.m) ru.set(row.s, row.m);
  }
  return ru;
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

export type LookupHit = {
  word: string;
  pinyin: string;
  meaning: string;
  english: boolean; // the meaning is CC-CEDICT's English (no default in the learner's language)
  hsk: HskTag | null;
};
export type Lookup = { kind: "zh" | "meaning" | "none"; hits: LookupHit[] };

const MAX_HITS = 6;

// Lowest level on either list, so 访问 (HSK 2 in 2.0, 3 in 3.0) ranks as a level-2 word.
function levelOf(word: string): number {
  const tag = hskTagFor(word);
  const levels = tag ? Object.values(tag).filter((n): n is number => typeof n === "number") : [];
  return levels.length ? Math.min(...levels) : 10;
}

// Best score first; among equals the easier (more common) word, then the shorter.
function rank(scored: Map<string, number>): string[] {
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1] || levelOf(a[0]) - levelOf(b[0]) || a[0].length - b[0].length)
    .slice(0, MAX_HITS)
    .map(([w]) => w);
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\([^)]*\)/g, " ")
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

// Senses in order; the first sense, and the first phrase in it, count for more.
function meaningScore(meaning: string, q: string): number {
  let best = 0;
  meaning.split(/\s*;\s*/).forEach((sense, i) => {
    sense.split(/\s*,\s*/).forEach((phrase, j) => {
      const s = phraseScore(phrase, q);
      if (s) best = Math.max(best, s + (i === 0 ? 8 : 0) + (j === 0 ? 4 : 0));
    });
  });
  return best;
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

// Longest known word at each position — for a phrase typed or drawn whole
// ("拜访老师"), so the learner can pick the word they meant out of it.
function wordsIn(text: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < text.length) {
    let len = Math.min(4, text.length - i);
    while (len > 1 && !cedictHas(text.slice(i, i + len))) len--;
    const w = text.slice(i, i + len);
    if (cedictHas(w) && !out.includes(w)) out.push(w);
    i += len;
  }
  return out;
}

async function hit(word: string, lang: string): Promise<LookupHit | null> {
  const card = await cedictCard(word, { count: false });
  if (!card) return null;
  const meaning = defaultMeaning(word, lang);
  return { word, pinyin: card.phonetic, meaning: meaning ?? card.gloss, english: !meaning, hsk: hskTagFor(word) };
}

/**
 * The add form's dictionary, with no model call. Hanzi: the word itself, then
 * longer words that start with it (so a character drawn on the pad already
 * offers 访问 for 访), or the words inside a phrase. Anything else is a meaning
 * or pinyin: Cyrillic is matched against the default Russian meanings, Latin
 * against pinyin and CC-CEDICT's English. Easier words rank first — a learner
 * typing «посещать» wants 访问 before 造访.
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
    if (cedictHas(head)) scored.set(head, 1000);
    for (const e of cedictEntries()) if (e.word !== head && e.word.startsWith(head)) scored.set(e.word, 10);
    words = rank(scored);
    if (!words.length && head.length > 1) words = wordsIn(head).slice(0, MAX_HITS);
  } else {
    kind = "meaning";
    const nq = norm(q).replace(/^to /, "");
    if (nq.length < 2) return { kind, hits: [] };
    const scored = new Map<string, number>();
    if (/\p{Script=Cyrillic}/u.test(nq)) {
      for (const [word, meaning] of ruIndex()) {
        const s = meaningScore(meaning, nq);
        if (s) scored.set(word, s);
      }
    } else {
      const py = plainPinyin(q);
      for (const e of cedictEntries()) {
        let s = 0;
        for (const r of e.readings) {
          // Proper-noun readings (capitalised) aren't what a learner types pinyin for.
          if (r.pinyin[0] !== r.pinyin[0].toLowerCase()) continue;
          const p = plainPinyin(r.pinyin);
          if (py && p === py) s = Math.max(s, 90);
          else if (py.length >= 4 && p.startsWith(py)) s = Math.max(s, 20);
          // Sense order counts, as in `meaningScore`: "to visit" is 访问's first
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
