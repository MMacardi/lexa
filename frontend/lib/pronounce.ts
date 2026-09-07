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
}

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
    if (s > best) {
      best = s;
      heard = c;
    }
  }
  const band: PronounceBand = best >= 0.85 ? "great" : best >= 0.6 ? "close" : "off";
  return { score: best, heard: heard.trim(), band };
}
