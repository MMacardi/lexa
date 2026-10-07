// A sentence per level band for the HSK pool (PLAN-examples Part 4): one example at
// HSK 3–4 for the words whose pool has none — 1,919 of the 3,317 words at HSK 4 and
// under. Checked before anything is kept, per sentence:
//   - the headword is there as a word of its own, read the list's way (the model
//     states the reading it used, as in build-hsk-sentences.ts);
//   - besides it, every word is HSK 4 or under on BOTH lists (2.0 and 3.0), and no
//     word is off the lists (a name, a rare compound; a one-character piece of a
//     split compound doesn't count, as in services/sentences.ts poolLevel);
//   - it reads HSK 3 or above on each list: an HSK 1–2 sentence is what the pool has;
//   - 8–32 characters, the Russian is Russian.
// A sentence that fails is written again with the problem named, twice at most.
//
// The pilot (2026-10-07) runs the same 50 words through Qwen and a Claude agent:
//   cd backend && npx tsx scripts/build-band-sentences.ts --pick 50       words.json + allowed.txt
//   npx tsx scripts/build-band-sentences.ts --qwen                        qwen.jsonl
//   npx tsx scripts/build-band-sentences.ts --check <file.jsonl>          the check, per sentence
//   npx tsx scripts/build-band-sentences.ts --level 采访,蔬菜              a word's levels on both lists
// Files live in ../.review/band-pilot/ (git-ignored).
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const { HSK_VERSIONS, HSK_MAX_LEVEL, hskLevelWords, hskTagFor } = await import("../src/services/hsk.js");
const { defaultMeaning } = await import("../src/services/lookup.js");
const { cedictInventory } = await import("../src/services/cedict.js");
const S = await import("../src/services/sentences.js");

const argOf = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const DIR = fileURLToPath(new URL("../../.review/band-pilot/", import.meta.url));
mkdirSync(DIR, { recursive: true });
const LO = 3;
const HI = 4;
const TRIES = 3;
const MODEL = argOf("--model") ?? "qwen-plus";
const BATCH = 8;

type Version = (typeof HSK_VERSIONS)[number];
type Word = { word: string; pinyin: string; level: number; meaning: string; senses: string };
type Row = { w: string; zh: string; py: string; ru: string };

// --- Levels, read as the pick reads them (services/sentences.ts) ---

const listTag = (w: string) => hskTagFor(w) ?? hskTagFor(`${w}儿`);
/** A word's level on a list, else its lowest on the other; null off the lists. */
function levelOn(w: string, v: Version): number | null {
  const tag = listTag(w);
  if (!tag) return null;
  return tag[v] ?? Math.min(...(Object.values(tag) as number[]));
}
const name = (n: number) => (n >= 7 ? "7–9" : String(n));

// --- The words: the builder's list (an 儿 word keyed to its base), and the ones the band lacks ---

const all: Word[] = [];
{
  const seen = new Set<string>();
  for (const v of HSK_VERSIONS)
    for (let n = 1; n <= HSK_MAX_LEVEL[v]; n++)
      for (const e of hskLevelWords(v, n)) {
        const erhua = e.word.length > 1 && e.word.endsWith("儿") && !hskTagFor(e.word.slice(0, -1));
        const word = erhua ? e.word.slice(0, -1) : e.word;
        if (seen.has(word)) continue;
        seen.add(word);
        all.push({
          word,
          pinyin: erhua ? e.pinyin.replace(/\s*r$/, "") : e.pinyin,
          level: S.minLevel(e.word) ?? 7,
          meaning: defaultMeaning(e.word, "ru") ?? "",
          senses: cedictInventory(word, 10, { count: false }) ?? "",
        });
      }
}

const atBand = (zh: string, w: string, v: Version) => {
  const n = S.poolLevel({ c: 3, zh, ru: "", t: S.sentenceWords(zh, w).words.join(" ") }, v);
  return n >= LO && n <= HI;
};
/** No pool sentence reads HSK 3–4 on both lists. */
const lacksBand = (w: Word) =>
  w.level <= HI && !HSK_VERSIONS.every((v) => S.poolSentences(w.word).some((s) => atBand(s.zh, w.word, v)));

// --- The check ---

const toneless = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[üv]/g, "u")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/er$/, "r");

/** What is wrong with a sentence, as the note a rewrite gets; [] when it passes. */
export function problems(w: Word, zh: string, ru: string, py: string): string[] {
  if (!zh.includes(w.word)) return [`it must contain "${w.word}" written exactly so`];
  const out: string[] = [];
  const { words: rest, own } = S.sentenceWords(zh, w.word);
  if (!own) out.push(`"${w.word}" must stand as a word of its own, not inside a longer word`);
  const over = new Map<string, string>();
  for (const x of rest) {
    const levels = HSK_VERSIONS.map((v) => levelOn(x, v));
    if (levels[0] === null) {
      if (Array.from(x).length > 1) over.set(x, "not on the HSK lists");
    } else if (levels.some((n) => n! > HI))
      over.set(x, HSK_VERSIONS.map((v, i) => `HSK ${name(levels[i]!)} on ${v}`).join(", "));
  }
  if (over.size)
    out.push(
      `besides "${w.word}" use only words of HSK ${HI} and below on both HSK lists; replace ` +
        [...over].map(([x, why]) => `${x} (${why})`).join(", "),
    );
  else {
    const easy = HSK_VERSIONS.filter((v) => !atBand(zh, w.word, v));
    if (easy.length)
      out.push(`it reads HSK 1–2 on the ${easy.join(" and ")} list: write an HSK 3–4 sentence, with HSK 3–4 words and grammar where they are natural`);
  }
  if (py && toneless(py) !== toneless(w.pinyin)) out.push(`"${w.word}" must be the word read ${w.pinyin} (${w.meaning}), not ${py}`);
  const han = Array.from(zh).filter((ch) => /\p{Script=Han}/u.test(ch)).length;
  if (han < 8) out.push("write a complete sentence with a situation, 10–25 characters");
  if (han > 32) out.push("keep it under 25 characters");
  if (!/\p{Script=Cyrillic}/u.test(ru) || /\p{Script=Han}/u.test(ru)) out.push("the translation must be Russian");
  return out;
}

const byWord = new Map(all.map((w) => [w.word, w]));
const readRows = (file: string): Row[] =>
  readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

// --- The words both writers may use besides the headword: every list tag at HSK 4 or under ---

function allowedList(): string {
  const byLevel = new Map<number, string[]>();
  for (const w of all) {
    const tag = listTag(w.word);
    if (!tag || Object.values(tag).some((n) => n! > HI)) continue;
    byLevel.set(w.level, [...(byLevel.get(w.level) ?? []), w.word]);
  }
  return [...byLevel].sort(([a], [b]) => a - b).map(([n, ws]) => `HSK ${n}: ${ws.join(" ")}`).join("\n");
}

// --- Qwen ---

const SYSTEM = (allowed: string) =>
  "You write example sentences for Russian speakers learning Chinese for the HSK exam. For each item you get a " +
  "Chinese word, its reading, its level, its meaning in Russian and its dictionary senses (CC-CEDICT, in English, " +
  "by reading). Write ONE sentence for it: natural, correct Mandarin a native speaker would say or write, 10–25 " +
  "characters, using the word exactly as given (same characters, as a word of its own — 上 never inside 上班), in a " +
  "sense of the given reading only — the most common one in modern Mandarin — in a concrete everyday situation that " +
  "makes the meaning clear. It is for an HSK 3–4 learner: besides the item, every word must be HSK 4 or below on BOTH " +
  "HSK lists — no rarer word, no technical term, no name — and it must not be an HSK 1–2 sentence: use HSK 3–4 words " +
  "and grammar where they are natural. A natural sentence always beats one bent to fit. The words allowed besides " +
  `the item:\n${allowed}\nNo personal names — use 我, 朋友, 同事, 妈妈, 老师 and the like. Simplified characters. ` +
  'Also give "py": the pinyin of the item\'s word as read in your sentence, and "ru": a natural Russian translation. ' +
  'Respond as JSON: {"items":[{"word": string, "zh": string, "py": string, "ru": string}]}.';

const FIX_SYSTEM = (allowed: string) =>
  "You fix example sentences for Russian speakers learning Chinese. Each item has a Chinese word, its reading, its " +
  "meaning, the sentence written before and what is wrong with it. Write a new sentence that fixes the problem: a " +
  "complete, natural, correct Mandarin sentence of 10–25 characters in a concrete situation, the word used exactly " +
  "as given, as a word of its own, in the given reading and meaning; besides it, only words of HSK 4 and below on both " +
  "HSK lists, and not an HSK 1–2 sentence. No personal names; simplified characters. The words allowed besides the " +
  `item:\n${allowed}\nGive "py": the pinyin of the word as read in your sentence, and "ru": a natural Russian ` +
  'translation. Respond as JSON: {"items":[{"word": string, "zh": string, "py": string, "ru": string}]}.';

const itemsSchema = z.object({
  items: z
    .array(z.object({ word: z.string(), zh: z.string().default(""), py: z.string().default(""), ru: z.string().default("") }))
    .default([]),
});

async function qwen(words: Word[]) {
  const { chatJson } = await import("../src/services/llm.js");
  const allowed = allowedList();
  const clean = (s: string) => s.trim().replace(/\s+/g, "");
  type Draft = { w: Word; zh: string; py: string; ru: string; flags: string[]; tries: number };
  const drafts: Draft[] = [];
  const batches = [];
  for (let i = 0; i < words.length; i += BATCH) batches.push(words.slice(i, i + BATCH));
  await Promise.all(
    batches.map(async (batch) => {
      const r = await chatJson({
        system: SYSTEM(allowed),
        user: JSON.stringify(batch.map((w) => ({ word: w.word, pinyin: w.pinyin, level: `HSK ${w.level}`, meaning: w.meaning, senses: w.senses }))),
        schema: itemsSchema,
        label: "build.bandSentences",
        model: MODEL,
        timeoutMs: 180_000,
      });
      const got = new Map((r.items ?? []).map((it) => [it.word.trim(), it]));
      for (const w of batch) {
        const s = got.get(w.word);
        const zh = clean(s?.zh ?? "");
        drafts.push({ w, zh, py: s?.py ?? "", ru: (s?.ru ?? "").trim(), flags: zh ? problems(w, zh, s?.ru ?? "", s?.py ?? "") : ["missing"], tries: 1 });
      }
    }),
  );
  const firstPass = drafts.filter((d) => !d.flags.length).length;
  for (let round = 2; round <= TRIES; round++) {
    const bad = drafts.filter((d) => d.flags.length);
    if (!bad.length) break;
    const fixes = [];
    for (let i = 0; i < bad.length; i += 12) fixes.push(bad.slice(i, i + 12));
    await Promise.all(
      fixes.map(async (chunk) => {
        const r = await chatJson({
          system: FIX_SYSTEM(allowed),
          user: JSON.stringify(
            chunk.map((d) => ({ word: d.w.word, pinyin: d.w.pinyin, meaning: d.w.meaning, before: d.zh || null, problem: d.flags.join("; ") })),
          ),
          schema: itemsSchema,
          label: "build.bandSentences.fix",
          model: MODEL,
          timeoutMs: 180_000,
        });
        const got = new Map((r.items ?? []).map((it) => [it.word.trim(), it]));
        for (const d of chunk) {
          const s = got.get(d.w.word);
          if (!s?.zh) continue;
          d.zh = clean(s.zh);
          d.py = s.py;
          d.ru = s.ru.trim();
          d.flags = problems(d.w, d.zh, d.ru, d.py);
          d.tries = round;
        }
      }),
    );
  }
  const order = new Map(words.map((w, i) => [w.word, i]));
  drafts.sort((a, b) => order.get(a.w.word)! - order.get(b.w.word)!);
  writeFileSync(`${DIR}qwen.jsonl`, drafts.map((d) => JSON.stringify({ w: d.w.word, zh: d.zh, py: d.py, ru: d.ru, tries: d.tries, flags: d.flags })).join("\n") + "\n");
  const pass = drafts.filter((d) => !d.flags.length).length;
  console.log(`qwen: ${firstPass}/${drafts.length} pass on the first write, ${pass}/${drafts.length} after up to ${TRIES - 1} fixes → ${DIR}qwen.jsonl`);
}

// --- Modes ---

if (argOf("--level")) {
  for (const w of argOf("--level")!.split(/[,，\s]+/).filter(Boolean)) {
    const levels = HSK_VERSIONS.map((v) => `${v}: ${hskTagFor(w)?.[v] ?? hskTagFor(`${w}儿`)?.[v] ?? "—"}`);
    console.log(`${w}  ${listTag(w) ? levels.join("  ") : "not on the HSK lists"}`);
  }
} else if (argOf("--pick")) {
  const n = Number(argOf("--pick"));
  const need = all.filter(lacksBand);
  // A spread over the word's own level (HSK 1–4), every k-th in list order: the same words each run.
  const picked: Word[] = [];
  for (let level = 1; level <= HI; level++) {
    const at = need.filter((w) => w.level === level);
    const take = Math.round((n * at.length) / need.length);
    for (let i = 0; i < take; i++) picked.push(at[Math.floor((i * at.length) / take)]);
  }
  writeFileSync(`${DIR}words.json`, JSON.stringify(picked.slice(0, n), null, 1));
  writeFileSync(`${DIR}allowed.txt`, allowedList() + "\n");
  console.log(`${need.length} words lack an HSK ${LO}–${HI} sentence; picked ${Math.min(n, picked.length)} → ${DIR}words.json, allowed words → ${DIR}allowed.txt`);
} else if (argOf("--split")) {
  // The full run (Claude agents, 2026-10-07): every word that lacks the band, minus
  // the ones already written, in batches of N — words/bNN.json — and the band words
  // (HSK 3–4 on both lists), which clear the floor without leaning on 决定 and 比较.
  const n = Number(argOf("--split"));
  const out = fileURLToPath(new URL("../../.review/band-sentences/", import.meta.url));
  mkdirSync(`${out}words`, { recursive: true });
  const have = new Set<string>();
  for (const f of [`${DIR}sonnet.jsonl`])
    if (existsSync(f)) for (const r of readRows(f)) if (byWord.has(r.w) && !problems(byWord.get(r.w)!, r.zh, r.ru, r.py).length) have.add(r.w);
  const need = all.filter((w) => lacksBand(w) && !have.has(w.word));
  for (let i = 0; i * n < need.length; i++)
    writeFileSync(`${out}words/b${String(i + 1).padStart(2, "0")}.json`, JSON.stringify(need.slice(i * n, (i + 1) * n), null, 1));
  const band = all
    .filter((w) => HSK_VERSIONS.every((v) => { const l = levelOn(w.word, v); return l !== null && l >= LO && l <= HI; }))
    .map((w) => w.word);
  writeFileSync(`${out}band.txt`, band.join(" ") + "\n");
  writeFileSync(`${out}allowed.txt`, allowedList() + "\n");
  console.log(`${need.length} words left (${have.size} done in the pilot) → ${Math.ceil(need.length / n)} batches; ${band.length} band words`);
} else if (process.argv.includes("--merge")) {
  // Every passing sentence from the pilot and the batches → data/hsk-band-sentences.jsonl,
  // in list order, `t` the words as checked; services/sentences.ts adds them to the pool.
  const out = fileURLToPath(new URL("../../.review/band-sentences/", import.meta.url));
  const files = [`${DIR}sonnet.jsonl`, ...(existsSync(out) ? readdirSync(out).filter((f) => /^b\d+\.jsonl$/.test(f)).sort().map((f) => out + f) : [])];
  const kept = new Map<string, Row>();
  let failing = 0;
  for (const f of files.filter(existsSync))
    for (const r of readRows(f)) {
      const w = byWord.get(r.w);
      if (w && !problems(w, r.zh, r.ru, r.py).length) kept.set(r.w, r);
      else failing++;
    }
  const lines = all
    .filter((w) => kept.has(w.word))
    .map((w) => {
      const r = kept.get(w.word)!;
      const t = S.sentenceWords(r.zh, w.word).words.join(" ");
      return JSON.stringify({ w: w.word, s: [{ c: 4, zh: r.zh, ru: r.ru.trim(), t }] });
    });
  writeFileSync(fileURLToPath(new URL("../data/hsk-band-sentences.jsonl", import.meta.url)), lines.join("\n") + "\n");
  const left = all.filter((w) => lacksBand(w) && !kept.has(w.word)).length;
  console.log(`${lines.length} band sentences → data/hsk-band-sentences.jsonl (${failing} lines still failing; ${left} words still lack the band)`);
} else if (process.argv.includes("--qwen")) {
  await qwen(JSON.parse(readFileSync(`${DIR}words.json`, "utf8")));
} else if (argOf("--check")) {
  let pass = 0;
  const rows = readRows(argOf("--check")!);
  for (const r of rows) {
    const w = byWord.get(r.w);
    const p = w ? problems(w, r.zh, r.ru, r.py) : [`"${r.w}" is not an HSK word`];
    if (!p.length) pass++;
    console.log(`${p.length ? "FAIL" : "ok  "} ${r.w}: ${r.zh}${p.length ? `\n     ${p.join("\n     ")}` : ""}`);
  }
  console.log(`${pass}/${rows.length} pass`);
} else {
  console.log("usage: --pick N | --qwen | --check <file.jsonl> | --level 词,词");
}
