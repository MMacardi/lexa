// Builds data/hsk-sentences.jsonl: three example sentences for every HSK word, one
// under each ceiling (services/sentences.ts) — besides the headword, HSK 1–2 words
// only / nothing above the word's own level / natural — with the Russian, and the
// words each was checked with. A learner is then handed the one they can read, with
// no model call, and the same sentence never has to be written twice.
//
// Checked before anything is kept, per sentence:
//   - the ceiling: segmented as the Reader cuts it, every word besides the headword
//     is on a list at or under the ceiling's level;
//   - the headword is there as a word of its own (上 inside 上班 teaches 上班);
//   - it is read the list's way (1b), tones aside — 还 as huán is another word.
//     The model states the reading it used: pinyin-pro reads 长得 as cháng and 还我
//     as hái, exactly the cases this is for, so it can't be the judge;
//   - a sentence, not a line: 5+ characters, and not the same as another of the three;
//   - the Russian is Russian.
// A sentence that fails is written again with the problem named, twice at most.
// One that still misses only its ceiling is kept, flagged — a learner is scored on
// their own words anyway, the ceiling only spreads the three; one that still fails
// anything else is dropped. Both are counted in the report, so the error rate is
// stated, not guessed.
//
// Resumable: finished words are appended to data/hsk-sentences.partial.jsonl as
// they land, and a rerun skips them. The final file is assembled in list order.
//   cd backend && npx tsx scripts/build-hsk-sentences.ts [--limit N] [--concurrency N] [--model M]
//   --words 打,上,地图   print what the prompt gives for these, write nothing
//   --redo 打,上         write these again
//   --report             the check's numbers for the finished file, no model calls
//   --judge              a native editor's read of every sentence; the unnatural ones
//                        written again natural first, read again, dropped if they still
//                        fail (see "The naturalness pass" below). --words to try it on a few.
import { readFileSync, existsSync, appendFileSync, writeFileSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const { chatJson } = await import("../src/services/llm.js");
const { HSK_VERSIONS, HSK_MAX_LEVEL, hskLevelWords, hskTagFor } = await import("../src/services/hsk.js");
const { defaultMeaning } = await import("../src/services/lookup.js");
const { cedictInventory } = await import("../src/services/cedict.js");
const { CEILINGS, ceilingLevel, minLevel, overCeiling, sentenceWords } = await import("../src/services/sentences.js");
const { prisma } = await import("../src/services/db.js");
type Ceiling = (typeof CEILINGS)[number];

const argOf = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const LIMIT = argOf("--limit") ? Number(argOf("--limit")) : undefined;
const CONCURRENCY = Number(argOf("--concurrency") ?? 12);
const MODEL = argOf("--model") ?? "qwen-plus";
const SAMPLE = argOf("--words")?.split(",") ?? null;
const REDO = argOf("--redo")?.split(",") ?? [];
const REPORT = process.argv.includes("--report");
const BATCH = 8;
const FIX_BATCH = 12;
const TRIES = 3;

const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
const OUT = `${dataDir}hsk-sentences.jsonl`;
const PARTIAL = `${dataDir}hsk-sentences.partial.jsonl`;

// --- The words, in list order ---

type Word = { word: string; pinyin: string; level: number; meaning: string };
const words: Word[] = [];
{
  const seen = new Set<string>();
  const all: { word: string; pinyin: string }[] = [];
  for (const v of HSK_VERSIONS)
    for (let n = 1; n <= HSK_MAX_LEVEL[v]; n++) for (const e of hskLevelWords(v, n)) all.push(e);
  for (const e of all) {
    // A card keeps the base of an 儿 word (一下儿 → 一下, services/capture.ts), so
    // the pool does too — unless the base is a list word with its own entry.
    const erhua = e.word.length > 1 && e.word.endsWith("儿") && !hskTagFor(e.word.slice(0, -1));
    const word = erhua ? e.word.slice(0, -1) : e.word;
    if (seen.has(word)) continue;
    seen.add(word);
    const reading = erhua ? e.pinyin.replace(/\s*r$/, "") : e.pinyin;
    words.push({ word, pinyin: reading, level: minLevel(e.word) ?? 7, meaning: defaultMeaning(e.word, "ru") ?? "" });
  }
}
const byWord = new Map(words.map((w) => [w.word, w]));

// The HSK 1–2 words, named in the prompt: "HSK 2 and below" alone is a guess the
// model gets wrong more often than a list.
const easy = words.filter((w) => w.level <= 2).map((w) => w.word);

// --- What is done ---

type Row = { c: Ceiling; zh: string; ru: string; t: string; flags?: string[] };
const done = new Map<string, Row[]>();
const doneDropped = new Map<string, string[]>(); // why a word has fewer than three
// From the naturalness pass: words formal by nature ("f"), and the sentences it
// replaced ("o"), which a card may still carry.
const formalWords = new Set<string>();
const retired = new Map<string, string[]>();
for (const file of [OUT, PARTIAL]) {
  if (!existsSync(file)) continue;
  for (const l of readFileSync(file, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const row = JSON.parse(l);
    if (!row.w) continue;
    done.set(row.w, row.s);
    if (row.x) doneDropped.set(row.w, row.x);
    if (row.f) formalWords.add(row.w);
    if (row.o?.length) retired.set(row.w, row.o);
  }
}
const extrasOf = (w: string) => ({ ...(formalWords.has(w) ? { f: 1 } : {}), ...(retired.get(w)?.length ? { o: retired.get(w) } : {}) });
for (const w of REDO) done.delete(w);

// --- The check ---

const toneless = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[üv]/g, "u")
    .toLowerCase()
    .trim();

/** Readings compared without tones or spaces (一下 is yí xià in a sentence, yī xià on the list). */
const sameReading = (got: string, list: string) =>
  toneless(got).replace(/\s+/g, "").replace(/er$/, "r") === toneless(list).replace(/\s+/g, "").replace(/er$/, "r");

/** What is wrong with a sentence, as the note the rewrite gets; [] when it passes. */
function problems(w: Word, c: Ceiling, zh: string, ru: string, py: string): string[] {
  const out: string[] = [];
  if (!zh.includes(w.word)) return [`it must contain "${w.word}" written exactly so`];
  const { words: rest, own } = sentenceWords(zh, w.word);
  if (!own) out.push(`"${w.word}" must stand as a word of its own, not inside a longer word`);
  const over = overCeiling(rest, c, w.word);
  if (over.length) out.push(`besides "${w.word}" use only words of HSK ${ceilingLevel(c, w.word)} and below; replace ${over.join(", ")}`);
  if (py && !sameReading(py, w.pinyin)) out.push(`"${w.word}" must be the word read ${w.pinyin} (${w.meaning}), not ${py}`);
  const han = Array.from(zh).filter((ch) => /\p{Script=Han}/u.test(ch)).length;
  if (han < 5) out.push("write a complete sentence with a situation, 8–25 characters, not a short line");
  if (han > 32) out.push("keep it under 25 characters");
  if (!/\p{Script=Cyrillic}/u.test(ru) || /\p{Script=Han}/u.test(ru)) out.push("the translation must be Russian");
  return out;
}

const isCeiling = (flag: string) => flag.startsWith("besides");

const REPEAT = "the same as another of its sentences: write a different situation";

/** The same sentence under two ceilings teaches one situation twice. */
function markRepeats(drafts: Draft[]) {
  const seen = new Map<Word, Set<string>>();
  for (const d of drafts) {
    const mine = seen.get(d.w) ?? new Set<string>();
    seen.set(d.w, mine);
    const key = d.zh.replace(/[\p{P}\s]/gu, "");
    if (key && mine.has(key) && !d.flags.length) d.flags.push(REPEAT);
    mine.add(key);
  }
}

// --- The prompts ---

const TOPICS =
  "daily routine, family, food and drink, shopping, transport, travel, school and study, work, health, weather " +
  "and seasons, sport and hobbies, friends, home and the city, time and plans, feelings, festivals and culture, " +
  "phones and the internet, nature, society and news";

const SYSTEM =
  "You write example sentences for Russian speakers learning Chinese for the HSK exam. For each item you get a " +
  "Chinese word, its reading, its level, its meaning in Russian and its dictionary senses (CC-CEDICT, in English, " +
  "by reading). Write THREE sentences for it, each one natural, " +
  "correct Mandarin a native speaker would say or write, 8–25 characters, using the word exactly as given (same " +
  "characters, as a word of its own — 上 never inside 上班 or 晚上), in a sense of the given reading only (长 given " +
  "as cháng is 'long', never zhǎng 'to grow') — the most common one in modern Mandarin, which the Russian meaning " +
  "may not list first (被 is the passive marker before it is 'a quilt') — in a concrete situation that makes the " +
  "meaning clear:\n" +
  `- "c":1 — every other word in it is from HSK 1–2. The only words allowed besides the item are these: ${easy.join(" ")}\n` +
  '- "c":2 — every other word is at the item\'s own HSK level or below;\n' +
  '- "c":3 — natural, any words, the way the word is really used (it may be written or formal if the word is).\n' +
  `Give the three different situations, taken from: ${TOPICS}. No personal names — use 我, 朋友, 同事, 妈妈, ` +
  "老师 and the like. Never a bare line like 行。 or 上！ Simplified characters. For each sentence also give " +
  '"py": the pinyin of the item\'s word as read in THAT sentence, and "ru": a natural Russian translation. ' +
  'Keep each word exactly as given. Respond as JSON: {"items":[{"word": string, "sentences":[{"c":1,"zh": string,' +
  '"py": string,"ru": string},{"c":2,…},{"c":3,…}]}]}.';

const FIX_SYSTEM =
  "You fix example sentences for Russian speakers learning Chinese. Each item has a Chinese word, its reading, its " +
  "meaning, the rule its sentence must follow, the sentence written before and what is wrong with it. Write a new " +
  "sentence that follows the rule and fixes the problem: a complete, natural, correct Mandarin sentence of 8–25 " +
  "characters in a concrete situation — never a bare line like 行。 or 上！ — the word used exactly as given, as a " +
  "word of its own, in the given reading and meaning, in a different situation from the item's other sentences; " +
  "no personal names; simplified characters. Give \"py\": the pinyin of the word as read in your sentence, and " +
  `"ru": a natural Russian translation. The HSK 1–2 words are: ${easy.join(" ")}. ` +
  'Respond as JSON: {"items":[{"word": string, "c": number, "zh": string, "py": string, "ru": string}]}.';

const RULE: Record<Ceiling, (w: Word) => string> = {
  1: () => "every other word is from HSK 1–2",
  2: (w) => `every other word is from HSK ${Math.max(2, w.level)} or below`,
  3: () => "natural, any words",
};

const sentenceSchema = z.object({ c: z.coerce.number(), zh: z.string().default(""), py: z.string().default(""), ru: z.string().default("") });
const writeSchema = z.object({
  items: z.array(z.object({ word: z.string(), sentences: z.array(sentenceSchema).default([]) })).default([]),
});
const fixSchema = z.object({
  items: z
    .array(z.object({ word: z.string(), c: z.coerce.number(), zh: z.string().default(""), py: z.string().default(""), ru: z.string().default("") }))
    .default([]),
});

const clean = (s: string) => s.trim().replace(/\s+/g, "");

type Draft = { w: Word; c: Ceiling; zh: string; ru: string; flags: string[]; tries: number };

async function writeBatch(batch: Word[]): Promise<Draft[]> {
  const r = await chatJson({
    system: SYSTEM,
    user: JSON.stringify(
      batch.map((w) => ({
        word: w.word,
        pinyin: w.pinyin,
        level: `HSK ${w.level}`,
        meaning: w.meaning,
        senses: cedictInventory(w.word, 10, { count: false }) ?? "",
      })),
    ),
    schema: writeSchema,
    label: "build.hskSentences",
    model: MODEL,
    timeoutMs: 180_000,
  });
  const got = new Map((r.items ?? []).map((it) => [it.word.trim(), it.sentences]));
  const out: Draft[] = [];
  for (const w of batch) {
    const ss = got.get(w.word) ?? [];
    for (const c of CEILINGS) {
      const s = ss.find((x) => x.c === c);
      const zh = clean(s?.zh ?? "");
      const ru = (s?.ru ?? "").trim();
      out.push({ w, c, zh, ru, flags: zh ? problems(w, c, zh, ru, s?.py ?? "") : ["missing"], tries: 1 });
    }
  }
  markRepeats(out);
  return out;
}

async function fixBatch(drafts: Draft[], all: Draft[]): Promise<void> {
  const r = await chatJson({
    system: FIX_SYSTEM,
    user: JSON.stringify(
      drafts.map((d) => ({
        word: d.w.word,
        pinyin: d.w.pinyin,
        meaning: d.w.meaning,
        c: d.c,
        rule: RULE[d.c](d.w),
        before: d.zh || null,
        problem: d.flags.join("; "),
        others: all.filter((o) => o.w === d.w && o !== d && o.zh).map((o) => o.zh),
      })),
    ),
    schema: fixSchema,
    label: "build.hskSentences.fix",
    model: MODEL,
    timeoutMs: 180_000,
  });
  for (const d of drafts) {
    d.tries++;
    const it = (r.items ?? []).find((x) => x.word.trim() === d.w.word && x.c === d.c);
    if (!it?.zh) continue;
    const zh = clean(it.zh);
    const ru = (it.ru ?? "").trim();
    const flags = problems(d.w, d.c, zh, ru, it.py ?? "");
    if (all.some((o) => o.w === d.w && o !== d && o.zh === zh)) flags.push(REPEAT);
    // Keep the rewrite unless it is worse than what it replaces.
    if (flags.length <= d.flags.length || !d.zh) Object.assign(d, { zh, ru, flags });
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

async function runBatch(batch: Word[]): Promise<number> {
  const drafts = await withRetry(`batch ${batch[0].word}…`, () => writeBatch(batch));
  if (!drafts) return 0;
  for (let t = 1; t < TRIES; t++) {
    const bad = drafts.filter((d) => d.flags.length);
    if (!bad.length) break;
    for (let i = 0; i < bad.length; i += FIX_BATCH) {
      const chunk = bad.slice(i, i + FIX_BATCH);
      await withRetry(`fix ${chunk[0].w.word}…`, () => fixBatch(chunk, drafts));
    }
  }
  if (SAMPLE) {
    for (const d of drafts) console.log([d.w.word, `c${d.c}`, d.zh, d.ru, d.flags.join("; ") || "ok", `tries ${d.tries}`].join(" | "));
    return 0;
  }
  let n = 0;
  for (const w of batch) {
    const mine = drafts.filter((d) => d.w === w);
    const kept = mine.filter((d) => d.zh && d.ru && d.flags.every(isCeiling));
    if (!kept.length) continue; // nothing usable: the word waits for a rerun
    const rows: Row[] = kept.map((d) => ({
      c: d.c,
      zh: d.zh,
      ru: d.ru,
      t: sentenceWords(d.zh, w.word).words.join(" "),
      ...(d.flags.length ? { flags: d.flags } : {}),
    }));
    const dropped = mine.filter((d) => !kept.includes(d)).map((d) => d.flags.find((f) => !isCeiling(f)) ?? "missing");
    done.set(w.word, rows);
    doneDropped.set(w.word, dropped);
    appendFileSync(PARTIAL, JSON.stringify({ w: w.word, s: rows, ...(dropped.length ? { x: dropped } : {}) }) + "\n");
    n++;
  }
  return n;
}

// --- The report ---

function report() {
  let sentences = 0;
  const flagged: Record<string, number> = {};
  const byCeiling: Record<number, { n: number; ok: number }> = { 1: { n: 0, ok: 0 }, 2: { n: 0, ok: 0 }, 3: { n: 0, ok: 0 } };
  for (const [word, rows] of done) {
    const w = byWord.get(word);
    if (!w) continue;
    for (const r of rows) {
      sentences++;
      const flags = r.flags ?? [];
      byCeiling[r.c].n++;
      if (!flags.length) byCeiling[r.c].ok++;
      for (const f of flags) {
        const kind = isCeiling(f) ? "over the ceiling" : f;
        flagged[kind] = (flagged[kind] ?? 0) + 1;
      }
    }
  }
  console.log(`${done.size}/${words.length} words, ${sentences} sentences`);
  for (const c of CEILINGS) {
    const b = byCeiling[c];
    console.log(`  ceiling ${c}: ${b.ok}/${b.n} pass (${b.n ? ((b.ok / b.n) * 100).toFixed(1) : 0}%)`);
  }
  for (const [k, v] of Object.entries(flagged)) console.log(`  kept, flagged — ${k}: ${v}`);
  const drops: Record<string, number> = {};
  for (const [word, reasons] of doneDropped) {
    if (!done.has(word)) continue;
    for (const f of reasons) {
      const kind = f.includes(" read ") ? "another reading" : f.includes("own") ? "inside a longer word" : f.split(":")[0].split(",")[0];
      drops[kind] = (drops[kind] ?? 0) + 1;
    }
  }
  const short = [...done.values()].filter((rows) => rows.length < CEILINGS.length).length;
  console.log(`  dropped ${Object.values(drops).reduce((a, b) => a + b, 0)} sentences; ${short} words have fewer than three`);
  for (const [k, v] of Object.entries(drops)) console.log(`  dropped — ${k}: ${v}`);
}

if (REPORT) {
  report();
  await prisma.$disconnect();
  process.exit(0);
}

// --- The naturalness pass (--judge) ---
//
// The ceilings bent the Chinese where a word has no easy context: 以 held to HSK 1–2
// came out as 他以笔写字, where anyone says 用笔 (the author, 2026-09-28: "I don't
// want to see any unnatural sentences"). So every sentence gets a native editor's
// read. One that fails is written again natural first — its ceiling only where the
// word can keep it naturally, and it is then labelled with the level it really has —
// read again, and dropped if it still fails: a word short of a sentence gets one
// written per card, which beats showing a bad one. A word that is formal by nature
// (以, 之所以, 颇) is marked, and its sentences carry the formal label. Replaced
// sentences stay on the row ("o"), so a card that carries one gets the new one on open.
if (process.argv.includes("--judge")) {
  const JMODEL = argOf("--model") ?? "qwen3.5-plus";
  // --strict --formal-only: the second read the author's 之 asked for (2026-09-29) —
  // the first let 这本书是孩子之最爱 through as "formal". Only the words marked formal,
  // where that style lives; the verdicts say nothing new about "formal" (kept as is).
  const STRICT = process.argv.includes("--strict");
  const FORMAL_ONLY = process.argv.includes("--formal-only");
  const JUDGE_FILE = `${dataDir}hsk-sentences.judge.partial.jsonl`;
  const JUDGE_BATCH = 12;
  type Verdict = { formal: boolean; bad: { n: number; why: string }[] };
  type Item = { w: Word; s: { zh: string; ru: string }[] };

  const JUDGE_SYSTEM =
    "You are a native Mandarin editor checking the example sentences of a Chinese–Russian learner's dictionary. " +
    "For each word you get its reading, its Russian meaning and its example sentences (\"n\" numbers them) with " +
    "Russian translations. Judge each sentence strictly: is it natural, idiomatic, correct modern Mandarin that a " +
    "native speaker would really say or write, with the word used the way natives use it — the right sense, " +
    "collocation and register? BAD: a sentence no native would say even if grammatical (他以笔写字 where anyone " +
    "says 用笔写字; 我每天以手机上网), stilted or bent to use easy words, odd in logic, the word in a wrong sense, " +
    "or a Russian translation that is wrong or unnatural. " +
    (STRICT
      ? "Formal is fine, pseudo-classical is not: BAD is any sentence in a stilted classical style a modern writer " +
        "wouldn't use (此乃学习汉语之起点, 这本书是孩子之最爱 — modern Chinese says 这是学习汉语的起点, 孩子最喜爱的书); " +
        "a formal word must sit in modern formal Chinese — news, work, study, notices — or in the fixed modern " +
        "expressions it lives in (三分之一, 北京之行, 成功之道, 由于天气原因). Judge as the editor of a modern textbook. "
      : "") +
    "Also say whether the WORD itself is formal or written " +
    "language (书面语) that natives rarely use in everyday speech (以, 之所以, 颇, 予以, 凡) — not merely rare or " +
    "advanced. " +
    'Respond as JSON: {"items":[{"word": string, "formal": boolean, "bad":[{"n": number, "why": string}]}]} with ' +
    'EVERY word given, in order — "bad": [] when all its sentences are natural; list only the bad sentences, "why" ' +
    "in a few English words.";

  // A bare list is taken as the items (qwen3.5 answers so now and then).
  const listOrItems = <S extends z.ZodTypeAny>(item: S) => {
    const obj = z.object({ items: z.array(item).default([]) });
    return z.preprocess((v) => (Array.isArray(v) ? { items: v } : v), obj) as unknown as z.ZodType<z.output<typeof obj>>;
  };
  const judgeSchema = listOrItems(
    z.object({
      word: z.string(),
      formal: z.boolean().catch(false),
      bad: z.array(z.object({ n: z.coerce.number(), why: z.string().catch("") })).catch([]),
    }),
  );

  async function judge(items: Item[]): Promise<Map<string, Verdict>> {
    const r = await chatJson({
      system: JUDGE_SYSTEM,
      user: JSON.stringify(
        items.map((it) => ({
          word: it.w.word,
          reading: it.w.pinyin,
          meaning: it.w.meaning,
          sentences: it.s.map((s, i) => ({ n: i + 1, zh: s.zh, ru: s.ru })),
        })),
      ),
      schema: judgeSchema,
      label: "build.hskSentences.judge",
      model: JMODEL,
      timeoutMs: 180_000,
    });
    const out = new Map<string, Verdict>();
    for (const it of r.items ?? []) out.set(it.word.trim(), { formal: it.formal, bad: it.bad });
    return out;
  }

  async function inParallel<T>(jobs: T[], f: (job: T) => Promise<void>) {
    let at = 0;
    await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
      while (at < jobs.length) await f(jobs[at++]);
    }));
  }

  // 1. The read, resumable: verdicts land in JUDGE_FILE as they come.
  const verdicts = new Map<string, Verdict>();
  if (!SAMPLE && existsSync(JUDGE_FILE))
    for (const l of readFileSync(JUDGE_FILE, "utf8").split("\n")) {
      if (!l.trim()) continue;
      const row = JSON.parse(l) as Verdict & { w: string };
      verdicts.set(row.w, { formal: row.formal, bad: row.bad });
    }
  const scope = (SAMPLE ? SAMPLE.map((s) => byWord.get(s)).filter((w): w is Word => Boolean(w)) : words).filter(
    (w) => done.get(w.word)?.length && (!FORMAL_ONLY || formalWords.has(w.word)),
  );
  const toRead = scope.filter((w) => !verdicts.has(w.word));
  console.log(`${scope.length} words, ${verdicts.size} read before, ${toRead.length} to read, ${JMODEL}`);
  const readBatches: Word[][] = [];
  for (let i = 0; i < toRead.length; i += JUDGE_BATCH) readBatches.push(toRead.slice(i, i + JUDGE_BATCH));
  let read = 0;
  await inParallel(readBatches, async (b) => {
    const got = await withRetry(`judge ${b[0].word}…`, () => judge(b.map((w) => ({ w, s: done.get(w.word)! }))));
    for (const w of b) {
      const v = got?.get(w.word);
      if (!v) continue; // not answered: read on the rerun
      verdicts.set(w.word, v);
      if (!SAMPLE) appendFileSync(JUDGE_FILE, JSON.stringify({ w: w.word, ...v }) + "\n");
    }
    read += b.length;
    if (!SAMPLE && read % 600 < JUDGE_BATCH) console.log(`read ${read}/${toRead.length}`);
  });
  const unread = scope.filter((w) => !verdicts.has(w.word));
  if (unread.length > 25 && !SAMPLE) {
    console.log(`${unread.length} words unread — run it again (it resumes)`);
    await prisma.$disconnect();
    process.exit(1);
  }

  // 2. The rewrite: natural first, the ceiling where it can be kept naturally.
  const NATURAL_SYSTEM =
    "You rewrite example sentences that a native editor rejected, for Russian speakers learning Chinese. Each item " +
    "has a Chinese word, its reading, its meaning, whether the word is formal (书面语), the rejected sentence and " +
    "why, the vocabulary rule it was written under, and the word's other sentences. Write ONE new sentence a native " +
    "speaker would really say or write: natural, idiomatic, correct modern Mandarin, 8–25 characters, the word " +
    "exactly as given and as a word of its own, in the given reading and its most common sense, in a concrete " +
    "situation different from the other sentences. Keep to the vocabulary rule when the word can be used naturally " +
    "within it; when it can't (a formal word like 以 has no natural context among HSK 1–2 words), use the words it " +
    "needs — a natural sentence always beats an easy one. A formal word goes in the register it lives in (news, " +
    "work, study, notices, writing) — modern formal Chinese, never a pseudo-classical line (此乃…之…, 孩子之最爱), " +
    "and a grammatical word like 之 in the modern expressions it lives in (三分之一, 北京之行, 成功之道). " +
    "No personal names; simplified characters. Give \"py\": the pinyin of the word " +
    `as read in your sentence, and "ru": a natural Russian translation. The HSK 1–2 words are: ${easy.join(" ")}. ` +
    'Respond as JSON: {"items":[{"word": string, "n": number, "zh": string, "py": string, "ru": string}]}.';
  const naturalSchema = listOrItems(
    z.object({ word: z.string(), n: z.coerce.number(), zh: z.string().default(""), py: z.string().default(""), ru: z.string().default("") }),
  );
  type Redo = { w: Word; n: number; old: Row; why: string; zh: string; ru: string; c: Ceiling; ok: boolean; drop?: string };
  const redos: Redo[] = [];
  for (const w of scope)
    for (const b of verdicts.get(w.word)?.bad ?? []) {
      const old = done.get(w.word)![b.n - 1];
      if (old) redos.push({ w, n: b.n, old, why: b.why, zh: "", ru: "", c: 3, ok: false, drop: "no rewrite came back" });
    }
  // Two rounds: the second gets the first attempt back with what was wrong with it
  // (a check it failed, or the editor's second read), as the build's own fixes do.
  for (let round = 1; round <= 2; round++) {
    const open = redos.filter((d) => !d.ok);
    if (!open.length) break;
    const fixBatches: Redo[][] = [];
    for (let i = 0; i < open.length; i += FIX_BATCH) fixBatches.push(open.slice(i, i + FIX_BATCH));
    await inParallel(fixBatches, async (b) => {
      const r = await withRetry(`rewrite ${b[0].w.word}…`, () =>
        chatJson({
          system: NATURAL_SYSTEM,
          user: JSON.stringify(
            b.map((d) => ({
              word: d.w.word,
              pinyin: d.w.pinyin,
              meaning: d.w.meaning,
              formal: verdicts.get(d.w.word)?.formal ?? false,
              n: d.n,
              rejected: round === 1 || !d.zh ? d.old.zh : d.zh,
              why: round === 1 ? d.why : (d.drop ?? d.why).replace(/^[^:]*: /, ""),
              rule: RULE[d.old.c](d.w),
              others: done.get(d.w.word)!.filter((s) => s !== d.old).map((s) => s.zh),
            })),
          ),
          schema: naturalSchema,
          label: "build.hskSentences.natural",
          model: JMODEL,
          timeoutMs: 180_000,
        }),
      );
      for (const d of b) {
        const it = r?.items.find((x) => x.word.trim() === d.w.word && x.n === d.n);
        if (!it?.zh) continue;
        const zh = clean(it.zh);
        const ru = it.ru.trim();
        d.zh = zh;
        // Every check but the ceiling; the ceiling becomes the label it really has.
        const ps = problems(d.w, 3, zh, ru, it.py);
        if (done.get(d.w.word)!.some((s) => s.zh === zh)) ps.push("the same as another");
        if (ps.length) {
          d.drop = `${zh}: ${ps.join("; ")}`;
          continue;
        }
        const rest = sentenceWords(zh, d.w.word).words;
        const c = ([1, 2] as Ceiling[]).find((x) => !overCeiling(rest, x, d.w.word).length) ?? 3;
        Object.assign(d, { ru, c, ok: true, drop: undefined });
      }
    });

    // The rewrites read again; one that fails goes to the next round, or is dropped.
    const byWordRedo = new Map<string, Redo[]>();
    for (const d of open.filter((x) => x.ok)) byWordRedo.set(d.w.word, [...(byWordRedo.get(d.w.word) ?? []), d]);
    const again = [...byWordRedo.entries()];
    const againBatches: (typeof again)[] = [];
    for (let i = 0; i < again.length; i += JUDGE_BATCH) againBatches.push(again.slice(i, i + JUDGE_BATCH));
    await inParallel(againBatches, async (b) => {
      const got = await withRetry(`judge again ${b[0][0]}…`, () => judge(b.map(([, ds]) => ({ w: ds[0].w, s: ds }))));
      for (const [word, ds] of b) {
        const v = got?.get(word);
        if (!v) ds.forEach((d) => Object.assign(d, { ok: false, drop: `${d.zh}: not read again` })); // unread: not shown
        else
          for (const bad of v.bad) {
            const d = ds[bad.n - 1];
            if (d) Object.assign(d, { ok: false, drop: `${d.zh}: read again, ${bad.why}` });
          }
      }
    });
  }

  // 4. The pool again, with what changed.
  let replaced = 0;
  let dropped = 0;
  const formalSeen: string[] = [];
  for (const w of scope) {
    const v = verdicts.get(w.word);
    if (!v) continue;
    if (v.formal) {
      formalWords.add(w.word);
      formalSeen.push(w.word);
    }
    const mine = redos.filter((d) => d.w === w);
    if (!mine.length) continue;
    const rows = done.get(w.word)!.filter((s) => !mine.some((d) => d.old === s));
    for (const d of mine) {
      if (d.ok) {
        rows.push({ c: d.c, zh: d.zh, ru: d.ru, t: sentenceWords(d.zh, w.word).words.join(" ") });
        replaced++;
      } else dropped++;
    }
    rows.sort((a, b) => a.c - b.c);
    retired.set(w.word, [...new Set([...(retired.get(w.word) ?? []), ...mine.map((d) => d.old.zh)])]);
    if (SAMPLE) {
      console.log(`\n${w.word} ${w.pinyin} · ${w.meaning}${v.formal ? " · FORMAL" : ""}`);
      for (const d of mine)
        console.log(`  ✗ c${d.old.c} ${d.old.zh} (${d.why})\n    → ${d.ok ? `c${d.c} ${d.zh} — ${d.ru}` : `dropped (${d.drop})`}`);
      continue;
    }
    done.set(w.word, rows);
  }
  const sentences = words.reduce((n, w) => n + (done.get(w.word)?.length ?? 0), 0);
  console.log(
    `\n${JMODEL}: read ${scope.length} words; ${redos.length} sentences rejected, ${replaced} written again and kept, ` +
      `${dropped} dropped; ${formalSeen.length} words formal (${formalSeen.slice(0, 20).join(" ")})`,
  );
  if (SAMPLE) {
    for (const w of scope) if (!verdicts.get(w.word)?.bad.length) console.log(`  ✓ ${w.word}: ${done.get(w.word)!.map((s) => s.zh).join(" / ")}`);
  } else {
    const meta = {
      _meta: {
        source: `Example sentences written by Qwen (${MODEL}) for the HSK 2.0 + 3.0 word lists, three per word under stated ceilings; read by a native-editor pass (${JMODEL}), the unnatural ones written again natural first or dropped`,
        ceilings: { 1: "besides the headword, HSK 1–2 words only", 2: "nothing above the word's own level", 3: "natural" },
        words: done.size,
        sentences,
        judged: new Date().toISOString(),
        generatedBy: "scripts/build-hsk-sentences.ts",
      },
    };
    const lines = [
      JSON.stringify(meta),
      ...words.filter((w) => done.has(w.word)).map((w) => JSON.stringify({ w: w.word, s: done.get(w.word), ...extrasOf(w.word) })),
    ];
    writeFileSync(OUT, lines.join("\n") + "\n");
    if (existsSync(JUDGE_FILE)) unlinkSync(JUDGE_FILE);
    console.log(`wrote ${OUT} (${sentences} sentences)`);
  }
  await prisma.$disconnect();
  process.exit(0);
}

const todo = SAMPLE
  ? SAMPLE.map((s) => byWord.get(s)).filter((w): w is Word => Boolean(w))
  : words.filter((w) => !done.has(w.word)).slice(0, LIMIT ?? Infinity);
console.log(`${words.length} words (${easy.length} at HSK 1–2), ${done.size} done, ${todo.length} to go, ${MODEL}`);

const batches: Word[][] = [];
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
    if (!SAMPLE) console.log(`${written}/${todo.length} (${Math.round((Date.now() - t0) / 1000)} s)`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const missing = words.filter((w) => !done.has(w.word));
if (!SAMPLE) {
  console.log(`done: ${done.size}/${words.length}; missing ${missing.length}${missing.length ? ` (e.g. ${missing.slice(0, 12).map((w) => w.word).join(" ")})` : ""}`);
  report();
}

// The final file once the partial one covers the list (or nearly).
if (!LIMIT && !SAMPLE && missing.length <= 25) {
  const meta = {
    _meta: {
      source: `Example sentences written by Qwen (${MODEL}) for the HSK 2.0 + 3.0 word lists, three per word under stated ceilings`,
      ceilings: { 1: "besides the headword, HSK 1–2 words only", 2: "nothing above the word's own level", 3: "natural" },
      words: done.size,
      built: new Date().toISOString(),
      generatedBy: "scripts/build-hsk-sentences.ts",
    },
  };
  const lines = [
    JSON.stringify(meta),
    ...words.filter((w) => done.has(w.word)).map((w) => JSON.stringify({ w: w.word, s: done.get(w.word), ...extrasOf(w.word) })),
  ];
  writeFileSync(OUT, lines.join("\n") + "\n");
  if (existsSync(PARTIAL)) unlinkSync(PARTIAL);
  console.log(`wrote ${OUT}`);
}
await prisma.$disconnect();
