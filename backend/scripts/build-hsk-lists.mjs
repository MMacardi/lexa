// Regenerates src/data/hskWords.ts from the upstream HSK vocabulary dump.
//
// Source: https://github.com/drkameleon/complete-hsk-vocabulary (MIT), which
// merges the official HSK 2.0 list (clem109/hsk-vocabulary) and the HSK 3.0 one
// (elkmovie/hsk30). We take ONLY the word, its pinyin and its level tags: the
// upstream `meanings` come from CC-CEDICT (CC BY-SA) and dragging that licence
// into the whole app for glosses we don't use would be careless. Senses are
// F6's job and will carry their own attribution.
//
// Run: node scripts/build-hsk-lists.mjs   (needs network; re-run only when the
// official lists change, which is roughly never), then
// npx tsx scripts/check-hsk-readings.ts for the readings.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pinyin } from "pinyin-pro";
import { READINGS } from "./hsk-readings.mjs";

const SRC = "https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.min.json";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "data", "hskWords.ts");

const res = await fetch(SRC);
if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
const entries = await res.json();

// --- Which reading ---
//
// Upstream gives a word every CC-CEDICT reading it has, in the dictionary's
// alphabetical order, so taking the first showed 听 as yǐn ("smile (archaic)"),
// 说 as shuì and 都 as the surname Dū. Picked the way services/cedict.ts
// `mainReading` picks a card's: the reading pinyin-pro gives the word, then one it
// gives but for a neutral tone, then the first that is a word and not a surname,
// variant or cross-reference. READINGS (hand-checked) overrides all of it.

const NOT_A_MEANING = /^(CL:|surname\b|(old |archaic |erhua )?variant of|erhua form of|see (also )?\S|used in|also written|(Taiwan |also )?pr\. )/i;
const LEARNER_READING = { 了: "le5", 只: "zhi3" };
// Numbered pinyin as syllables; pinyin-pro's neutral 0 is CC-CEDICT's 5, and it
// reads the r of 一会儿 as a syllable "er".
const syllables = (word, p) =>
  p.toLowerCase().replace(/u:|ü/g, "v").replace(/0/g, "5").split(" ")
    .map((s, i, all) => (i === all.length - 1 && word.endsWith("儿") && /^er[25]$/.test(s) ? "r5" : s));
const sameReading = (word, a, b) => syllables(word, a).join(" ") === syllables(word, b).join(" ");
const nearReading = (word, dict, expected) => {
  const d = syllables(word, dict);
  const e = syllables(word, expected);
  return d.length === e.length && d.every((s, i) => s === e[i] || (s.endsWith("5") && s.slice(0, -1) === e[i].slice(0, -1)));
};

function pickReading(word, forms) {
  const expected = LEARNER_READING[word] ?? pinyin(word, { toneType: "num", type: "string", toneSandhi: false });
  const meant = (f) => (f.m ?? []).some((g) => !NOT_A_MEANING.test(g));
  // Capitalised readings are proper nouns ("Huan2" is the surname reading of 还).
  const common = forms.filter((f) => f.i?.n && f.i.n[0] === f.i.n[0].toLowerCase() && meant(f));
  const hit =
    common.find((f) => sameReading(word, f.i.n, expected)) ??
    common.find((f) => nearReading(word, f.i.n, expected)) ??
    common[0] ??
    forms[0];
  return String(hit?.i?.y ?? "").trim();
}

// --- How it's written ---
//
// A few upstream readings are raw CC-CEDICT ("cè lu:è", "guī ˙nu:"), carry a stray
// tone number ("yǒukòngr5") or run the syllables together ("diàndòngchē"). The list
// writes one space per syllable and erhua as its own "r" (一下儿 yī xià r).

const TONE_MARKS = /[\u0300\u0301\u0304\u030C]/g;
const toneless = (ch) => ch.normalize("NFD").replace(TONE_MARKS, "").normalize("NFC").toLowerCase();

function tidyReading(word, reading) {
  let r = reading.replace(/u:/g, "ü").replace(/˙/g, "").replace(/(\p{L})[1-5]\b/gu, "$1").replace(/\s+/g, " ").trim();
  const syls = pinyin(word, { toneType: "none", type: "array" }).map((s) => s.toLowerCase());
  const erhua = word.length > 1 && word.endsWith("儿");
  // Run-together syllables: split the letters along pinyin-pro's syllables. Given
  // up (left as it is) where the letters don't follow them, i.e. a reading
  // pinyin-pro doesn't share.
  if (r.split(" ").length !== syls.length) {
    const chars = [...r.replace(/[\s']/g, "")];
    const plain = chars.map(toneless);
    const out = [];
    let at = 0;
    for (let i = 0; i < syls.length; i++) {
      const s = erhua && i === syls.length - 1 && plain.slice(at).join("") === "r" ? "r" : syls[i];
      if (plain.slice(at, at + s.length).join("") !== s) break;
      out.push(chars.slice(at, at + s.length).join(""));
      at += s.length;
    }
    if (out.length === syls.length && at === chars.length) r = out.join(" ");
  }
  // 纽扣儿 "niǔ kòu er": an unstressed er is the erhua r (女儿 nǚ ér is a syllable).
  if (erhua) r = r.replace(/ er$/, " r");
  return r;
}

// Upstream tags each word "o1".."o6" (HSK 2.0) and "n1".."n7" (HSK 3.0, where 7
// is the combined 7–9 band). It also carries an undocumented "t*" set — a later
// revision of the 3.0 list — which we ignore: the backlog asks for the two lists
// people actually sit exams against.
const rows = [];
const counts = {};
for (const e of entries) {
  // Upstream repeats a tag when one headword has two readings (只 zhī / zhǐ is
  // twice in HSK 2.0 level 3). As vocabulary coverage a headword is one word, so
  // the tags are deduped here and the level counts below are headword counts —
  // slightly under the official 5000/11092, which count readings.
  const levels = [...new Set((e.l ?? []).filter((l) => /^[on][1-7]$/.test(l)))];
  if (!levels.length) continue;
  const word = String(e.s ?? "").trim();
  if (!word) continue;
  const reading = READINGS[word] ?? tidyReading(word, pickReading(word, e.f ?? []));
  rows.push(`${word}\t${reading}\t${levels.sort().join(",")}`);
  for (const l of levels) counts[l] = (counts[l] ?? 0) + 1;
}
rows.sort();

const summary = Object.keys(counts)
  .sort()
  .map((k) => `${k}=${counts[k]}`)
  .join(" ");

const file = `// GENERATED by scripts/build-hsk-lists.mjs — do not edit by hand.
//
// The official HSK word lists as data: one line per word, tab-separated as
// \`simplified<TAB>pinyin<TAB>levels\`, where a level is "o1".."o6" (HSK 2.0) or
// "n1".."n7" (HSK 3.0, 7 = the 7–9 band). A word usually sits at a different
// level in the two lists, which is exactly why both tags are kept.
//
// Source: github.com/drkameleon/complete-hsk-vocabulary (MIT) — word, pinyin and
// level only; its CC BY-SA definitions are deliberately left behind (see F6).
// The reading is the one a learner means, not upstream's first: see the build
// script, scripts/hsk-readings.mjs and scripts/check-hsk-readings.ts.
// Levels: ${summary}
//
// Parsed once, lazily, by services/hsk.ts. Shipped as TypeScript rather than
// JSON so \`tsc\` alone puts it in dist/ — the build copies nothing else.

export const HSK_WORDS = \`${rows.join("\n")}\`;
`;

writeFileSync(OUT, file);
console.log(`wrote ${OUT}: ${rows.length} words, ${summary}`);
