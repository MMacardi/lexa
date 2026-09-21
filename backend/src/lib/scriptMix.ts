// Repair words the model spelled with a stray letter from the other alphabet.
//
// Writing Russian around English terms, Qwen now and then emits a Cyrillic "о" or
// "с" inside an English word («оpportunity cost») or a Latin "o" inside a Russian
// one. The two look identical, so the learner can't see it, yet the word breaks:
// search, TTS, dictionary look-up and copy-paste all treat it as a different word.
//
// A word is a run of Latin/Cyrillic letters. When a run mixes the two, and the
// minority alphabet has at most two letters that all have a lookalike in the
// majority one, those letters are swapped. Real mixed words ("SMSка") are left alone by the
// ratio check; hyphenated ones ("IT-шник") are two runs and never touched.
// One code unit in, one code unit out, so string lengths never change.

const CYR_TO_LAT: Record<string, string> = {
  а: "a", е: "e", к: "k", о: "o", р: "p", с: "c", у: "y", х: "x",
  і: "i", ј: "j", ѕ: "s", һ: "h", ԁ: "d", ԛ: "q", ԝ: "w",
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X",
  І: "I", Ј: "J", Ѕ: "S",
};

const LAT_TO_CYR: Record<string, string> = {
  a: "а", c: "с", e: "е", o: "о", p: "р", x: "х", y: "у",
  A: "А", B: "В", C: "С", E: "Е", H: "Н", K: "К", M: "М", O: "О", P: "Р", T: "Т", X: "Х",
};

const LATIN = /\p{Script=Latin}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
// Only the two alphabets that share lookalikes; CJK runs aren't words here.
const WORD = /[\p{Script=Latin}\p{Script=Cyrillic}\p{M}]+/gu;
// A word still arriving at the end of a streamed chunk (see jsonFieldStream).
export const TRAILING_WORD = /[\p{Script=Latin}\p{Script=Cyrillic}\p{M}]+$/u;

function fixWord(w: string): string {
  let lat = 0;
  let cyr = 0;
  for (const ch of w) {
    if (LATIN.test(ch)) lat++;
    else if (CYRILLIC.test(ch)) cyr++;
  }
  if (!lat || !cyr || lat === cyr) return w;
  const toLatin = lat > cyr;
  const minority = Math.min(lat, cyr);
  if (minority > 2 || minority * 3 > lat + cyr) return w;
  const map = toLatin ? CYR_TO_LAT : LAT_TO_CYR;
  const from = toLatin ? CYRILLIC : LATIN;
  let out = "";
  for (const ch of w) {
    if (!from.test(ch)) {
      out += ch;
      continue;
    }
    const swap = map[ch];
    if (!swap) return w; // a letter with no twin: the mix is deliberate
    out += swap;
  }
  return out;
}

export function fixMixedScript(text: string): string {
  if (!LATIN.test(text) || !CYRILLIC.test(text)) return text;
  return text.replace(WORD, fixWord);
}

// Every string inside a parsed JSON reply, keys untouched.
export function fixMixedScriptDeep<T>(value: T): T {
  if (typeof value === "string") return fixMixedScript(value) as T;
  if (Array.isArray(value)) return value.map(fixMixedScriptDeep) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = fixMixedScriptDeep(v);
    return out as T;
  }
  return value;
}
