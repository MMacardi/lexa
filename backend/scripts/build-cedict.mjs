// Regenerates data/cedict.jsonl from the upstream CC-CEDICT dump.
//
// Source: CC-CEDICT (https://www.mdbg.net/chinese/dictionary?page=cc-cedict),
// licensed CC BY-SA 4.0. That licence is why the derived data lives in its own
// file with its own header, is never mixed into our generated text, and is
// credited in the app (see the "dictionary credit" line on the word page).
//
// Only the HSK headwords are kept: that is the vocabulary this app is for, and
// the full 125k dump is ~4 MB of glosses we would never read. Words outside the
// subset fall back to the ungrounded path; services/cedict.ts counts those misses
// so we can see whether the subset wants widening.
//
// Run: node scripts/build-cedict.mjs [dump.txt.gz] [--measure-words]   (needs
// network without the file; re-run when CC-CEDICT publishes a release worth
// picking up, or when the HSK lists change — then rerun check-word-pages.ts, whose
// pages point at glosses by position)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { gunzipSync } from "node:zlib";

const SRC = "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "cedict.jsonl");

// hskWords.ts is TypeScript, so it is read as text rather than imported: plain
// node runs this script, and the file is one template literal anyway.
const HSK_WORDS =
  readFileSync(join(ROOT, "src", "data", "hskWords.ts"), "utf8").match(/HSK_WORDS = `([^`]*)`/)?.[1] ?? "";
if (!HSK_WORDS) throw new Error("could not read HSK_WORDS out of src/data/hskWords.ts");

// A downloaded dump can be passed instead (`node scripts/build-cedict.mjs dump.txt.gz`),
// so a rebuild can be rerun on the same release.
const local = process.argv.slice(2).find((a) => !a.startsWith("--"));
// --measure-words: refresh only the readings' `cl` in the files as they are. The
// word pages (data/hsk-pages.jsonl) point at glosses by position, so a release that
// rewords 必须 or 讨厌 breaks them; this takes a release's measure words without that.
const MEASURE_WORDS_ONLY = process.argv.includes("--measure-words");
let gz;
if (local) gz = readFileSync(local);
else {
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  gz = Buffer.from(await res.arrayBuffer());
}
const text = gunzipSync(gz).toString("utf8");

// The dump's own header carries the release stamp; storing it beside the data is
// what stops "which version is this?" becoming archaeology two releases later.
const release = text.match(/^#! date=(\S+)/m)?.[1] ?? "";

// The headwords we keep: every word on either HSK list, in simplified form.
const wanted = new Set(HSK_WORDS.split("\n").map((l) => l.split("\t")[0]).filter(Boolean));
// The lists spell 一下儿 and 一点儿; learners (and textbooks) type 一下 and 一点, and
// CC-CEDICT's entry for the erhua form says only "erhua form of 一下". Keep the
// base form too, or instant capture has nothing to show for the commonest words.
for (const w of [...wanted]) if (w.length > 1 && w.endsWith("儿")) wanted.add(w.slice(0, -1));

/**
 * The measure words one reading's glosses list — `CL:臺|台[tai2]` as its own gloss
 * (电脑) or inside one (河 "river (CL:條|条[tiao2],道[dao4])") — as [{ w, p }],
 * simplified form and numbered pinyin, in the dictionary's order. A learner needs
 * them per noun (一台电脑, 一条河) and Russian has nothing like them.
 */
function measureWords(glosses) {
  const out = [];
  for (const g of glosses) {
    for (const [, list] of g.matchAll(/CL:([^/()]*)/g)) {
      for (const [, w, p] of list.matchAll(/(?:[^\s,|[\]]+\|)?([^\s,|[\]]+)\[([^\]]+)\]/g)) {
        if (!out.some((m) => m.w === w)) out.push({ w, p });
      }
    }
  }
  return out;
}

/**
 * One CC-CEDICT gloss, tidied just enough to go into a prompt.
 * - `漢字|汉字[pin1 yin1]` cross-references are cut down to the simplified form,
 *   because the bracket notation reads as noise to a model and to a learner.
 * - `CL:個|个[ge4]` is classifier data, not a sense (`measureWords` keeps it).
 * - The leading "to " of a verb gloss stays: it is how the dictionary marks one.
 */
function cleanGloss(g, simplified) {
  if (/^CL:/.test(g)) return "";
  const out = g
    .replace(/([一-鿿]+)\|([一-鿿]+)\[[^\]]*\]/g, "$2") // 漢字|汉字[pinyin] -> 汉字
    .replace(/([一-鿿]+)\[[^\]]*\]/g, "$1") // 汉字[pinyin] -> 汉字
    .replace(/\s+/g, " ")
    .trim();
  // Several traditional headwords can share one simplified form (祇/衹/隻 are all
  // 只), which turns their cross-references into "variant of 只" — a sense that
  // points at itself and says nothing.
  if (new RegExp(`^(old |erroneous )?(variant of|see|same as) ${simplified}$`).test(out)) return "";
  return out;
}

// simplified -> [{ p: pinyin, g: [gloss] }], one entry per reading. A headword
// with two readings (只 zhī / zhǐ) keeps both: which one the card means is the
// model's job to pick, and hiding a reading would hide a real sense.
const byWord = new Map();
const trad = new Map();
let kept = 0;
// Everything else, for data/cedict-extra.jsonl: the words a learner meets reading
// in their own field (算法, 延迟, 参数). Kept apart so the subset's behaviour — the
// Reader's joins, the add form's reverse lookup — doesn't change; services/cedict.ts
// loads it only when a word misses the subset.
const EXTRA_OUT = join(ROOT, "data", "cedict-extra.jsonl");
const extraByWord = new Map();
const extraTrad = new Map();
let extraKept = 0;
const HAN_ONLY = /^\p{Script=Han}+$/u;
const MAX_EXTRA_GLOSSES = 6;

for (const line of text.split("\n")) {
  if (!line || line[0] === "#") continue;
  // `traditional simplified [pinyin] /gloss/gloss/`
  const m = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]*)\]\s+\/(.*)\/\s*$/);
  if (!m) continue;
  const [, traditional, simplified, pinyin, body] = m;
  if (!wanted.has(simplified)) {
    // Han-only headwords (no 卡拉OK, no A型); a few glosses each is all a card or
    // a tap shows, and it keeps the file a third smaller.
    if (!HAN_ONLY.test(simplified)) continue;
    const glosses = body.split("/").map((g) => cleanGloss(g, simplified)).filter(Boolean).slice(0, MAX_EXTRA_GLOSSES);
    if (!glosses.length) continue;
    const readings = extraByWord.get(simplified) ?? [];
    readings.push({ p: pinyin.trim(), g: glosses, cl: measureWords(body.split("/")) });
    extraByWord.set(simplified, readings);
    if (traditional !== simplified) {
      const seen = extraTrad.get(simplified);
      extraTrad.set(simplified, seen === undefined || seen === traditional ? traditional : null);
    }
    extraKept++;
    continue;
  }
  const glosses = body.split("/").map((g) => cleanGloss(g, simplified)).filter(Boolean);
  if (!glosses.length) continue;
  const readings = byWord.get(simplified) ?? [];
  readings.push({ p: pinyin.trim(), g: glosses, cl: measureWords(body.split("/")) });
  byWord.set(simplified, readings);
  // Traditional forms cost nothing here and make a traditional-text card (or OCR
  // of traditional print) findable later. Recorded only when every entry for the
  // headword agrees: 只 is 祇, 衹 AND 隻 depending on the sense, and picking one
  // of those would be inventing a fact the dictionary doesn't state.
  if (traditional !== simplified) {
    const seen = trad.get(simplified);
    trad.set(simplified, seen === undefined || seen === traditional ? traditional : null);
  }
  kept++;
}

const meta = {
  _meta: {
    source: "CC-CEDICT",
    url: "https://www.mdbg.net/chinese/dictionary?page=cc-cedict",
    license: "CC BY-SA 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    release,
    subset: "HSK 2.0 + 3.0 headwords",
    words: byWord.size,
    entries: kept,
    generatedBy: "scripts/build-cedict.mjs",
  },
};

mkdirSync(dirname(OUT), { recursive: true });

// One reading per pinyin: the dump splits entries by traditional form, so a
// simplified-only app sees the same reading two or three times over.
function merged(readings) {
  const out = new Map();
  for (const { p, g, cl } of readings) {
    const into = out.get(p);
    if (into) {
      for (const gloss of g) into.g.includes(gloss) || into.g.push(gloss);
      for (const m of cl) into.cl.some((x) => x.w === m.w) || into.cl.push(m);
    } else out.set(p, { g: [...new Set(g)], cl: [...cl] });
  }
  return out;
}

function rows(words, tradMap) {
  const out = [];
  for (const word of [...words.keys()].sort()) {
    // `cl` only where the reading has measure words, so most rows stay as they were.
    const row = { s: word, r: [...merged(words.get(word))].map(([p, { g, cl }]) => ({ p, g, ...(cl.length ? { cl } : {}) })) };
    const t = tradMap.get(word);
    if (t) row.t = t;
    out.push(JSON.stringify(row));
  }
  return out;
}

// --measure-words: the file as it is, each reading's `cl` taken from this release.
function withMeasureWords(file, words) {
  let n = 0;
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean).map((line) => {
    const row = JSON.parse(line);
    if (row._meta) return JSON.stringify({ _meta: { ...row._meta, measureWords: release } });
    const now = words.has(row.s) ? merged(words.get(row.s)) : new Map();
    row.r = row.r.map(({ cl: _, ...r }) => {
      const cl = now.get(r.p)?.cl ?? [];
      if (cl.length) n++;
      return cl.length ? { ...r, cl } : r;
    });
    return JSON.stringify(row);
  });
  writeFileSync(file, lines.join("\n") + "\n", "utf8");
  return n;
}

if (MEASURE_WORDS_ONLY) {
  const n = withMeasureWords(OUT, byWord);
  const m = withMeasureWords(EXTRA_OUT, extraByWord);
  console.log(`measure words from ${release}: ${n} readings in ${OUT}, ${m} in ${EXTRA_OUT}; glosses untouched`);
  process.exit(0);
}

writeFileSync(OUT, [JSON.stringify(meta), ...rows(byWord, trad)].join("\n") + "\n", "utf8");

const extraMeta = {
  _meta: { ...meta._meta, subset: "every other Han-only headword", words: extraByWord.size, entries: extraKept },
};
writeFileSync(EXTRA_OUT, [JSON.stringify(extraMeta), ...rows(extraByWord, extraTrad)].join("\n") + "\n", "utf8");
console.log(`wrote ${EXTRA_OUT}: ${extraByWord.size} headwords / ${extraKept} readings`);

const missing = [...wanted].filter((w) => !byWord.has(w)).length;
console.log(
  `wrote ${OUT}: ${byWord.size} headwords / ${kept} readings, release ${release}; ` +
    `${missing} of ${wanted.size} HSK words are not in CC-CEDICT`,
);
