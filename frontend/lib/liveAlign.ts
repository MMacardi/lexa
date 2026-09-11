import { segment, wordKey, type Token } from "@/lib/segment";

// Map a heard ASR transcript onto the text's tokens so the Reader can highlight how
// far the learner has read.
//
// Forgiving and monotonic: the cursor only moves forward; each heard word matches the
// next token (within a small lookahead window) whose normalized form is equal or close
// (one edit / shared prefix); heard words that match nothing are skipped rather than
// stalling the cursor. ASR rarely returns the source text verbatim (punctuation, small
// mishearings, different inflection), so "close enough, keep moving" beats "exact".

const LOOKAHEAD = 8; // tokens to scan forward for a match

// Bounded Levenshtein: stops early once the distance exceeds `cap` (we only care
// whether it's <= 1, so this stays cheap on long words).
function editDistance(a: string, b: string, cap: number): number {
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > cap) return cap + 1;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > cap) return cap + 1;
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

function isClose(heard: string, token: string): boolean {
  if (heard === token) return true;
  if (!heard || !token) return false;
  // Single characters (CJK words) must match exactly — an edit distance of 1 on a
  // 1-char token would match everything.
  if (heard.length < 2 || token.length < 2) return false;
  if (heard[0] === token[0] && editDistance(heard, token, 1) <= 1) return true;
  return editDistance(heard, token, 1) <= 1;
}

/**
 * Advance the read-aloud cursor over `tokens` given the newest transcript piece.
 * `cursor` is a token index: tokens with index < cursor count as already read.
 * Returns the new cursor (never less than the one passed in).
 */
export function advanceCursor(tokens: Token[], cursor: number, heardText: string, lang: string): number {
  const heard = segment(heardText, lang)
    .filter((tk) => tk.wordLike)
    .map((tk) => wordKey(tk.text))
    .filter(Boolean);
  if (!heard.length) return cursor;

  let i = cursor;
  for (const h of heard) {
    if (i >= tokens.length) break;
    const limit = Math.min(tokens.length, i + LOOKAHEAD);
    for (let j = i; j < limit; j++) {
      const tk = tokens[j];
      if (!tk.wordLike) continue;
      if (isClose(h, wordKey(tk.text))) {
        i = j + 1; // read through this token
        break;
      }
    }
    // No match in the window → skip this heard word, leave the cursor where it is.
  }
  return i;
}
