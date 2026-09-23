import { cedictHas } from "./cedict.js";

/**
 * Chinese word boundaries for the Reader: ICU's segmentation, repaired with
 * CC-CEDICT.
 *
 * The Reader used the browser's Intl.Segmenter alone, and ICU glues characters
 * the dictionary never lists as a word — 他打了三个小时篮球 comes out with a
 * tappable "了三", 我想 and 她在 as single words — so the learner can't tap 了
 * on its own. ICU is still the better base than our dictionary alone: the
 * CEDICT subset is the HSK headwords, so a greedy match against it would chop
 * every name and non-HSK compound into characters. So ICU splits first, and the
 * dictionary only corrects it where it is sure:
 *   1. a multi-character token the dictionary doesn't list is split, but only if
 *      every piece is a dictionary word (了三 → 了 三; 乌兰 stays whole);
 *   2. neighbouring tokens that together make a dictionary word are joined
 *      (了 解 → 了解), up to four characters.
 * Greedy, so the odd boundary stays wrong (说明 天 for 说 明天), and a name made
 * of common characters comes apart (蒙古 → 蒙 古) — a tap on a wrong split costs
 * the learner one extra tap, never a wrong card.
 */

export type Token = { text: string; wordLike: boolean };

const HAN = /^\p{Script=Han}+$/u;
const MAX_WORD = 4;

const isHan = (t: Token) => t.wordLike && HAN.test(t.text);

/** The token as dictionary words, longest first, or null if some piece isn't one. */
function cover(word: string): string[] | null {
  const chars = Array.from(word);
  const out: string[] = [];
  let i = 0;
  while (i < chars.length) {
    let n = Math.min(MAX_WORD, chars.length - i);
    while (n >= 1 && !cedictHas(chars.slice(i, i + n).join(""))) n--;
    if (n === 0) return null;
    out.push(chars.slice(i, i + n).join(""));
    i += n;
  }
  return out;
}

export function segmentChinese(text: string): Token[] {
  const seg = new Intl.Segmenter("zh", { granularity: "word" });
  const raw: Token[] = Array.from(seg.segment(text), (s) => ({ text: s.segment, wordLike: Boolean(s.isWordLike) }));

  // 1. Split what the dictionary doesn't know into what it does.
  const split: Token[] = [];
  for (const t of raw) {
    const pieces = isHan(t) && Array.from(t.text).length > 1 && !cedictHas(t.text) ? cover(t.text) : null;
    if (pieces) for (const p of pieces) split.push({ text: p, wordLike: true });
    else split.push(t);
  }

  // 2. Join neighbours that make a dictionary word, the longest run that does.
  const out: Token[] = [];
  let i = 0;
  while (i < split.length) {
    let end = i;
    if (isHan(split[i])) {
      let joined = split[i].text;
      for (let j = i + 1; j < split.length && isHan(split[j]); j++) {
        joined += split[j].text;
        if (Array.from(joined).length > MAX_WORD) break;
        if (cedictHas(joined)) end = j;
      }
    }
    out.push(end > i ? { text: split.slice(i, end + 1).map((t) => t.text).join(""), wordLike: true } : split[i]);
    i = end + 1;
  }
  return out;
}
