import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { WordSense } from "../lib/schemas.js";
import { hskReading, normalizeHanzi } from "./hsk.js";

/**
 * HSK word pages, written once for everyone (BACKLOG "HSK word pages, written once").
 *
 * The word page's Meanings list and word family used to be a model call per card,
 * made on its first open and kept on that card only — so every learner waited for
 * the same word, and in a beta of five nearly every open is a first open. For the
 * 11.4k HSK headwords (1–9) they are now data (`scripts/build-hsk-pages.ts` →
 * `data/hsk-pages.jsonl`), checked before anyone sees them
 * (`scripts/check-word-pages.ts`): each sense grounded in CC-CEDICT's inventory and
 * under one of its readings, two phrases per sense read that way, the card's own
 * meaning among the senses. Derived from CC-CEDICT, so CC BY-SA and credited.
 *
 * In Russian only, like `hsk-ru` and the sentence pool: a learner in another
 * language, and every word off the lists, keeps the per-card path in `vocab.ts`.
 *
 * The situation tags (`data/hsk-situations.jsonl`, `scripts/build-hsk-situations.ts`)
 * ride along for the next-word order: a day of airport words (护照 登机 行李) sticks
 * better than 护照 而且 菜单 发烧. They live in their own file so the tag set can
 * change without writing the pages again.
 */

// `r` the sense's reading as the dictionary has it, tone-marked; `g` the numbers of
// the inventory glosses it was grounded in (the build's check, kept for `--redo`).
export type PagePhrase = { t: string; r: string; ru: string };
export type PageSense = { r: string; pos: string; m: string; g: number[]; p: PagePhrase[] };
// `pos` is the card's own part of speech (its first sense's); `f` the check's
// notes the build could not fix, kept for the hand read.
export type WordPage = { w: string; pos: string; s: PageSense[]; syn: string[]; ant: string[]; f?: string[] };

/**
 * The scenes a word can be met in, 0–2 per word. Concrete places and occasions,
 * not grammar or topic categories: words that belong everywhere (是 而 觉得 高兴)
 * get none, and ten colours are a category, not a scene.
 */
export const SITUATIONS = {
  airport: "airport, flights, passport control",
  transit: "train, bus, metro, tickets",
  driving: "taxi, car, driving, traffic",
  directions: "asking the way, maps, places in a town",
  hotel: "hotel, check-in, rooms",
  sightseeing: "sightseeing, tourist sights, tours",
  restaurant: "restaurant, café, ordering, paying the bill",
  cooking: "cooking, kitchen, recipes",
  market: "market, groceries, fruit and vegetables",
  shopping: "shops, prices, paying, returns",
  clothes: "clothes, shoes, sizes",
  doctor: "doctor, hospital, symptoms, treatment",
  pharmacy: "pharmacy, medicine, colds and illness",
  fitness: "sport, gym, fitness, matches",
  bank: "bank, money, cards, exchange",
  delivery: "post, parcels, delivery, couriers",
  phone: "phone calls, messaging, apps",
  social_media: "social media, posts, followers, online life",
  computers: "computers, software, the internet, IT work",
  office: "office, colleagues, meetings, reports",
  job_search: "job hunting, CVs, interviews, salaries",
  business: "business, trade, contracts, customers",
  factory: "factory, production, machines, workers",
  classroom: "classroom, lessons, homework, teachers",
  exams: "exams, tests, scores, studying for them",
  university: "university, research, theses, lectures",
  housework: "home, housework, furniture, repairs",
  renting: "renting a flat, moving, neighbours, landlords",
  family: "family, relatives, raising children",
  dating: "friends, dating, love, relationships",
  wedding: "weddings, births, family occasions",
  party: "parties, invitations, celebrations",
  festivals: "Chinese festivals, customs, gifts",
  hobbies: "hobbies, games, free time",
  arts: "music, film, art, performances",
  books: "books, reading, writing, libraries",
  weather: "weather, seasons, climate",
  nature: "nature, animals, plants, the outdoors",
  countryside: "countryside, farming, villages",
  city: "the city, streets, neighbourhoods, city life",
  police: "police, law, courts, crime",
  news: "news, politics, government",
  economy: "the economy, society, prices, markets",
  environment: "environment, pollution, energy",
  science: "science, technology, experiments",
  history: "history, culture, traditions",
  army: "army, war, the military",
} as const;
export type Situation = keyof typeof SITUATIONS;

// `../../data` is the same directory from src/services and from dist/services.
function loadJsonl<T>(name: string, what: string, keep: (row: T & { w?: string }) => boolean): Map<string, T> {
  const out = new Map<string, T>();
  const path = fileURLToPath(new URL(`../../data/${name}`, import.meta.url));
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    console.warn(`[wordPages] no ${name} — ${what}`);
    return out;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim(); // CRLF on a Windows checkout
    if (!line) continue;
    const row = JSON.parse(line) as T & { w?: string };
    if (row.w && keep(row)) out.set(row.w, row);
  }
  return out;
}

let pages: Map<string, WordPage> | null = null;
let situations: Map<string, { w: string; s: Situation[] }> | null = null;

// An 儿 word is kept under its base, as a card is (一下儿 → 一下, services/capture.ts) —
// when the 儿 is the erhua r: 婴儿 yīng ér is not 婴, nor 孤儿 «одинокий».
function byHead<T>(index: Map<string, T>, word: string): T | null {
  const head = normalizeHanzi(word);
  if (!head) return null;
  const erhua = head.length > 1 && head.endsWith("儿") && !/ér$/.test(hskReading(head) ?? "");
  return index.get(head) ?? (erhua ? index.get(head.slice(0, -1)) : undefined) ?? null;
}

/** An HSK word's page, or null (off the lists, not built yet, or not in Russian). */
export function hskPage(word: string, targetLang: string | null | undefined): WordPage | null {
  if (targetLang !== "ru") return null;
  pages ??= loadJsonl<WordPage>("hsk-pages.jsonl", "every word page is written per card", (row) => Boolean(row.s?.length));
  return byHead(pages, word);
}

/** The scenes an HSK word is met in; [] for a word that belongs to none (or untagged). */
export function hskSituations(word: string): Situation[] {
  situations ??= loadJsonl<{ w: string; s: Situation[] }>("hsk-situations.jsonl", "no word has a situation", () => true);
  return byHead(situations, word)?.s ?? [];
}

// --- Readings, compared the way speech bends them ---

type Syllable = { base: string; tone: number };
const MARK_TONE: Record<string, number> = { "̄": 1, "́": 2, "̌": 3, "̀": 4 };

/**
 * Pinyin as syllables, tone-marked (hái) or numbered (hai2), ü as v. An erhua "r"
 * written apart (CC-CEDICT's na3 r5) joins the syllable before it, as nǎr does.
 */
export function syllables(pinyin: string): Syllable[] {
  const out: Syllable[] = [];
  for (const raw of pinyin.toLowerCase().normalize("NFD").split(/[\s'’·\-]+/)) {
    let base = "";
    let tone = 5;
    for (const ch of raw) {
      if (MARK_TONE[ch]) tone = MARK_TONE[ch];
      else if (ch === "̈" || ch === ":") base += ":";
      else if (/[1-5]/.test(ch)) tone = Number(ch);
      else if (/[a-z]/.test(ch)) base += ch;
    }
    base = base.replace(/u:|v/g, "v");
    if (!base) continue;
    const prev = out[out.length - 1];
    if (base === "r" && prev) prev.base += "r";
    else out.push({ base, tone });
  }
  return out;
}

/**
 * One syllable read the same, tones aside from what speech changes: 一 and 不
 * (yí xià), a third tone before another (ní hǎo), and — only inside a longer word —
 * a neutral tone the dictionary and the speaker disagree on (好处 hǎo chu / chù).
 * On its own a neutral tone is a different word: 得 de is not dé.
 */
function sameSyllable(a: Syllable, b: Syllable, ch: string, longer: boolean): boolean {
  // 点 in 一点儿 is diǎnr: the r is the 儿's, not another syllable (er is one of its own).
  const bare = (s: string) => (s.length > 2 && s.endsWith("r") ? s.slice(0, -1) : s);
  if (bare(a.base) !== bare(b.base)) return false;
  if (a.tone === b.tone || ch === "一" || ch === "不") return true;
  if ((a.tone === 2 && b.tone === 3) || (a.tone === 3 && b.tone === 2)) return true;
  return longer && (a.tone === 5 || b.tone === 5);
}

/** Does `got` read the word as `expected` does? */
export function readsAs(word: string, got: string, expected: string): boolean {
  const g = syllables(got);
  const e = syllables(expected);
  if (!g.length || g.length !== e.length) return false;
  // 儿 that joined a syllable has none of its own.
  const chars = Array.from(normalizeHanzi(word)).filter((ch, i, all) => !(ch === "儿" && i > 0 && all.length > e.length));
  return g.every((s, i) => sameSyllable(s, e[i], chars[i] ?? "", chars.length > 1));
}

/**
 * The syllables of a phrase's pinyin laid on its characters — null where they don't
 * line up. 儿 after a syllable that took its r (diǎnr) has none of its own.
 */
export function alignReading(text: string, reading: string): (Syllable | null)[] | null {
  const chars = Array.from(text).filter((ch) => /\p{Script=Han}/u.test(ch));
  const syls = syllables(reading);
  const out: (Syllable | null)[] = [];
  let j = 0;
  for (let i = 0; i < chars.length; i++) {
    const prev = syls[j - 1];
    if (chars[i] === "儿" && i > 0 && prev && prev.base.endsWith("r") && prev.base !== "er") {
      out.push(null);
      continue;
    }
    if (j >= syls.length) return null;
    out.push(syls[j++]);
  }
  return j === syls.length ? out : null;
}

/** The reading a phrase gives the word inside it, numbered (hai2); null when it isn't there or doesn't line up. */
export function readingInPhrase(word: string, text: string, reading: string): string | null {
  const head = Array.from(normalizeHanzi(word));
  const chars = Array.from(text).filter((ch) => /\p{Script=Han}/u.test(ch));
  const at = chars.findIndex((_, i) => head.every((ch, k) => chars[i + k] === ch));
  if (at < 0) return null;
  const aligned = alignReading(text, reading);
  if (!aligned) return null;
  return aligned
    .slice(at, at + head.length)
    .filter((s): s is Syllable => s !== null)
    .map((s) => s.base + s.tone)
    .join(" ");
}

// --- On the word page ---

// The leading gloss of a sense or of one segment of a card's meaning:
// "指明，指出（位置、方向、人或物）" -> "指明", "показать, продемонстрировать" -> "показать".
// A card's meaning ticks the senses that open with one of its segments
// (`flagByMeaning` in vocab.ts), and the build checks by the same rule.
export const headGloss = (s: string) =>
  (s.replace(/\s*[(（][^)）]*[)）]/g, " ").split(/[;；,，、/]/)[0] ?? "").trim().toLowerCase();

/**
 * The page as the word page's sense list. A sense under another reading than the
 * card's says so (还 hái → "huán: возвращать"); the ticks are the caller's, read
 * off the card's meaning.
 */
export function pageSenses(page: WordPage, cardReading: string | null | undefined): WordSense[] {
  // A card read as CC-CEDICT never writes it (下载 xià zài, 血 xiě: the official list's;
  // the dictionary has xià zǎi, xuè) has its senses under the dictionary's spelling,
  // which the page leads with: that is the card's reading, not another one to label.
  const own = cardReading && !page.s.some((s) => readsAs(page.w, s.r, cardReading)) ? page.s[0]?.r : null;
  return page.s.map((s) => ({
    pos: s.pos,
    meaning: s.m,
    onCard: false,
    phrases: s.p.map((p) => ({ text: p.t, reading: p.r, translation: p.ru })),
    ...(cardReading && s.r && s.r !== own && !readsAs(page.w, s.r, cardReading) ? { reading: s.r } : {}),
  }));
}
