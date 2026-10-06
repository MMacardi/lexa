// The review of the HSK 1–6 data (2026-09-29): what the Qwen passes left behind, read
// again with no Qwen budget to spend. Two parts, both written into the shipped files:
//   - mechanical, over the whole of each file: ‘single quotes’ in the Chinese made
//     “”, Chinese punctuation in the Russian made Russian (…университета。), a word's
//     sentence listed twice kept once;
//   - the read: every meaning, page and sentence of the HSK 1–6 words read by one
//     editor and each fix checked by a second, independent one (Claude, both); only
//     what both kept is in the fixes directory, one JSON array per batch of 40 words.
// A sentence whose Chinese changed keeps the old one on its row ("o"), so a card that
// carries it gets the pool's pick on open (services/sentences.ts, refreshPoolExample);
// one whose Russian alone changed is the same sentence, and a card takes the new
// translation on open. A card meaning that changed keeps the old one too ("o", hsk-ru),
// moved on open (services/lookup.ts). Page senses keep their order; a page is read
// from the file, so its edits need nothing more. Every new sentence passes the build's
// checks (the headword a word of its own, 5–32 characters, Russian that is Russian)
// and is labelled with the ceiling it really keeps; one that fails is skipped, said.
//   cd backend && npx tsx scripts/apply-hsk-review.ts --fixes DIR        print what would change
//   cd backend && npx tsx scripts/apply-hsk-review.ts --fixes DIR --write and write the files
//   --mechanical   the mechanical part too (on its own without --fixes); once only
//   --part "…"     what this wave covered, kept in the files' _meta.reviewed
//   --order DIR    a page whose card (as the editors left it) leads with another of its
//                  senses moves that sense first — for the words DIR's fixes touched
// Apply a fixes file once: sentence fixes point at positions, which move.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { overCeiling, sentenceWords } = await import("../src/services/sentences.js");
const { POS } = await import("./word-pages-rules.js");
const { headGloss } = await import("../src/services/wordPages.js");
const { hskReading } = await import("../src/services/hsk.js");
type Ceiling = import("../src/services/sentences.js").Ceiling;

const argOf = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const WRITE = process.argv.includes("--write");
const MECHANICAL = process.argv.includes("--mechanical");
const FIXES = argOf("--fixes");
const ORDER = argOf("--order");

const file = (name: string) => fileURLToPath(new URL(`../data/${name}`, import.meta.url));
type Sentence = { c: Ceiling; zh: string; ru: string; t: string };
type SentRow = { w: string; s: Sentence[]; o?: string[]; [k: string]: unknown };
type RuRow = { s: string; p: string; m: string; o?: string[] };
type Phrase = { t: string; r: string; ru: string };
type PageRow = { w: string; s: { r: string; pos: string; m: string; g?: number[]; p?: Phrase[] }[]; syn: string[]; ant: string[] };

function load<T>(name: string): { meta: Record<string, unknown>; rows: T[] } {
  const lines = readFileSync(file(name), "utf8").split("\n").filter((l) => l.trim());
  return { meta: JSON.parse(lines[0]), rows: lines.slice(1).map((l) => JSON.parse(l) as T) };
}
const save = (name: string, meta: Record<string, unknown>, rows: unknown[]) =>
  writeFileSync(file(name), [meta, ...rows].map((r) => JSON.stringify(r)).join("\n") + "\n");

const sentFile = load<SentRow>("hsk-sentences.jsonl");
const ruFile = load<RuRow>("hsk-ru.jsonl");
const pageFile = load<PageRow>("hsk-pages.jsonl");
const sentBy = new Map(sentFile.rows.map((r) => [r.w, r]));
const ruBy = new Map(ruFile.rows.map((r) => [r.s, r]));
const pageBy = new Map(pageFile.rows.map((r) => [r.w, r]));

const count: Record<string, number> = {};
const yo = (s: string) => s.trim().toLowerCase().replace(/ё/g, "е");
const knownPos = (s: string) => s.split("/").every((p) => POS.some((q: string) => yo(q) === yo(p)));
// A meaning is Russian only: a flashcard that says «предлог 把» gives its answer away.
const hasHan = (s: string) => /\p{Script=Han}/u.test(s);
const bump = (k: string) => (count[k] = (count[k] ?? 0) + 1);
const skipped: string[] = [];
const shown: string[] = [];
const show = (s: string) => shown.push(s);

const retire = (row: SentRow, zh: string) => {
  row.o ??= [];
  if (!row.o.includes(zh)) row.o.push(zh);
};
const withT = (w: string, zh: string, ru: string): Sentence => {
  const rest = sentenceWords(zh, w).words;
  const c = ([1, 2] as Ceiling[]).find((x) => !overCeiling(rest, x, w).length) ?? 3;
  return { c, zh, ru, t: rest.join(" ") };
};
/** The build's checks for a new sentence, as the reasons it fails; [] when it passes. */
function problems(w: string, zh: string, ru: string, others: Sentence[]): string[] {
  const out: string[] = [];
  if (!zh.includes(w)) out.push("no headword");
  else if (!sentenceWords(zh, w).own) out.push("headword inside a longer word");
  const han = Array.from(zh).filter((ch) => /\p{Script=Han}/u.test(ch)).length;
  if (han < 5 || han > 32) out.push(`${han} characters`);
  if (!/[。？！…”]$/.test(zh)) out.push("no final punctuation");
  if (!/\p{Script=Cyrillic}/u.test(ru) || /\p{Script=Han}/u.test(ru)) out.push("Russian not Russian");
  if (/[A-Za-z]{3,}/.test(ru.replace(/WeChat|iPhone|Apple|GDP|QR|Wi-?Fi|App|CEO|DVD|CD|SMS|email|USB|NBA|KTV|MBA|IT|PPT|HSK/g, "")))
    out.push("Latin in the Russian");
  if (others.some((s) => s.zh === zh)) out.push("same as another");
  return out;
}

// --- Mechanical ---

const RU_PUNCT: [RegExp, string][] = [
  [/。/g, "."], [/，/g, ", "], [/；/g, "; "], [/：/g, ": "], [/？/g, "?"], [/！/g, "!"],
  [/“/g, "«"], [/”/g, "»"], [/（/g, " ("], [/）/g, ") "], [/、/g, ", "],
];
const ruClean = (ru: string) => {
  let out = ru;
  for (const [re, to] of RU_PUNCT) out = out.replace(re, to);
  return out.replace(/\s+([.,;:?!)»])/g, "$1").replace(/\(\s+/g, "(").replace(/\s{2,}/g, " ").trim();
};

if (MECHANICAL) {
  for (const row of sentFile.rows) {
    const kept: Sentence[] = [];
    for (const s of row.s) {
      if (/[‘’]/.test(s.zh)) {
        const zh = s.zh.replace(/‘/g, "“").replace(/’/g, "”");
        retire(row, s.zh);
        show(`quotes  ${row.w}: ${s.zh} → ${zh}`);
        Object.assign(s, withT(row.w, zh, s.ru));
        bump("mech: Chinese quotes");
      }
      if (/[。，；：？！“”（）、]/.test(s.ru)) {
        const ru = ruClean(s.ru);
        show(`ru punct  ${row.w}: ${s.ru} → ${ru}`);
        s.ru = ru;
        bump("mech: Russian punctuation");
      }
      if (kept.some((k) => k.zh === s.zh)) {
        show(`duplicate  ${row.w}: ${s.zh}`);
        bump("mech: duplicate dropped");
        continue;
      }
      kept.push(s);
    }
    row.s = kept;
  }
}

// --- The read ---

type Fix = {
  id: string; word: string; kind: string; si?: number; pi?: number; n?: number;
  new_m?: string; new_pos?: string; new_t?: string; new_r?: string; new_ru?: string; new_zh?: string;
  new_list?: string[]; new_g?: number[]; new_phrases?: Phrase[]; why: string; verdict?: string;
};
if (FIXES) {
  const fixes: (Fix & { batch: string })[] = [];
  for (const f of readdirSync(FIXES).filter((f) => f.endsWith(".json")).sort()) {
    const list = JSON.parse(readFileSync(`${FIXES}/${f}`, "utf8")) as Fix[];
    for (const x of Array.isArray(list) ? list : []) fixes.push({ ...x, batch: f });
  }
  // Sentences by index against the row as read, drops and adds after.
  const dropped = new Map<string, Set<number>>();
  const added = new Map<string, Sentence[]>();
  const pDropped = new Map<string, Set<string>>();
  const leads = new Map<string, number>();
  for (const x of fixes) {
    const tag = `${x.batch} ${x.id} ${x.kind} ${x.word}`;
    const skip = (why: string) => skipped.push(`${tag}: ${why}`);
    if (x.kind === "card_meaning") {
      const row = ruBy.get(x.word);
      const m = x.new_m?.trim();
      if (!row || !m) { skip("no row or no meaning"); continue; }
      if (hasHan(m)) { skip(`Chinese in the meaning: ${m}`); continue; }
      if (m === row.m) continue;
      show(`meaning  ${x.word}: ${row.m} → ${m}   (${x.why})`);
      row.o ??= [];
      if (!row.o.includes(row.m)) row.o.push(row.m);
      row.m = m;
      bump("card meaning");
    } else if (x.kind === "sense") {
      const s = pageBy.get(x.word)?.s[x.si ?? -1];
      if (!s) { skip("no such sense"); continue; }
      if (x.new_m && hasHan(x.new_m)) { skip(`Chinese in the meaning: ${x.new_m}`); continue; }
      if (x.new_pos?.trim() && !knownPos(x.new_pos)) { skip(`not a part of speech: ${x.new_pos}`); continue; }
      if (x.new_m?.trim() && x.new_m.trim() !== s.m) {
        show(`sense  ${x.word}#${x.si}: ${s.m} → ${x.new_m.trim()}   (${x.why})`);
        s.m = x.new_m.trim();
      }
      if (x.new_pos?.trim() && x.new_pos.trim() !== s.pos) {
        show(`pos  ${x.word}#${x.si}: ${s.pos} → ${x.new_pos.trim()}`);
        s.pos = x.new_pos.trim();
      }
      // A sense read another way (系 «завязывать» is jì), from the hand fixes — with the
      // glosses of that reading it cites ("g"), which the check reads its reading from.
      if (x.new_r?.trim() && x.new_r.trim() !== s.r) {
        show(`reading  ${x.word}#${x.si}: ${s.r} → ${x.new_r.trim()}${x.new_g?.length ? ` g ${x.new_g.join(",")}` : ""}`);
        s.r = x.new_r.trim();
        if (x.new_g?.length) s.g = x.new_g;
      }
      bump("page sense");
    } else if (x.kind === "sense_add") {
      // A sense under the reading the card shows, where the page had none (the list's reading pass).
      const page = pageBy.get(x.word);
      const m = x.new_m?.trim();
      const phrases = (x.new_phrases ?? []).filter((p) => p.t?.includes(x.word) && p.r?.trim() && p.ru?.trim());
      if (!page || !m || !x.new_r?.trim() || !x.new_g?.length) { skip("no page, meaning, reading or glosses"); continue; }
      if (hasHan(m)) { skip(`Chinese in the meaning: ${m}`); continue; }
      if (!knownPos(x.new_pos ?? "")) { skip(`not a part of speech: ${x.new_pos}`); continue; }
      if (phrases.length < 2) { skip("fewer than 2 phrases with the word"); continue; }
      show(`sense added  ${x.word}: [${x.new_r.trim()}] ${m} :: ${phrases.map((p) => `${p.t} ${p.r}`).join(" / ")}   (${x.why})`);
      page.s.push({ r: x.new_r.trim(), pos: x.new_pos!.trim(), m, g: x.new_g, p: phrases });
      bump("page sense added");
    } else if (x.kind === "sense_lead") {
      // The sense the card leads with goes first (after the adds: an added sense's index
      // follows the page's own). By index, where --order's head match can't tell two
      // senses opening alike apart (哦 ó / ò «о!»).
      if (!pageBy.get(x.word)) { skip("no page"); continue; }
      leads.set(x.word, x.si ?? -1);
    } else if (x.kind === "phrase") {
      const ph = pageBy.get(x.word)?.s[x.si ?? -1]?.p?.[x.pi ?? -1];
      if (!ph) { skip("no such phrase"); continue; }
      const next = { t: x.new_t?.trim() || ph.t, r: x.new_r?.trim() || ph.r, ru: x.new_ru?.trim() || ph.ru };
      if (!next.t.includes(x.word)) { skip(`phrase without the word: ${next.t}`); continue; }
      show(`phrase  ${x.word}: ${ph.t} ${ph.r} ${ph.ru} → ${next.t} ${next.r} ${next.ru}   (${x.why})`);
      Object.assign(ph, next);
      bump("page phrase");
    } else if (x.kind === "phrase_drop") {
      const ph = pageBy.get(x.word)?.s[x.si ?? -1]?.p?.[x.pi ?? -1];
      if (!ph) { skip("no such phrase"); continue; }
      show(`phrase dropped  ${x.word}: ${ph.t} ${ph.ru}   (${x.why})`);
      if (!pDropped.has(x.word)) pDropped.set(x.word, new Set());
      pDropped.get(x.word)!.add(`${x.si}:${x.pi}`);
      bump("page phrase dropped");
    } else if (x.kind === "syn" || x.kind === "ant") {
      const page = pageBy.get(x.word);
      if (!page || !Array.isArray(x.new_list)) { skip("no page or list"); continue; }
      show(`${x.kind}  ${x.word}: ${page[x.kind].join(" ")} → ${x.new_list.join(" ")}   (${x.why})`);
      page[x.kind] = x.new_list;
      bump(`page ${x.kind}`);
    } else if (x.kind === "sentence") {
      const row = sentBy.get(x.word);
      const s = row?.s[x.n ?? -1];
      if (!row || !s) { skip("no such sentence"); continue; }
      const zh = x.new_zh?.trim() || s.zh;
      const ru = x.new_ru?.trim() || s.ru;
      if (zh !== s.zh) {
        const ps = problems(x.word, zh, ru, row.s.filter((o) => o !== s));
        if (ps.length) { skip(`${zh}: ${ps.join("; ")}`); continue; }
        show(`sentence  ${x.word}: ${s.zh} ${s.ru} → ${zh} ${ru}   (${x.why})`);
        retire(row, s.zh);
        Object.assign(s, withT(x.word, zh, ru));
        bump("sentence rewritten");
      } else {
        const ps = problems(x.word, zh, ru, []);
        if (ps.includes("Russian not Russian") || ps.includes("Latin in the Russian")) { skip(`${ru}: ${ps.join("; ")}`); continue; }
        show(`translation  ${x.word}: ${s.zh} ${s.ru} → ${ru}   (${x.why})`);
        s.ru = ru;
        bump("sentence translation");
      }
    } else if (x.kind === "sentence_drop") {
      const row = sentBy.get(x.word);
      if (!row?.s[x.n ?? -1]) { skip("no such sentence"); continue; }
      show(`sentence dropped  ${x.word}: ${row.s[x.n!].zh}   (${x.why})`);
      if (!dropped.has(x.word)) dropped.set(x.word, new Set());
      dropped.get(x.word)!.add(x.n!);
    } else if (x.kind === "sentence_add") {
      const row = sentBy.get(x.word);
      const zh = x.new_zh?.trim() ?? "";
      const ru = x.new_ru?.trim() ?? "";
      // An erhua word (一下儿) has its base's row (services/sentences.ts, poolKey); one read
      // ér (婴儿, 孤儿) gets a row of its own.
      const erhua = x.word.length > 1 && x.word.endsWith("儿") && !/ér$/.test(hskReading(x.word) ?? "");
      if (!row && erhua && sentBy.has(x.word.slice(0, -1))) { skip(`erhua: the pool's ${x.word.slice(0, -1)} row serves it`); continue; }
      if (!row && !hskReading(x.word)) { skip("no pool row"); continue; }
      const ps = problems(x.word, zh, ru, [...(row?.s ?? []), ...(added.get(x.word) ?? [])]);
      if (ps.length) { skip(`${zh}: ${ps.join("; ")}`); continue; }
      show(`sentence added  ${x.word}: ${zh} ${ru}`);
      if (!added.has(x.word)) added.set(x.word, []);
      added.get(x.word)!.push(withT(x.word, zh, ru));
      bump("sentence added");
    } else skip("unknown kind");
  }
  for (const [w, ns] of dropped) {
    const row = sentBy.get(w)!;
    for (const n of ns) retire(row, row.s[n].zh);
    row.s = row.s.filter((_, i) => !ns.has(i));
    count["sentence dropped"] = (count["sentence dropped"] ?? 0) + ns.size;
  }
  for (const [w, list] of added) {
    if (!sentBy.has(w)) {
      const row: SentRow = { w, s: [] };
      sentFile.rows.push(row);
      sentBy.set(w, row);
      bump("pool row added");
    }
    sentBy.get(w)!.s.push(...list);
  }
  for (const [w, keys] of pDropped) {
    const page = pageBy.get(w)!;
    page.s.forEach((s, si) => (s.p = s.p?.filter((_, pi) => !keys.has(`${si}:${pi}`))));
  }
  for (const [w, i] of leads) {
    const page = pageBy.get(w)!;
    if (i <= 0 || i >= page.s.length) continue;
    show(`lead  ${w}: «${page.s[i].m}» before «${page.s[0].m}»${page.s[i].pos !== page.pos ? `, ${page.pos} → ${page.s[i].pos}` : ""}`);
    page.s = [page.s[i], ...page.s.filter((_, k) => k !== i)];
    // The page's part of speech is the card's, its first sense's (盛 «накладывать» a verb now).
    (page as PageRow & { pos?: string }).pos = page.s[0].pos;
    bump("page led by its card's sense");
  }
  for (const w of new Set([...dropped.keys(), ...added.keys()])) sentBy.get(w)!.s.sort((a, b) => a.c - b.c);
}

// --order DIR: the card meanings two editors read stand, and a page that leads with
// another sense moves the card's first one to the front (日 «день; …» over «солнце»),
// as reorder-hsk-ru.ts's TRUST_CARD did by hand. Only the words DIR's fixes touched.
if (ORDER) {
  const touched = new Set<string>();
  for (const f of readdirSync(ORDER).filter((f) => f.endsWith(".json")))
    for (const x of JSON.parse(readFileSync(`${ORDER}/${f}`, "utf8")) as { word: string }[]) touched.add(x.word);
  for (const w of touched) {
    const card = ruBy.get(w);
    const page = pageBy.get(w);
    if (!card || !page) continue;
    const first = headGloss(card.m.split(/[;；]/)[0] ?? "");
    const i = page.s.findIndex((s) => headGloss(s.m) === first);
    if (!first || i <= 0) continue;
    show(`order  ${w}: «${page.s[i].m}» before «${page.s[0].m}» (card «${card.m}»)`);
    page.s = [page.s[i], ...page.s.filter((_, k) => k !== i)];
    bump("page reordered to its card");
  }
}

for (const l of shown) console.log(l);
if (skipped.length) console.log(`\nskipped ${skipped.length}:\n  ${skipped.join("\n  ")}`);
console.log("\n", count);
const words = sentFile.rows.filter((r) => r.s.length).length;
const total = sentFile.rows.reduce((a, r) => a + r.s.length, 0);
console.log(`pool: ${total} sentences, ${sentFile.rows.length - words} words with none`);
if (WRITE) {
  // Applied in waves (the read is bigger than one session's budget): each run adds its
  // date, and a fixes file is applied once — sentence fixes point at positions.
  const wave = `${new Date().toISOString().slice(0, 10)}: ${argOf("--part") ?? "HSK 1–6 words"} read again by two independent editors (scripts/apply-hsk-review.ts)`;
  const meta = (m: Record<string, unknown>, more: Record<string, unknown>) => {
    const was = (m._meta as { reviewed?: string[] }).reviewed;
    return { _meta: { ...(m._meta as object), ...more, reviewed: [...(Array.isArray(was) ? was : []), wave] } };
  };
  save("hsk-sentences.jsonl", meta(sentFile.meta, { sentences: total }), sentFile.rows);
  save("hsk-ru.jsonl", meta(ruFile.meta, {}), ruFile.rows);
  save("hsk-pages.jsonl", meta(pageFile.meta, {}), pageFile.rows);
  console.log("written");
}
