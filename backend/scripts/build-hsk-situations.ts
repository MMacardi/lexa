// Builds data/hsk-situations.jsonl: the scenes each HSK word is met in (0–2 of
// SITUATIONS in services/wordPages.ts), for the next-word order — a day of airport
// words (护照 登机 行李) sticks better than 护照 而且 菜单 发烧. Words that belong
// everywhere (是 而 觉得 高兴) get none.
//
// Its own file and its own short pass, apart from the word pages: the tag set is the
// part most likely to change once the next-word order uses it, and changing it then
// costs minutes (a rerun of this), not the pages again.
//
// Checked: every tag is one of the list, at most two. An unknown tag is dropped and
// counted. Resumable like the other builds (data/hsk-situations.partial.jsonl).
//   cd backend && npx tsx scripts/build-hsk-situations.ts [--limit N] [--concurrency N] [--model M]
//   --words 护照,菜单,而   print the tags for these, write nothing
//   --redo 护照           tag these again
//   --report             the spread of the tags, no model calls
import { readFileSync, existsSync, appendFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const { chatJson } = await import("../src/services/llm.js");
const { HSK_VERSIONS, HSK_MAX_LEVEL, hskLevelWords, hskTagFor } = await import("../src/services/hsk.js");
const { defaultMeaning } = await import("../src/services/lookup.js");
const { SITUATIONS } = await import("../src/services/wordPages.js");
const { prisma } = await import("../src/services/db.js");
type Situation = import("../src/services/wordPages.js").Situation;

const argOf = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const LIMIT = argOf("--limit") ? Number(argOf("--limit")) : undefined;
const CONCURRENCY = Number(argOf("--concurrency") ?? 12);
// qwen-plus tagged general words anyway (问题 → doctor, 今天 → weather, 写 → office:
// 74% of the list got a scene); qwen3.5-plus, thinking off, leaves them out as asked.
const MODEL = argOf("--model") ?? "qwen3.5-plus";
const SAMPLE = argOf("--words")?.split(",") ?? null;
const REDO = argOf("--redo")?.split(",") ?? [];
const REPORT = process.argv.includes("--report");
const BATCH = 40;

const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
const OUT = `${dataDir}hsk-situations.jsonl`;
const PARTIAL = `${dataDir}hsk-situations.partial.jsonl`;

// The same words, keyed the same way, as the pages (scripts/build-hsk-pages.ts).
type Word = { word: string; pinyin: string; meaning: string };
const words: Word[] = [];
{
  const seen = new Set<string>();
  for (const v of HSK_VERSIONS)
    for (let n = 1; n <= HSK_MAX_LEVEL[v]; n++)
      for (const e of hskLevelWords(v, n)) {
        const erhua = e.word.length > 1 && e.word.endsWith("儿") && !hskTagFor(e.word.slice(0, -1));
        const word = erhua ? e.word.slice(0, -1) : e.word;
        if (seen.has(word)) continue;
        seen.add(word);
        words.push({ word, pinyin: erhua ? e.pinyin.replace(/\s*r$/, "") : e.pinyin, meaning: defaultMeaning(word, "ru") ?? "" });
      }
}
const byWord = new Map(words.map((w) => [w.word, w]));
const known = new Set(Object.keys(SITUATIONS));

const done = new Map<string, Situation[]>();
for (const file of [OUT, PARTIAL]) {
  if (!existsSync(file)) continue;
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const row = JSON.parse(l) as { w?: string; s?: Situation[] };
    if (row.w && row.s) done.set(row.w, row.s);
  }
}
for (const w of REDO) done.delete(w);

const SYSTEM =
  "You tag Chinese words with the situations a learner meets them in, for an app that teaches a few words of one " +
  "situation a day (护照, 登机, 行李 on an airport day). Each item gives a word, its reading and its meaning in " +
  "Russian. Give each word 0–2 situations from this list (the key, exactly as written):\n" +
  Object.entries(SITUATIONS)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n") +
  "\nTag a word only when a learner would meet it mostly in that situation, together with its other words: 护照 → " +
  "airport; 菜单 → restaurant; 挂号 → doctor; 房租 → renting. Words that belong to every situation get []: function " +
  "words and connectors (而, 所以, 虽然), pronouns, numbers and measure words, time words, general verbs and " +
  "adjectives (是, 觉得, 高兴, 重要), and categories that are not a situation (colours, feelings). When unsure, []." +
  ' Respond as JSON: {"items":[{"word": string, "s": string[]}]}.';

const schema = z.object({ items: z.array(z.object({ word: z.string(), s: z.array(z.string()).nullish() })).default([]) });

let unknownTags = 0;
async function runBatch(batch: Word[]): Promise<number> {
  let r: z.input<typeof schema> | null = null;
  for (let attempt = 1; attempt <= 3 && !r; attempt++) {
    try {
      r = await chatJson({
        system: SYSTEM,
        user: JSON.stringify(batch.map((w) => ({ word: w.word, reading: w.pinyin, meaning: w.meaning }))),
        schema,
        label: "build.hskSituations",
        model: MODEL,
        timeoutMs: 120_000,
      });
    } catch (err) {
      console.error(`batch ${batch[0].word}… attempt ${attempt}:`, (err as Error).message);
    }
  }
  if (!r) return 0;
  const got = new Map((r.items ?? []).map((it) => [it.word.trim(), it.s ?? []]));
  let n = 0;
  for (const w of batch) {
    const raw = got.get(w.word);
    if (!raw) continue; // not answered: the word waits for a rerun
    const tags = [...new Set(raw.map((t) => t.trim()))].filter((t) => known.has(t)).slice(0, 2) as Situation[];
    unknownTags += raw.filter((t) => !known.has(t.trim())).length;
    if (SAMPLE) {
      console.log(`${w.word}  ${w.meaning}  →  ${tags.join(", ") || "—"}`);
      continue;
    }
    done.set(w.word, tags);
    appendFileSync(PARTIAL, JSON.stringify({ w: w.word, s: tags }) + "\n");
    n++;
  }
  return n;
}

function report() {
  const per = new Map<string, string[]>();
  let none = 0;
  for (const [w, tags] of done) {
    if (!tags.length) none++;
    for (const t of tags) per.set(t, [...(per.get(t) ?? []), w]);
  }
  console.log(`${done.size}/${words.length} words tagged; ${none} with no situation (${((none / (done.size || 1)) * 100).toFixed(0)}%)`);
  for (const [t, ws] of [...per].sort((a, b) => b[1].length - a[1].length))
    console.log(`  ${String(ws.length).padStart(5)}  ${t.padEnd(14)} ${ws.slice(0, 12).join(" ")}`);
  const unused = [...known].filter((k) => !per.has(k));
  if (unused.length) console.log(`  never used: ${unused.join(", ")}`);
}

if (REPORT) {
  report();
  await prisma.$disconnect();
  process.exit(0);
}

const todo = SAMPLE
  ? SAMPLE.map((s) => byWord.get(s) ?? console.warn(`not on the lists: ${s}`)).filter((w): w is Word => Boolean(w))
  : words.filter((w) => !done.has(w.word)).slice(0, LIMIT ?? Infinity);
console.log(`${words.length} words, ${done.size} done, ${todo.length} to go, ${MODEL}`);

const batches: Word[][] = [];
for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
let next = 0;
let written = 0;
const t0 = Date.now();
async function worker() {
  while (next < batches.length) {
    const n = await runBatch(batches[next++]);
    written += n;
    if (!SAMPLE) console.log(`${written}/${todo.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
if (unknownTags) console.log(`${unknownTags} tags not on the list, dropped`);

const missing = words.filter((w) => !done.has(w.word));
if (!SAMPLE) {
  console.log(`done: ${done.size}/${words.length}; missing ${missing.length}`);
  report();
}
if (!LIMIT && !SAMPLE && missing.length <= 25) {
  const meta = {
    _meta: {
      source: `Situation tags for the HSK 2.0 + 3.0 words, by Qwen (${MODEL}), from SITUATIONS in services/wordPages.ts`,
      situations: Object.keys(SITUATIONS),
      words: done.size,
      built: new Date().toISOString(),
      generatedBy: "scripts/build-hsk-situations.ts",
    },
  };
  const lines = [JSON.stringify(meta), ...words.filter((w) => done.has(w.word)).map((w) => JSON.stringify({ w: w.word, s: done.get(w.word) }))];
  writeFileSync(OUT, lines.join("\n") + "\n");
  if (existsSync(PARTIAL)) unlinkSync(PARTIAL);
  console.log(`wrote ${OUT}`);
}
await prisma.$disconnect();
