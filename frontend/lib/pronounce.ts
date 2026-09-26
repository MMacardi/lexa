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
