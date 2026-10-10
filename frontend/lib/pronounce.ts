// Score how close a spoken attempt is to the target word/phrase, using the text
// the browser's speech recogniser returns as a proxy for the sound. This is NOT a
// phoneme scorer — but it reliably tells "got it" from "way off", which is enough
// for an encouraging self-check. Zero server cost (recognition is on-device).

function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // drop diacritics (café → cafe)
    .replace(/^to\s+/, "") // English infinitive marker ("to get by" ~ "get by")
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // punctuation → space
    .replace(/\s+/g, " ")
    .trim();
}

// Classic Levenshtein edit distance (two-row DP).
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function ratio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (!max) return 1;
  return 1 - levenshtein(a, b) / max;
}

export type PronounceBand = "great" | "close" | "off";

export interface PronounceScore {
  score: number; // 0..1 similarity of the best-matching candidate
  heard: string; // that candidate, as the engine returned it
  band: PronounceBand;
  heardPinyin?: string; // Chinese: what was heard, with the tones it was heard in
}

const HAN = /\p{Script=Han}/u;

/**
 * Best similarity between `target` and any of the recogniser's `candidates`.
 * A single-word target that appears as a token inside a returned phrase counts
 * as essentially correct (the engine often adds filler words).
 */
export function scorePronunciation(target: string, candidates: string[]): PronounceScore {
  const tgt = normalize(target);
  const single = !tgt.includes(" ");
  const pool = candidates.length ? candidates : [""];
  let best = 0;
  let heard = pool[0] ?? "";
  for (const c of pool) {
    const cand = normalize(c);
    let s = ratio(tgt, cand);
    if (single && cand.split(" ").includes(tgt)) s = Math.max(s, 0.97);
    // Chinese has no spaces to find the word between: said twice ("一切一切") or
    // inside a phrase, it is still the word said.
    if (HAN.test(tgt) && cand.includes(tgt)) s = Math.max(s, 0.97);
    if (s > best) {
      best = s;
      heard = c;
    }
  }
  const band: PronounceBand = best >= 0.85 ? "great" : best >= 0.6 ? "close" : "off";
  return { score: best, heard: heard.trim(), band };
}

// Share of the target's syllables heard, in order, at the best spot: the right
// syllable in the right tone scores 1, the right syllable in another tone 0.65 —
// "close", not "off": the sounds were there, the tone is what to fix.
function syllableScore(target: string[], heard: string[]): number {
  if (!target.length || !heard.length) return 0;
  let best = 0;
  for (let i = 0; i <= Math.max(0, heard.length - target.length); i++) {
    let sum = 0;
    target.forEach((syl, j) => {
      const h = heard[i + j];
      if (!h) return;
      if (h === syl) sum += 1;
      else if (h.replace(/\d/, "") === syl.replace(/\d/, "")) sum += 0.65;
    });
    best = Math.max(best, sum / target.length);
  }
  return best;
}

/**
 * The score for a spoken attempt. For Chinese it also compares the sounds: the
 * recogniser picks characters, and a homophone it wrote down (the right syllables
 * in the right tones) is the word pronounced right. It also returns the pinyin of
 * what was heard, so a wrong tone shows. pinyin-pro loads only when it's needed.
 */
export async function scoreSpoken(target: string, candidates: string[], lang: string): Promise<PronounceScore> {
  const base = scorePronunciation(target, candidates);
  if (!(lang === "zh" || lang === "zh-Hant") || !HAN.test(target)) return base;
  const { pinyin } = await import("pinyin-pro");
  const syl = (text: string) => pinyin(text, { toneType: "num", type: "array", nonZh: "removed" }).filter(Boolean);
  const want = syl(target);
  let best = base;
  for (const c of candidates) {
    const s = syllableScore(want, syl(c)) * 0.97;
    if (s > best.score) best = { score: s, heard: c.trim(), band: s >= 0.85 ? "great" : s >= 0.6 ? "close" : "off" };
  }
  return best.heard ? { ...best, heardPinyin: pinyin(best.heard, { toneType: "symbol", nonZh: "removed" }) } : best;
}

/** Warm pinyin-pro while the learner is still speaking, so the score isn't waiting on it. */
export function preloadScoring(lang: string) {
  if (lang === "zh" || lang === "zh-Hant") void import("pinyin-pro");
}

// ── Read aloud: which words came through ──────────────────────────────────────
// The recogniser writes down what it understood, and a Chinese listener mishears
// the same way: a word it wrote as another word didn't come through, and the pinyin
// of what it wrote shows how it sounded (海鸥 hǎi ōu read as 好后 hǎo hòu). A homophone
// it picked is the word said right. What this can't show is a small tone slip the
// recogniser fixed from context — the UI says so.

export type ReadStatus = "ok" | "misheard" | "missed";

export interface ReadWord {
  text: string; // as written in the sentence, punctuation and spaces included
  status?: ReadStatus; // words only; undefined for punctuation and spaces
  pinyin?: string; // the word's reading, tone marks
  heard?: string; // a misheard word: what the recogniser wrote in its place
  heardPinyin?: string;
}

export interface ReadCheck {
  words: ReadWord[];
  understood: number; // words that came through
  total: number;
}

// One syllable (a Chinese character) or one non-Chinese run ("3", "Wi-Fi").
interface Unit {
  char: string;
  num: string; // "hai3"; a non-Chinese run lowercased
  mark: string; // "hǎi"
}

const HAN_RUN = /\p{Script=Han}+/gu;
const INITIAL = /^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])/;

type PinyinFn = typeof import("pinyin-pro").pinyin;

// Every character of `text` with its syllable, read in its run's context so a
// polyphone gets its reading in the word it's in (银行 háng, 行走 xíng).
function unitsOf(text: string, py: PinyinFn): (Unit | null)[] {
  const chars = Array.from(text);
  const out: (Unit | null)[] = chars.map(() => null);
  const joined = chars.join("");
  for (const m of joined.matchAll(HAN_RUN)) {
    const run = Array.from(m[0]);
    const start = Array.from(joined.slice(0, m.index)).length;
    let num = py(m[0], { toneType: "num", type: "array" });
    let mark = py(m[0], { toneType: "symbol", type: "array" });
    if (num.length !== run.length || mark.length !== run.length) {
      num = run.map((c) => py(c, { toneType: "num" }));
      mark = run.map((c) => py(c, { toneType: "symbol" }));
    }
    run.forEach((c, i) => (out[start + i] = { char: c, num: num[i], mark: mark[i] }));
  }
  return out;
}

// What one target syllable costs when the recogniser wrote `h` in its place.
function subCost(t: Unit, h: Unit): number {
  if (t.char === h.char || t.num === h.num) return 0; // the same, or a homophone
  const tb = t.num.replace(/\d$/, "");
  const hb = h.num.replace(/\d$/, "");
  if (tb === hb) return 0.4; // right sounds, another tone
  const ti = INITIAL.exec(tb)?.[0] ?? "";
  const hi = INITIAL.exec(hb)?.[0] ?? "";
  if ((ti && ti === hi) || tb.slice(ti.length) === hb.slice(hi.length)) return 0.7;
  return 1;
}
const GAP = 0.75; // a syllable said but not written, or written but not said

/**
 * Line a read-aloud attempt up against its sentence and say, word by word, whether
 * it came through. `tokens` is the sentence as the segmenter cut it (they join back
 * into the sentence); `heard` is what the recogniser wrote.
 */
export async function compareRead(tokens: { text: string; wordLike: boolean }[], heard: string): Promise<ReadCheck> {
  const { pinyin } = await import("pinyin-pro");
  const sentence = tokens.map((t) => t.text).join("");
  const perChar = unitsOf(sentence, pinyin);

  // The sentence's syllables, each tagged with the word it belongs to. A word-like
  // token with no Chinese in it ("3", "Wi-Fi") is one unit, compared as written.
  const target: { unit: Unit; word: number }[] = [];
  let at = 0;
  tokens.forEach((tok, w) => {
    const len = Array.from(tok.text).length;
    if (tok.wordLike) {
      const units = perChar.slice(at, at + len).filter((u): u is Unit => !!u);
      if (units.length) units.forEach((unit) => target.push({ unit, word: w }));
      else if (tok.text.trim()) target.push({ unit: { char: tok.text, num: tok.text.toLowerCase(), mark: tok.text }, word: w });
    }
    at += len;
  });

  // What was heard, the same way: Chinese characters, plus runs of letters or digits.
  const heardUnits: Unit[] = [];
  const heardChars = unitsOf(heard, pinyin);
  Array.from(heard).forEach((c, i) => {
    const u = heardChars[i];
    if (u) heardUnits.push(u);
    else if (/[\p{L}\p{N}]/u.test(c)) {
      const last = heardUnits[heardUnits.length - 1];
      // Glue a letter or digit onto the run before it, if that run was one.
      if (last && !/\p{Script=Han}/u.test(last.char) && i > 0 && /[\p{L}\p{N}]/u.test(Array.from(heard)[i - 1])) {
        last.char += c;
        last.num = last.char.toLowerCase();
        last.mark = last.char;
      } else heardUnits.push({ char: c, num: c.toLowerCase(), mark: c });
    }
  });

  // Weighted edit distance, then walk it back: each target syllable is matched to
  // the heard syllable written in its place, or was never heard.
  const n = target.length;
  const m = heardUnits.length;
  const d: number[][] = Array.from({ length: n + 1 }, (_, i) => Array.from({ length: m + 1 }, (_, j) => (i === 0 ? j * GAP : j === 0 ? i * GAP : 0)));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      d[i][j] = Math.min(d[i - 1][j - 1] + subCost(target[i - 1].unit, heardUnits[j - 1]), d[i - 1][j] + GAP, d[i][j - 1] + GAP);
  const matched: (number | null)[] = new Array(n).fill(null); // target syllable → heard index
  const insertedBefore: number[][] = Array.from({ length: n + 1 }, () => []); // heard extras before target i
  for (let i = n, j = m; i > 0 || j > 0; ) {
    if (i > 0 && j > 0 && d[i][j] === d[i - 1][j - 1] + subCost(target[i - 1].unit, heardUnits[j - 1])) {
      matched[i - 1] = j - 1;
      i--;
      j--;
    } else if (i > 0 && d[i][j] === d[i - 1][j] + GAP) i--;
    else {
      insertedBefore[i].unshift(j - 1);
      j--;
    }
  }

  // Per word: all its syllables written as said → came through; none heard → missed;
  // otherwise misheard, with what was written over its span.
  const words: ReadWord[] = tokens.map((t) => ({ text: t.text }));
  let understood = 0;
  let total = 0;
  for (let w = 0; w < tokens.length; w++) {
    const idx = target.flatMap((s, i) => (s.word === w ? [i] : []));
    if (!idx.length) continue;
    total++;
    const word = words[w];
    word.pinyin = idx.map((i) => target[i].unit.mark).join(" ");
    const got = idx.map((i) => matched[i]);
    if (got.every((g) => g === null)) {
      word.status = "missed";
      continue;
    }
    if (idx.every((i) => matched[i] !== null && subCost(target[i].unit, heardUnits[matched[i]!]) === 0)) {
      word.status = "ok";
      understood++;
      continue;
    }
    // The heard span: from the first matched syllable to the last, plus anything
    // the recogniser wrote between this word's syllables.
    const span: number[] = [];
    idx.forEach((i, k) => {
      if (k > 0) span.push(...insertedBefore[i]);
      if (matched[i] !== null) span.push(matched[i]!);
    });
    const units = span.map((j) => heardUnits[j]);
    word.status = "misheard";
    word.heard = units.map((u) => u.char).join("");
    word.heardPinyin = units.map((u) => u.mark).join(" ");
  }
  return { words, understood, total };
}
