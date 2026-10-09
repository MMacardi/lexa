// The Russian → Chinese table of the add form's lookup (BACKLOG 8c, services/lookup.ts
// `ruEntry`): for the Russian words learners type, the Chinese answers in the order a
// native speaker reaches for them, each with a line saying which sense it is, and a
// register mark where it is not the everyday word (何处 книжн. for «где»). Written by
// one Claude editor per batch of ~110 words and checked by a second; this script takes
// what the second wrote ({"entries": [...]} per batch), checks it against the data and
// writes two files:
//   data/ru-zh.jsonl       {q, k?, a: [{w, si?, m, reg?}], x?} — one row per Russian word
//   data/everyday-ru.jsonl {s, m, p: [phrase, its Russian]} — the words off the HSK list
//                          the answers use (有钱, 什么时候), with their card meaning
// Checked: every word is in CC-CEDICT; a sense index points into the word's page (a
// one-sense page gets 0); a line is Russian with no Chinese in it; a word off the list
// brings its meaning and a phrase that contains it. A failing answer is dropped, said.
// A later wave merges in: its rows replace the same words' rows.
//   cd backend && npx tsx scripts/apply-ru-zh.ts --from DIR            print what would change
//   cd backend && npx tsx scripts/apply-ru-zh.ts --from DIR --write    and write the files
//   --part "…"   what this wave covered, kept in the files' _meta.reviewed
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.env.BAILIAN_API_KEY = ""; // the lookup before/after must not reach a model
const { cedictKnows } = await import("../src/services/cedict.js");
const { hskPage } = await import("../src/services/wordPages.js");
const { normalizeHanzi } = await import("../src/services/hsk.js");
const { lookup } = await import("../src/services/lookup.js");

const argOf = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const WRITE = process.argv.includes("--write");
const FROM = argOf("--from");
const PART = argOf("--part");
if (!FROM) throw new Error("--from DIR: the verified batches ({entries: [...]} per file)");

const file = (name: string) => fileURLToPath(new URL(`../data/${name}`, import.meta.url));
type Register = "book" | "formal" | "coll" | "dial";
type Answer = { w: string; si?: number; m: string; reg?: Register };
type Row = { q: string; k?: string[]; a: Answer[]; x?: string[] };
type WordRow = { s: string; m: string; p: [string, string] };
type Edited = {
  q: string;
  action: "keep" | "edit" | "skip";
  v?: string;
  keys?: string[];
  a?: (Answer & { new?: { m: string; p: string; p_ru: string } })[];
  x?: string[];
};

function load<T>(name: string, meta: Record<string, unknown>): { meta: Record<string, unknown>; rows: T[] } {
  if (!existsSync(file(name))) return { meta: { _meta: meta }, rows: [] };
  const lines = readFileSync(file(name), "utf8").split("\n").filter((l) => l.trim());
  return { meta: JSON.parse(lines[0]), rows: lines.slice(1).map((l) => JSON.parse(l) as T) };
}
const save = (name: string, meta: Record<string, unknown>, rows: unknown[]) =>
  writeFileSync(file(name), [meta, ...rows].map((r) => JSON.stringify(r)).join("\n") + "\n");

const SOURCE = {
  license: "CC BY-SA 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
  basedOn: "data/hsk-ru.jsonl and data/hsk-pages.jsonl (from CC-CEDICT), data/cedict-extra.jsonl",
  generatedBy: "scripts/apply-ru-zh.ts",
};
const tableFile = load<Row>("ru-zh.jsonl", {
  source: "Russian → Chinese answers for the add form's lookup, written by one Claude editor and checked by a second",
  lang: "ru",
  ...SOURCE,
});
const wordFile = load<WordRow>("everyday-ru.jsonl", {
  source: "Russian card meanings for everyday words off the HSK lists, written with the ru-zh table",
  lang: "ru",
  ...SOURCE,
});
const hskRu = new Set(
  readFileSync(file("hsk-ru.jsonl"), "utf8")
    .split("\n")
    .slice(1)
    .filter((l) => l.trim())
    .map((l) => (JSON.parse(l) as { s: string }).s),
);

const HAN = /\p{Script=Han}/u;
const CYR = /^[\p{Script=Cyrillic} -]+$/u;
const REG = new Set(["book", "formal", "coll", "dial"]);
const said: string[] = [];
const say = (q: string, what: string) => said.push(`${q}: ${what}`);

const rows = new Map(tableFile.rows.map((r) => [r.q, r]));
const words = new Map(wordFile.rows.map((r) => [r.s, r]));
const before = new Map<string, string>();
let edits = 0, keeps = 0, skips = 0, rejected = 0, newWords = 0;

const batches = readdirSync(FROM).filter((f) => /\.json$/.test(f)).sort();
for (const name of batches) {
  const { entries } = JSON.parse(readFileSync(`${FROM}/${name}`, "utf8")) as { entries: Edited[] };
  for (const e of entries) {
    if (e.action === "keep") keeps++;
    if (e.action === "skip") skips++;
    if (e.action !== "edit") continue;
    if (e.v === "reject") {
      rejected++;
      continue;
    }
    const q = e.q.trim().toLowerCase();
    const keys = (e.keys?.length ? e.keys : [q]).map((k) => k.trim().toLowerCase()).filter((k) => CYR.test(k));
    if (!keys.length) {
      say(q, `no key a learner types (${JSON.stringify(e.keys)})`);
      continue;
    }
    const answers: Answer[] = [];
    for (const a of e.a ?? []) {
      const w = normalizeHanzi(a.w);
      const m = a.m?.trim();
      if (!w || !cedictKnows(w)) {
        say(q, `${a.w} is not in CC-CEDICT — dropped`);
        continue;
      }
      if (answers.some((x) => x.w === w)) continue;
      if (!m || HAN.test(m)) {
        say(q, `${w}: line «${a.m}» is empty or has Chinese in it — dropped`);
        continue;
      }
      if (m.length > 60) say(q, `${w}: long line (${m.length}) «${m}»`);
      const page = hskPage(w, "ru");
      let si: number | undefined;
      if (page) {
        if (a.si !== undefined && Number.isInteger(a.si) && a.si >= 0 && a.si < page.s.length) si = a.si;
        else if (page.s.length === 1) si = 0;
        else if (a.si !== undefined) say(q, `${w}: sense ${a.si} is not on its page (${page.s.length}) — none`);
      }
      if (!hskRu.has(w)) {
        // Off the list: it needs its own card meaning and a phrase.
        const known = words.get(w);
        const n = a.new;
        if (!known && (!n?.m?.trim() || HAN.test(n.m) || !n.p?.includes(w) || !n.p_ru?.trim())) {
          say(q, `${w} is off the list and has no usable meaning and phrase (${JSON.stringify(n)}) — dropped`);
          continue;
        }
        if (!known && n) {
          words.set(w, { s: w, m: n.m.trim(), p: [n.p.trim(), n.p_ru.trim()] });
          newWords++;
        } else if (known && n?.m && n.m.trim() !== known.m) say(q, `${w}: meaning «${n.m}» differs from «${known.m}» written earlier — kept the earlier`);
      }
      const reg = a.reg && REG.has(a.reg) ? (a.reg as Register) : undefined;
      if (a.reg && !reg) say(q, `${w}: unknown register ${a.reg}`);
      answers.push({ w, ...(si !== undefined ? { si } : {}), m, ...(reg ? { reg } : {}) });
    }
    if (!answers.length) {
      say(q, "no answer left — row not written");
      continue;
    }
    const x = (e.x ?? []).map(normalizeHanzi).filter((w) => w && !answers.some((a) => a.w === w));
    if (!before.has(q)) before.set(q, (await lookup(q, "ru")).hits.slice(0, 4).map((h) => h.word).join(" "));
    rows.set(q, { q, ...(keys.length > 1 || keys[0] !== q ? { k: keys } : {}), a: answers, ...(x.length ? { x } : {}) });
    edits++;
  }
}

// The change list, to read before writing.
for (const [q, was] of before) {
  const r = rows.get(q)!;
  const now = r.a.map((a) => `${a.w}«${a.m}»${a.si !== undefined ? `s${a.si}` : ""}${a.reg ? `(${a.reg})` : ""}`).join(" ");
  console.log(`${q}${r.k ? ` [${r.k.join(", ")}]` : ""}: ${was || "∅"} → ${now}${r.x ? ` · hidden ${r.x.join(" ")}` : ""}`);
}
console.log("\nnew everyday words:");
for (const w of words.values()) if (!wordFile.rows.some((r) => r.s === w.s)) console.log(`  ${w.s} «${w.m}» · ${w.p[0]} ${w.p[1]}`);
console.log(`\nsaid (${said.length}):`);
for (const s of said) console.log("  " + s);
console.log(`\n${batches.length} batches: ${edits} rows written, ${keeps} kept as the scorer has them, ${skips} skipped, ${rejected} edits rejected by the second editor; ${newWords} words off the list`);

if (WRITE) {
  const stamp = (m: Record<string, unknown>) => {
    const meta = m._meta as { reviewed?: string[] };
    return {
      _meta: {
        ...meta,
        built: new Date().toISOString(),
        ...(PART ? { reviewed: [...(meta.reviewed ?? []), `${new Date().toISOString().slice(0, 10)}: ${PART}`] } : {}),
      },
    };
  };
  const sortedRows = [...rows.values()].sort((a, b) => a.q.localeCompare(b.q, "ru"));
  save("ru-zh.jsonl", { _meta: { ...stamp(tableFile.meta)._meta, rows: sortedRows.length } }, sortedRows);
  const sortedWords = [...words.values()].sort((a, b) => a.s.localeCompare(b.s, "zh"));
  save("everyday-ru.jsonl", stamp(wordFile.meta), sortedWords);
  console.log(`wrote data/ru-zh.jsonl (${sortedRows.length}) and data/everyday-ru.jsonl (${sortedWords.length})`);
}
