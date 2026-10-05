// The pinyin cards used to be made with, for `refreshCardReadings` (services/capture.ts):
// cards keep the pinyin they were written with, so when the dictionary comes to read a
// word otherwise (2026-10-04: HSK cards read as the list does — 东西 dōng xī → dōng xi),
// the old pinyin goes into data/card-pinyin-old.jsonl and a card still carrying it moves.
//
// Around any change to how cards are read (cedict.ts `cedictCard`, scripts/hsk-readings.mjs):
//   cd backend && npx tsx scripts/card-pinyin-moves.ts --dump ../before.tsv     before the change
//   cd backend && npx tsx scripts/card-pinyin-moves.ts --since ../before.tsv    after it: prints the moves
//   cd backend && npx tsx scripts/card-pinyin-moves.ts --since ../before.tsv --write   and records them
// No database, no model.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { cedictCard } = await import("../src/services/cedict.js");
const { HSK_WORDS } = await import("../src/data/hskWords.js");

const argOf = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const DUMP = argOf("--dump");
const SINCE = argOf("--since");
const WRITE = process.argv.includes("--write");
const OUT = fileURLToPath(new URL("../data/card-pinyin-old.jsonl", import.meta.url));

// word → [phonetic, gloss] for every list word the dictionary makes a card of.
async function cards(): Promise<Map<string, [string, string]>> {
  const out = new Map<string, [string, string]>();
  for (const line of HSK_WORDS.split("\n")) {
    const [word] = line.split("\t");
    if (!word) continue;
    const card = await cedictCard(word, { count: false });
    if (card) out.set(word, [card.phonetic, card.gloss]);
  }
  return out;
}

if (DUMP) {
  const now = await cards();
  writeFileSync(DUMP, [...now].map(([w, [p, g]]) => `${w}\t${p}\t${g}`).join("\n") + "\n");
  console.log(`wrote ${now.size} cards to ${DUMP}`);
} else if (SINCE) {
  const before = new Map<string, string>();
  for (const line of readFileSync(SINCE, "utf8").split("\n")) {
    const [w, p] = line.replace(/\r$/, "").split("\t");
    if (w && p) before.set(w, p);
  }
  const rows = new Map<string, Set<string>>();
  let meta: Record<string, unknown> = {};
  try {
    for (const line of readFileSync(OUT, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line) as { w?: string; o?: string[]; _meta?: Record<string, unknown> };
      if (row._meta) meta = row._meta;
      else if (row.w) rows.set(row.w, new Set(row.o ?? []));
    }
  } catch {
    // no file yet
  }
  const now = await cards();
  let moved = 0;
  for (const [w, [p]] of now) {
    const was = before.get(w);
    if (!was || was === p) continue;
    moved++;
    console.log(`${w}  ${was} → ${p}`);
    rows.set(w, new Set([...(rows.get(w) ?? []), was]));
  }
  // A pinyin that is the current one again is no longer old.
  for (const [w, olds] of rows) {
    const p = now.get(w)?.[0];
    if (p) olds.delete(p);
    if (!olds.size) rows.delete(w);
  }
  console.log(`${moved} cards read otherwise since ${SINCE}; ${rows.size} words in the file`);
  if (WRITE) {
    const head = {
      _meta: {
        ...meta,
        what: "Per HSK word, the pinyin its card used to be made with (scripts/card-pinyin-moves.ts); a card still carrying one moves to the current reading on read (services/capture.ts refreshCardReadings).",
        words: rows.size,
      },
    };
    const body = [...rows].sort(([a], [b]) => a.localeCompare(b)).map(([w, o]) => ({ w, o: [...o] }));
    writeFileSync(OUT, [head, ...body].map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`written ${OUT}`);
  }
} else {
  console.log("--dump FILE | --since FILE [--write]");
}
