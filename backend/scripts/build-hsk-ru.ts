// Builds data/hsk-ru.jsonl: one default Russian meaning for every headword in the
// CC-CEDICT subset (HSK 2.0 + 3.0), so an HSK word is a card in the learner's
// language the moment it is added, and "посещать" finds 访问 with no model call
// (services/dictRu.ts). Before this, every fresh card sat in the dictionary's
// English until a per-card model call translated the same word again — for every
// learner who ever added it.
//
// Grounded like the capture prompts: the model gets the reading the card will
// show and the dictionary's senses, and only picks and translates. The output is
// derived from CC-CEDICT, so it carries the same CC BY-SA 4.0 licence and credit.
//
// Resumable: finished words are appended to data/hsk-ru.partial.jsonl as they
// land, and a rerun skips them. The final file is assembled in dictionary order
// once every word has a meaning.
//   cd backend && npx tsx scripts/build-hsk-ru.ts [--limit N] [--concurrency N]
import { readFileSync, existsSync, appendFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const { chatJson } = await import("../src/services/llm.js");
const { cedictCard, cedictInventory } = await import("../src/services/cedict.js");
const { prisma } = await import("../src/services/db.js");

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : undefined;
};
const LIMIT = arg("--limit");
const CONCURRENCY = arg("--concurrency") ?? 6;
const MODEL = process.argv.includes("--model") ? process.argv[process.argv.indexOf("--model") + 1] : "qwen-plus";
// --words 一直,一旦,…: print what the prompt gives for these, write nothing (for tuning it).
const SAMPLE = process.argv.includes("--words") ? process.argv[process.argv.indexOf("--words") + 1].split(",") : null;
// --redo 卡,主页,…: write these again (a meaning found wrong after the build).
const REDO = process.argv.includes("--redo") ? process.argv[process.argv.indexOf("--redo") + 1].split(",") : [];
const BATCH = 40;

const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
const OUT = `${dataDir}hsk-ru.jsonl`;
const PARTIAL = `${dataDir}hsk-ru.partial.jsonl`;

const rows = readFileSync(`${dataDir}cedict.jsonl`, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l) as { s?: string; _meta?: { release: string } });
const release = rows.find((r) => r._meta)?._meta?.release ?? "";
const headwords = rows.filter((r) => r.s).map((r) => r.s!);

// A rerun picks up the finished file (to fill only the words it lacks) and a partial one.
const done = new Map<string, { s: string; p: string; m: string }>();
for (const file of [OUT, PARTIAL]) {
  if (!existsSync(file)) continue;
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const row = JSON.parse(l);
    if (row.s) done.set(row.s, row);
  }
}
for (const w of REDO) done.delete(w);
const todo = SAMPLE ?? headwords.filter((w) => !done.has(w)).slice(0, LIMIT ?? Infinity);
console.log(`${headwords.length} headwords, ${done.size} done, ${todo.length} to go`);

const schema = z.object({
  items: z.array(z.object({ word: z.string(), meaning: z.string().default("") })).default([]),
});

const SYSTEM =
  "You write the default flashcard meaning for a Russian speaker learning Chinese. Each item has a Chinese " +
  "word, the reading the card shows (pinyin), and the English dictionary senses. Give its meaning in Russian " +
  "the way a good Chinese–Russian learner's dictionary (БКРС) would, for that reading: the main sense, 1–4 words, " +
  "optionally with one close synonym after a comma when it sharpens the sense (посещать, навещать); when the word " +
  "has a second common sense that is genuinely different, add it after \"; \" (всё время; прямо). Prefer the sense a " +
  "learner meets first over a literal or rare one; idioms get their Russian equivalent. Verbs in the " +
  "infinitive, nouns in the nominative. The whole meaning stays under 45 characters: no examples, no «например», " +
  "no explanations — a parenthesis only for a short register tag like (разг.) or (эвф.). Grammar words (particles, " +
  "measure words) get a short functional label in " +
  "Russian, e.g. «счётное слово для книг», «частица прошедшего действия». No pinyin, no English, no Chinese, no " +
  "quotes. Base it on the senses given — pick and translate, don't invent a sense that isn't there. Keep each " +
  'word exactly as given. Respond as JSON: {"items":[{"word": string, "meaning": string}]}.';

// The model lists every sense of a bare character (打 came back with five). A card
// face holds two or three: keep senses in order while they fit, never fewer than one.
function trimSenses(m: string): string {
  const out: string[] = [];
  for (const sense of m.split(/\s*;\s*/).filter(Boolean)) {
    if (out.length && [...out, sense].join("; ").length > 45) break;
    out.push(sense);
  }
  return out.join("; ");
}

async function runBatch(words: string[]): Promise<number> {
  const items = [];
  for (const w of words) {
    const card = await cedictCard(w, { count: false });
    const senses = cedictInventory(w, 10, { count: false });
    if (!card || !senses) continue;
    items.push({ word: w, pinyin: card.phonetic, senses });
  }
  const r = await chatJson({ system: SYSTEM, user: JSON.stringify(items), schema, label: "build.hskRu", model: MODEL, timeoutMs: 120_000 });
  const got = new Map((r.items ?? []).map((it) => [it.word.trim(), it.meaning.trim()]));
  if (SAMPLE) {
    for (const it of items) console.log([it.word, it.pinyin, trimSenses(got.get(it.word) ?? "—")].join(" | "));
    return 0;
  }
  let n = 0;
  for (const it of items) {
    const raw = got.get(it.word);
    const m = raw ? trimSenses(raw) : "";
    // Chinese in it, or no Russian at all ("to visit"), is the model not following
    // the brief; leave the word for a rerun. "SMS-сообщение" is fine.
    if (!m || /\p{Script=Han}/u.test(m) || !/\p{Script=Cyrillic}/u.test(m)) continue;
    const row = { s: it.word, p: it.pinyin, m };
    done.set(it.word, row);
    appendFileSync(PARTIAL, JSON.stringify(row) + "\n");
    n++;
  }
  return n;
}

const batches: string[][] = [];
for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
let next = 0;
let written = 0;
const t0 = Date.now();
async function worker() {
  while (next < batches.length) {
    const b = batches[next++];
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        // Not `written += await …`: that reads `written` before the await, and
        // the other workers' batches land in between.
        const n = await runBatch(b);
        written += n;
        break;
      } catch (err) {
        console.error(`batch ${b[0]}… attempt ${attempt}:`, (err as Error).message);
      }
    }
    console.log(`${written}/${todo.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const missing = headwords.filter((w) => !done.has(w));
console.log(`done: ${done.size}/${headwords.length}; missing ${missing.length}${missing.length ? ` (e.g. ${missing.slice(0, 12).join(" ")})` : ""}`);

// The final file only once the partial one covers the dictionary (or nearly: a
// handful of entries CC-CEDICT itself gives no usable sense for).
if (!LIMIT && !SAMPLE && missing.length <= 25) {
  const meta = {
    _meta: {
      source: "Russian meanings for CC-CEDICT senses, written by Qwen (qwen-plus)",
      basedOn: `data/cedict.jsonl, release ${release}`,
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      lang: "ru",
      words: done.size,
      built: new Date().toISOString(),
      generatedBy: "scripts/build-hsk-ru.ts",
    },
  };
  const lines = [JSON.stringify(meta), ...headwords.filter((w) => done.has(w)).map((w) => JSON.stringify(done.get(w)))];
  writeFileSync(OUT, lines.join("\n") + "\n");
  if (existsSync(PARTIAL)) unlinkSync(PARTIAL);
  console.log(`wrote ${OUT}`);
}
await prisma.$disconnect();
