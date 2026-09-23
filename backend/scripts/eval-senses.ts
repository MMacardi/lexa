/**
 * Does grounding the senses in CC-CEDICT actually fix the Chinese→Russian cards?
 *
 * The bugs that motivated F6 were all on the zh→ru path: «включить» produced 打开
 * glossed only as "открыть", though the dictionary lists "to turn on". So this
 * generates the SAME words twice — once through the old model-only prompt, once
 * grounded — and writes both into one CSV for a human to mark. Numbers from the
 * grounded path alone would have nothing to compare against.
 *
 * Judging is deliberately small, because a big eval is one that never gets done:
 * zh→ru only (zh→en matters less — CC-CEDICT grounds it directly), and one binary
 * question per cell, "is the sense right, yes or no". Register and clumsy phrasing
 * go in `notes`, not in the score.
 *
 * A caveat to hold while marking: the `reference` column is CC-CEDICT itself, so
 * it is the grounded arm's own source. Read it as what the dictionary states, not
 * as the answer key, and fall back on BKRS or Pleco where a word is contested.
 *
 * Run (needs backend/.env for the model key, and costs ~2 calls per word):
 *   cd backend && npx tsx scripts/eval-senses.ts [--words 100] [--out eval-senses.csv]
 * Then open the CSV, fill `ungrounded_ok` / `grounded_ok` with 1 or 0, and run
 *   npx tsx scripts/eval-senses.ts --score eval-senses.csv
 */

import { writeFileSync, readFileSync } from "node:fs";
import { enrichWordEntry } from "../src/agents/enrich.js";
import { cedictLookup } from "../src/services/cedict.js";
import { hskLevelWords } from "../src/services/hsk.js";

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

const OUT = arg("out") ?? "eval-senses.csv";
const WORDS = Number(arg("words") ?? 100);
const CONCURRENCY = 4;

const COLUMNS = [
  "word",
  "pinyin",
  "hsk",
  "senses", // how many the dictionary lists — the polysemy this eval is weighted toward
  "reference", // CC-CEDICT's own glosses
  "ungrounded",
  "grounded",
  "ungrounded_ok", // fill in: 1 = right sense, 0 = wrong
  "grounded_ok",
  "notes", // register, clumsy Russian, anything that isn't the sense
] as const;

// --- scoring an already-marked CSV ---------------------------------------

function score(path: string) {
  const rows = parseCsv(readFileSync(path, "utf8"));
  const head = rows.shift();
  if (!head) throw new Error("empty CSV");
  const col = (name: string) => head.indexOf(name);
  const marked = (i: number) => rows.filter((r) => r[i] === "0" || r[i] === "1");
  for (const arm of ["ungrounded", "grounded"]) {
    const i = col(`${arm}_ok`);
    const judged = marked(i);
    const right = judged.filter((r) => r[i] === "1").length;
    const pct = judged.length ? ((100 * right) / judged.length).toFixed(0) : "—";
    console.log(`${arm.padEnd(11)} ${right}/${judged.length} right sense (${pct}%)`);
  }
  // The pairs that moved are the whole point: they say what grounding bought.
  const [u, g] = [col("ungrounded_ok"), col("grounded_ok")];
  const both = rows.filter((r) => (r[u] === "0" || r[u] === "1") && (r[g] === "0" || r[g] === "1"));
  const fixed = both.filter((r) => r[u] === "0" && r[g] === "1");
  const broke = both.filter((r) => r[u] === "1" && r[g] === "0");
  console.log(`\ngrounding fixed ${fixed.length}, broke ${broke.length}, of ${both.length} judged both ways`);
  if (fixed.length) console.log(`  fixed: ${fixed.map((r) => r[0]).join(" ")}`);
  if (broke.length) console.log(`  broke: ${broke.map((r) => r[0]).join(" ")}`);
}

// --- the sample -----------------------------------------------------------

/**
 * 100 HSK 4–5 words weighted toward the polysemous ones, because a word with one
 * sense cannot be glossed with the wrong one and tells this eval nothing. Two
 * thirds come from words the dictionary gives 3+ senses, a third from the rest so
 * the ordinary case is still represented. Fixed order, no randomness: re-running
 * after a prompt change has to compare against the same words.
 */
function sample(n: number) {
  const pool = [...hskLevelWords("3.0", 4), ...hskLevelWords("3.0", 5)].map((e) => {
    const entry = cedictLookup(e.word);
    return {
      word: e.word,
      pinyin: e.pinyin,
      hsk: "3.0 L" + (e.levels["3.0"] ?? ""),
      glosses: entry ? entry.readings.flatMap((r) => r.glosses) : [],
    };
  });
  const covered = pool.filter((w) => w.glosses.length > 0);
  const many = covered.filter((w) => w.glosses.length >= 3);
  const few = covered.filter((w) => w.glosses.length < 3);
  // Spread the pick across each list rather than taking a prefix: the HSK list is
  // sorted by character, so a prefix would be all words starting with 一.
  const spread = <T,>(list: T[], take: number) =>
    take >= list.length ? list : Array.from({ length: take }, (_, i) => list[Math.floor((i * list.length) / take)]);
  const wantMany = Math.min(Math.round(n * 0.67), many.length);
  return [...spread(many, wantMany), ...spread(few, n - wantMany)];
}

// --- generating -----------------------------------------------------------

async function run() {
  const words = sample(WORDS);
  console.log(`${words.length} words, 2 calls each = ${words.length * 2} model calls`);
  // --dry shows which words would be spent on, before spending anything.
  if (process.argv.includes("--dry")) {
    for (const w of words) console.log(`  ${w.word}\t${w.glosses.length}\t${w.glosses.slice(0, 4).join("; ")}`);
    return;
  }

  const rows: string[][] = [];
  let done = 0;
  const queue = [...words];
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let w = queue.shift(); w; w = queue.shift()) {
        // Same call the "add a word" path makes, minus the example: the meaning is
        // what is being judged, and an example doubles the tokens for nothing.
        const one = (ground: boolean) =>
          enrichWordEntry({ word: w.word, sourceLang: "zh", targetLang: "ru", withExample: false, ground })
            .then((r) => r.meaningZh)
            .catch((e) => `ERROR: ${(e as Error).message}`);
        const [ungrounded, grounded] = await Promise.all([one(false), one(true)]);
        rows.push([w.word, w.pinyin, w.hsk, String(w.glosses.length), w.glosses.join("; "), ungrounded, grounded, "", "", ""]);
        if (++done % 10 === 0) console.log(`  ${done}/${words.length}`);
      }
    }),
  );

  rows.sort((a, b) => Number(b[3]) - Number(a[3])); // most senses first: the hard cases lead
  writeFileSync(OUT, toCsv([[...COLUMNS], ...rows]), "utf8");
  console.log(`\nwrote ${OUT} — fill ungrounded_ok / grounded_ok with 1 or 0, then --score it`);
}

// --- CSV ------------------------------------------------------------------

// Excel and LibreOffice both need the BOM to read the Russian and Chinese here.
const toCsv = (rows: string[][]) =>
  "﻿" + rows.map((r) => r.map((c) => `"${(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";

/** Enough CSV to read back a file this script wrote and a human then edited. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') (cell += '"'), i++;
      else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") (row.push(cell), (cell = ""));
    else if (ch === "\n") (row.push(cell), rows.push(row), (row = []), (cell = ""));
    else if (ch !== "\r" && ch !== "﻿") cell += ch;
  }
  if (cell || row.length) (row.push(cell), rows.push(row));
  return rows.filter((r) => r.some(Boolean)).map((r) => r.map((c) => c.trim()));
}

const scorePath = arg("score");
await (scorePath ? Promise.resolve(score(scorePath)) : run());
