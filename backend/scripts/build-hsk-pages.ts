// Builds data/hsk-pages.jsonl: the word page of every HSK word, written once for
// everyone (services/wordPages.ts) — its senses grounded in CC-CEDICT, two short
// phrases per sense with pinyin and Russian, the card's part of speech, synonyms
// and antonyms. The page used to be a model call per card on its first open.
//
// No example sentences here: they depend on the learner's level, and the pool in
// data/hsk-sentences.jsonl has them (BACKLOG "Sentences one step above you").
//
// Checked before anything is kept (scripts/word-pages-rules.ts), per word:
//   - every sense cites the inventory glosses it covers, all under one reading, and
//     not only rare, dialect or slang ones;
//   - each phrase contains the word and reads it the way its sense does (还书 is
//     huán shū, never hái shū), one pinyin syllable per character;
//   - the Russian is Russian;
//   - the card's own meaning (hsk-ru) opens one of the senses, so the page can
//     tick what the card tests, and some sense is under the card's reading.
// A word that fails is written again with the problems named, twice at most. What
// still fails hard is dropped (a phrase, or a sense left without one); the soft
// notes stay on the page as "f" for the hand read. Both are counted in the report.
//
// Resumable: finished words are appended to data/hsk-pages.partial.jsonl as they
// land, and a rerun skips them — stop it any time and start it again. The final
// file is assembled in list order once (nearly) every word has a page.
//   cd backend && npx tsx scripts/build-hsk-pages.ts [--limit N] [--concurrency N] [--model M]
//   --pick               the 50 hard words (打 上 过 得 …): print their pages and the
//                        problem counts, write nothing — run once per model to pick one
//   --words 打,上,还      the same for these words
//   --redo 打,上          write these again
//   --report             the check's numbers for what is written, no model calls
//   --max-level 6        only HSK 1–6 (shipped so on 2026-09-28; 7–9 keep the per-card path)
//   --fix notes.tsv      rewrite the pages the hand read found wrong ("word<TAB>what is wrong" a line)
//   --fix-flagged RE     …and every page with a rules note matching RE (e.g. English)
import { readFileSync, existsSync, appendFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const { chatJson } = await import("../src/services/llm.js");
const { HSK_VERSIONS, HSK_MAX_LEVEL, hskLevelWords, hskTagFor } = await import("../src/services/hsk.js");
const { defaultMeaning } = await import("../src/services/lookup.js");
const { minLevel } = await import("../src/services/sentences.js");
const { prisma } = await import("../src/services/db.js");
const { pageInventory, inventoryText, pageProblems, pageOf, draftOf, problemText, score, POS: POS_LIST } = await import("./word-pages-rules.js");
type Draft = import("./word-pages-rules.js").Draft;
type Gloss = import("./word-pages-rules.js").Gloss;
type ListWord = import("./word-pages-rules.js").ListWord;
type Problem = import("./word-pages-rules.js").Problem;
type WordPage = import("../src/services/wordPages.js").WordPage;

const argOf = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const LIMIT = argOf("--limit") ? Number(argOf("--limit")) : undefined;
const CONCURRENCY = Number(argOf("--concurrency") ?? 12);
// Picked on the 50 hard words (2026-09-28), thinking off: a third of qwen-plus's hard
// problems on the first draft, and it keeps 会 'will' and 得 děi, which qwen-plus dropped.
const MODEL = argOf("--model") ?? "qwen3.5-plus";
const REDO = argOf("--redo")?.split(",") ?? [];
const REPORT = process.argv.includes("--report");
// Up to this level only (7 = HSK 7–9): the file is written once these are covered,
// with every page already made; a later run without it goes on from there.
const MAX_LEVEL = argOf("--max-level") ? Number(argOf("--max-level")) : 7;
const FIX = argOf("--fix");
const FIX_FLAGGED = argOf("--fix-flagged") ? new RegExp(argOf("--fix-flagged")!) : null;
const BATCH = 6;
const TRIES = 3;

// The words a model is picked on: the most polysemous common ones, words with two
// readings, 儿 words and a list phrase — where a page goes wrong if it can.
const HARD =
  "打 上 过 得 还 行 长 了 着 地 被 把 给 要 会 想 开 发 干 重 好 觉 教 便 只 为 对 点 出 算 背 差 当 倒 调 数 种 空 冲 应 处 分 就 才 起来 一下 意思 东西 哪儿 打篮球".split(" ");
const SAMPLE = process.argv.includes("--pick") ? HARD : (argOf("--words")?.split(",") ?? null);

const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
const OUT = `${dataDir}hsk-pages.jsonl`;
const PARTIAL = `${dataDir}hsk-pages.partial.jsonl`;

// --- The words, in list order ---

const words: ListWord[] = [];
{
  const seen = new Set<string>();
  for (const v of HSK_VERSIONS)
    for (let n = 1; n <= HSK_MAX_LEVEL[v]; n++)
      for (const e of hskLevelWords(v, n)) {
        // A card keeps the base of an 儿 word (一下儿 → 一下, services/capture.ts), so
        // the page does too — unless the base is a list word with its own entry.
        const erhua = e.word.length > 1 && e.word.endsWith("儿") && !hskTagFor(e.word.slice(0, -1));
        const word = erhua ? e.word.slice(0, -1) : e.word;
        if (seen.has(word)) continue;
        seen.add(word);
        const pinyin = erhua ? e.pinyin.replace(/\s*r$/, "") : e.pinyin;
        words.push({ word, pinyin, level: minLevel(e.word) ?? 7, meaning: defaultMeaning(word, "ru") ?? "" });
      }
}
const byWord = new Map(words.map((w) => [w.word, w]));
const inventories = new Map<string, Gloss[] | null>();
const inventoryOf = (w: ListWord) => {
  if (!inventories.has(w.word)) inventories.set(w.word, pageInventory(w.word));
  return inventories.get(w.word)!;
};

// --- What is done ---

const done = new Map<string, WordPage>();
for (const file of [OUT, PARTIAL]) {
  if (!existsSync(file)) continue;
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const row = JSON.parse(l) as WordPage;
    if (row.w && row.s?.length) done.set(row.w, row);
  }
}
for (const w of REDO) done.delete(w);

// --- The prompts ---

const POS = POS_LIST.join(", ");

const RULES =
  '"senses": 1–5 senses for the learner, the most common in modern Mandarin first — which the card\'s Russian ' +
  "meaning may not list first (被 is the passive marker before it is 'a quilt'; 还 is 'still' before 'to return'). " +
  "Give every sense a learner meets in everyday Mandarin, not only the card's: 得 is also dé 'to get' and děi " +
  "'must'; 上 is also 'on' after a noun (桌子上); 行 is also 'OK, will do'. " +
  "Every sense comes from the inventory: \"refs\" lists the numbers of the glosses it covers, all under ONE reading " +
  "(a word read two ways has a sense for each reading it needs). Never add a sense that is not in the inventory, " +
  "however plausible — select, group and translate, never invent. Glosses that take the same Russian translation " +
  "are ONE sense. Senses differ in meaning, never in grammar: a word that works as an adjective and an adverb is one " +
  'sense with "pos" "прилагательное / наречие". Leave out glosses marked archaic, literary, dialect, Taiwan, vulgar ' +
  "or slang, and purely technical ones, unless the word has nothing else.\n" +
  "The card's meaning must be on the page: each part of it between \";\" is one of your senses, and that sense's " +
  "\"meaning\" starts with exactly the card's words (card \"бить; драться\" → a sense \"бить, ударять\" and a sense " +
  "\"драться\") — unless the part matches nothing in the inventory. At least one sense is under the card's reading.\n" +
  `Each sense: "pos" = its part of speech in Russian, lowercase, from: ${POS}; ` +
  '"meaning" = a short Russian gloss of this sense only, the way a learner\'s dictionary writes it — not a literal ' +
  "rendering of the English: 1–4 words, near-synonyms separated by \", \", optionally a typical object in " +
  'parentheses; "phrases" = exactly 2 short, natural, common collocations (2–8 characters, not sentences, no ' +
  "names): the word with the words it most often goes with (上课, 打电话, 开车, 桌子上), never the word alone, " +
  "written exactly as given and not as part of another word (上 never inside 晚上), in THIS sense and " +
  'reading, each with "reading" = its pinyin with tone marks, ONE syllable per character separated by spaces ' +
  "(还钱 → huán qián; 儿 joins its syllable: 一点儿 → yì diǎnr), the word read as this sense's reading, and " +
  '"translation" = natural Russian.\n' +
  '"pos": the part of speech of the card\'s first sense, in the same Russian words.\n' +
  '"synonyms": up to 4 close synonyms of the card\'s main sense — words a learner can say instead of it in everyday ' +
  "modern Mandarin, in the same register and used on their own: never a classical one-character equivalent that " +
  "lives only inside compounds (大 is not 巨 or 宏, 好 is not 良 or 善, 快 is not 速), never a literary, humble or " +
  "archaic form (我 has none: not 本人, 鄙人, 在下 or 小人 — and 小人 today means 'a mean person'), never a word " +
  "whose own main meaning is different. \"antonyms\": up to 3 words opposite in meaning (大/小, 来/去, 高兴/难过) — " +
  "never another member of the same set (我/你, 他/她, 红/绿 are not opposites or synonyms). Pronouns, particles, " +
  "numbers and measure words usually have neither. Chinese words only. Return an empty list rather than a " +
  "stretch — most words have no true opposite.\n" +
  "Simplified characters.";

const SHAPE =
  'Respond as JSON: {"items":[{"word": string, "pos": string, "senses":[{"refs": number[], "pos": string, ' +
  '"meaning": string, "phrases":[{"text": string, "reading": string, "translation": string}]}], ' +
  '"synonyms": string[], "antonyms": string[]}]}.';

const SYSTEM =
  "You write the word pages of a Chinese–Russian learner's dictionary (like Pleco) for Russian speakers preparing " +
  "for the HSK exam. Each item gives a Chinese word, the reading its card shows, its HSK level, the meaning its card " +
  "shows in Russian (senses separated by \";\") and its sense inventory from CC-CEDICT, a Chinese–English " +
  "dictionary: numbered glosses, each line under its reading. For each word return:\n" +
  RULES +
  "\n" +
  SHAPE;

const FIX_SYSTEM =
  "You fix the word pages of a Chinese–Russian learner's dictionary for Russian speakers preparing for the HSK " +
  "exam. Each item has a Chinese word, the reading its card shows, its card's Russian meaning, its CC-CEDICT " +
  "inventory, the page written before and what is wrong with it. Return the whole page again with every problem " +
  "fixed and everything else kept. The rules the page follows:\n" +
  RULES +
  "\n" +
  SHAPE;

const phraseSchema = z.object({
  text: z.string().default(""),
  reading: z.string().default(""),
  translation: z.string().default(""),
});
const itemSchema = z.object({
  word: z.string(),
  pos: z.string().nullish(),
  senses: z
    .array(
      z.object({
        refs: z.array(z.coerce.number()).nullish(),
        pos: z.string().nullish(),
        meaning: z.string().default(""),
        phrases: z.array(phraseSchema).nullish(),
      }),
    )
    .default([]),
  synonyms: z.array(z.string()).nullish(),
  antonyms: z.array(z.string()).nullish(),
});
// A thinking model sometimes answers with the bare list: take that as the items.
const pagesSchema = z.preprocess(
  (v) => (Array.isArray(v) ? { items: v } : v),
  z.object({ items: z.array(itemSchema).default([]) }),
);
// What chatJson hands back is the schema's input: the defaults may not be applied yet.
type Item = z.input<typeof itemSchema>;

const draftOfItem = (it: Item | undefined): Draft => ({
  pos: (it?.pos ?? "").trim(),
  senses: (it?.senses ?? []).map((s) => ({
    refs: (s.refs ?? []).map(Number).filter((n) => Number.isInteger(n)),
    pos: (s.pos ?? "").trim(),
    meaning: (s.meaning ?? "").trim(),
    phrases: (s.phrases ?? []).map((p) => ({
      text: (p.text ?? "").trim(),
      reading: (p.reading ?? "").trim(),
      translation: (p.translation ?? "").trim(),
    })),
  })),
  synonyms: it?.synonyms ?? [],
  antonyms: it?.antonyms ?? [],
});

const itemInput = (w: ListWord) => ({
  word: w.word,
  reading: w.pinyin,
  level: `HSK ${w.level}`,
  card: w.meaning,
  inventory: inventoryText(inventoryOf(w)!),
});

type Work = { w: ListWord; d: Draft; ps: Problem[]; tries: number };

async function writeBatch(batch: ListWord[]): Promise<Work[]> {
  const r = await chatJson({
    system: SYSTEM,
    user: JSON.stringify(batch.map(itemInput)),
    schema: pagesSchema,
    label: "build.hskPages",
    model: MODEL,
    timeoutMs: 240_000,
  });
  const got = new Map((r.items ?? []).map((it) => [it.word.trim(), it]));
  return batch.map((w) => {
    const d = draftOfItem(got.get(w.word));
    return { w, d, ps: pageProblems(w, d, inventoryOf(w)!), tries: 1 };
  });
}

async function fixBatch(work: Work[]): Promise<void> {
  const r = await chatJson({
    system: FIX_SYSTEM,
    user: JSON.stringify(
      work.map((x) => ({
        ...itemInput(x.w),
        before: { pos: x.d.pos, senses: x.d.senses, synonyms: x.d.synonyms, antonyms: x.d.antonyms },
        problems: problemText(x.ps),
      })),
    ),
    schema: pagesSchema,
    label: "build.hskPages.fix",
    model: MODEL,
    timeoutMs: 240_000,
  });
  for (const x of work) {
    x.tries++;
    const it = (r.items ?? []).find((i) => i.word.trim() === x.w.word);
    if (!it) continue;
    const d = draftOfItem(it);
    const ps = pageProblems(x.w, d, inventoryOf(x.w)!);
    // Keep the rewrite unless it is worse than what it replaces.
    if (score(ps) <= score(x.ps)) Object.assign(x, { d, ps });
    else if (FIX || FIX_FLAGGED) console.log(`${x.w.word}: rewrite kept out (${score(ps)} > ${score(x.ps)}): ${problemText(ps)}`);
  }
}

async function withRetry<T>(what: string, f: () => Promise<T>): Promise<T | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await f();
    } catch (err) {
      console.error(`${what} attempt ${attempt}:`, (err as Error).message);
    }
  }
  return null;
}

// Counted as the run goes, for the model pick: problems on the first draft and after the rewrites.
const tally = { words: 0, firstHard: 0, firstSoft: 0, lastHard: 0, lastSoft: 0, rewritten: 0 };
const count = (ps: Problem[], hard: boolean) => ps.filter((p) => p.hard === hard).length;

function printPage(x: Work, page: WordPage | null) {
  console.log(`\n${x.w.word} ${x.w.pinyin} · card: ${x.w.meaning} · tries ${x.tries}`);
  if (!page) return console.log("  (nothing usable)");
  console.log(`  pos: ${page.pos} · syn: ${page.syn.join(" ") || "—"} · ant: ${page.ant.join(" ") || "—"}`);
  page.s.forEach((s, i) => {
    console.log(`  ${i + 1}. [${s.r}] ${s.pos} — ${s.m}  (refs ${s.g.join(",")})`);
    for (const p of s.p) console.log(`       ${p.t}  ${p.r}  — ${p.ru}`);
  });
  const dropped = x.ps.filter((p) => p.hard);
  if (dropped.length) console.log(`  dropped: ${problemText(dropped)}`);
  if (page.f?.length) console.log(`  notes: ${page.f.join(" | ")}`);
}

async function runBatch(batch: ListWord[]): Promise<number> {
  const work = await withRetry(`batch ${batch[0].word}…`, () => writeBatch(batch));
  // A batch Bailian refuses (its content filter reads the glosses of one word) goes
  // again a word at a time, so only that word waits.
  if (!work && batch.length > 1) {
    let n = 0;
    for (const w of batch) n += await runBatch([w]);
    return n;
  }
  if (!work) return 0;
  for (const x of work) {
    tally.words++;
    tally.firstHard += count(x.ps, true);
    tally.firstSoft += count(x.ps, false);
  }
  for (let t = 1; t < TRIES; t++) {
    const bad = work.filter((x) => x.ps.length);
    if (!bad.length) break;
    if (t === 1) tally.rewritten += bad.length;
    await withRetry(`fix ${bad[0].w.word}…`, () => fixBatch(bad));
  }
  let n = 0;
  for (const x of work) {
    tally.lastHard += count(x.ps, true);
    tally.lastSoft += count(x.ps, false);
    const page = pageOf(x.w, x.d, inventoryOf(x.w)!);
    if (SAMPLE) {
      printPage(x, page);
      continue;
    }
    if (!page) continue; // nothing usable: the word waits for a rerun
    done.set(x.w.word, page);
    appendFileSync(PARTIAL, JSON.stringify(page) + "\n");
    n++;
  }
  return n;
}

// --- The report ---

function report() {
  let senses = 0;
  let phrases = 0;
  let flagged = 0;
  let twoReadings = 0;
  const notes: Record<string, number> = {};
  for (const page of done.values()) {
    senses += page.s.length;
    phrases += page.s.reduce((n, s) => n + s.p.length, 0);
    if (new Set(page.s.map((s) => s.r)).size > 1) twoReadings++;
    if (page.f?.length) flagged++;
    for (const f of page.f ?? []) {
      const kind = f.replace(/^sense \d+(, phrase \d+)?: /, "").replace(/"[^"]*"/g, "…").split(":")[0];
      notes[kind] = (notes[kind] ?? 0) + 1;
    }
  }
  const n = done.size || 1;
  console.log(`${done.size}/${words.length} words have a page`);
  console.log(`  ${senses} senses (${(senses / n).toFixed(2)} a word), ${phrases} phrases; ${twoReadings} pages span two readings`);
  console.log(`  ${flagged} pages kept with notes for the hand read`);
  for (const [k, v] of Object.entries(notes).sort((a, b) => b[1] - a[1])) console.log(`    ${v}  ${k}`);
}

function writeFinal() {
  const meta = {
    _meta: {
      source: `HSK word pages (senses, phrases, part of speech, synonyms and antonyms) written by Qwen (${MODEL}) from CC-CEDICT's senses`,
      basedOn: "data/cedict.jsonl",
      license: "CC BY-SA 4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      lang: "ru",
      words: done.size,
      maxLevel: MAX_LEVEL,
      built: new Date().toISOString(),
      generatedBy: "scripts/build-hsk-pages.ts",
    },
  };
  const lines = [JSON.stringify(meta), ...words.filter((w) => done.has(w.word)).map((w) => JSON.stringify(done.get(w.word)))];
  writeFileSync(OUT, lines.join("\n") + "\n");
  if (existsSync(PARTIAL)) unlinkSync(PARTIAL);
  console.log(`wrote ${OUT}`);
}

if (REPORT) {
  report();
  await prisma.$disconnect();
  process.exit(0);
}

// --fix: pages the hand read found wrong go back through the same rewrite as the
// build's own problems, with the reader's note among them — plus every page the
// rules now flag (--fix-flagged), e.g. English left in the Russian. Prints each
// page before and after for a second read, and writes the file.
if (FIX || FIX_FLAGGED) {
  const notes = new Map<string, string[]>();
  if (FIX)
    for (const l of readFileSync(FIX, "utf8").split("\n")) {
      const [w, note] = l.split("\t").map((s) => s?.trim());
      if (w && note) notes.set(w, [...(notes.get(w) ?? []), note]);
    }
  const work: Work[] = [];
  for (const lw of words) {
    const page = done.get(lw.word);
    if (!page) {
      if (notes.has(lw.word)) console.warn(`no page for ${lw.word}`);
      continue;
    }
    const d = draftOf(page);
    const ps = pageProblems(lw, d, inventoryOf(lw)!);
    const flagged = FIX_FLAGGED && ps.some((p) => FIX_FLAGGED.test(p.note));
    if (!notes.has(lw.word) && !flagged) continue;
    work.push({ w: lw, d, ps: [...ps, ...(notes.get(lw.word) ?? []).map((note) => ({ note, hard: false }))], tries: 1 });
  }
  console.log(`${work.length} pages to fix, ${MODEL}`);
  const before = new Map(work.map((x) => [x.w.word, done.get(x.w.word)!]));
  const fixBatches: Work[][] = [];
  for (let i = 0; i < work.length; i += BATCH) fixBatches.push(work.slice(i, i + BATCH));
  let at = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (at < fixBatches.length) {
        const b = fixBatches[at++];
        await withRetry(`fix ${b[0].w.word}…`, () => fixBatch(b));
      }
    }),
  );
  const brief = (p: WordPage) =>
    p.s.map((s, i) => `  ${i + 1}. [${s.r}] ${s.m} :: ${s.p.map((x) => `${x.t} ${x.r} (${x.ru})`).join(" / ")}`).join("\n") +
    `\n  syn ${p.syn.join(" ") || "—"} · ant ${p.ant.join(" ") || "—"}`;
  let changed = 0;
  for (const x of work) {
    const page = pageOf(x.w, x.d, inventoryOf(x.w)!);
    const was = before.get(x.w.word)!;
    const body = (p: WordPage) => JSON.stringify([p.s, p.syn, p.ant]);
    if (!page || body(page) === body(was)) {
      console.log(`\n${x.w.word}: not rewritten, kept as it was`);
      continue;
    }
    done.set(x.w.word, page);
    changed++;
    console.log(`\n${x.w.word} · ${notes.get(x.w.word)?.join(" | ") ?? "flagged"}\n before:\n${brief(was)}\n after:\n${brief(page)}`);
  }
  console.log(`\n${changed}/${work.length} pages rewritten`);
  writeFinal();
  await prisma.$disconnect();
  process.exit(0);
}

const offDict = words.filter((w) => !inventoryOf(w));
const todo = (
  SAMPLE
    ? SAMPLE.map((s) => byWord.get(s) ?? console.warn(`not on the lists: ${s}`)).filter((w): w is ListWord => Boolean(w))
    : words.filter((w) => !done.has(w.word) && w.level <= MAX_LEVEL)
)
  .filter((w) => inventoryOf(w))
  .slice(0, SAMPLE ? Infinity : (LIMIT ?? Infinity));
console.log(
  `${words.length} words, ${done.size} done, ${todo.length} to go, ${MODEL}` +
    (offDict.length ? `; ${offDict.length} not in CC-CEDICT, left to the per-card path (${offDict.slice(0, 8).map((w) => w.word).join(" ")})` : ""),
);

const batches: ListWord[][] = [];
for (let i = 0; i < todo.length; i += BATCH) batches.push(todo.slice(i, i + BATCH));
let next = 0;
let written = 0;
const t0 = Date.now();
async function worker() {
  while (next < batches.length) {
    const b = batches[next++];
    // Not `written += await …`: that reads `written` before the await.
    const n = await runBatch(b);
    written += n;
    if (!SAMPLE) {
      const s = (Date.now() - t0) / 1000;
      const left = written ? Math.round(((todo.length - written) * s) / written / 60) : "?";
      console.log(`${written}/${todo.length} (${Math.round(s)} s, ~${left} min left)`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const tn = tally.words || 1;
console.log(
  `\n${MODEL}: ${tally.words} words in ${Math.round((Date.now() - t0) / 1000)} s — first draft ${tally.firstHard} hard / ` +
    `${tally.firstSoft} soft problems (${(tally.firstHard / tn).toFixed(2)} hard a word); ${tally.rewritten} rewritten; ` +
    `after the rewrites ${tally.lastHard} hard (dropped) / ${tally.lastSoft} soft (noted)`,
);

const missing = words.filter((w) => !done.has(w.word) && inventoryOf(w) && w.level <= MAX_LEVEL);
if (!SAMPLE) {
  console.log(`done: ${done.size}/${words.length}; missing ${missing.length}${missing.length ? ` (e.g. ${missing.slice(0, 12).map((w) => w.word).join(" ")})` : ""}`);
  report();
}

// The final file once the partial one covers the list (or nearly).
if (!LIMIT && !SAMPLE && missing.length <= 25) writeFinal();
await prisma.$disconnect();

