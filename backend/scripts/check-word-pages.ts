// Proves the HSK word pages are right and served with no model call (BACKLOG
// "HSK word pages, written once"). Three parts, each run when it can be:
//
//   1. The rules themselves, on a page written by hand for 还 and on broken copies
//      of it — no data, no database. A rule that stops catching what it names fails
//      here first.
//   2. The shipped file (data/hsk-pages.jsonl), read back through the same rules the
//      build used: no page may carry a hard problem. The soft notes, the words whose
//      one-line meaning (hsk-ru) leads with another sense than the page, and the
//      situation tags are counted.
//   3. Serving, against a DEV database: a fresh HSK card's Meanings and family come
//      back at once with the model switched off (its address points nowhere, so a
//      call would throw), the word's own fetch carries them for the first paint,
//      a hand pick sticks, and a card in another language still asks the model.
//
//   cd backend && npx tsx scripts/check-word-pages.ts
//   --sample out.txt   also write the hand-read set: every page with notes, the 500
//                      most polysemous common words, and 200 at random
//
// The model is switched off before anything loads the environment: dotenv never
// overrides a variable that is already set.
process.env.BAILIAN_BASE_URL = "http://127.0.0.1:9/v1";
process.env.BAILIAN_API_KEY = "switched-off-by-check-word-pages";

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { readsAs, readingInPhrase, hskPage, hskSituations, headGloss, SITUATIONS } = await import("../src/services/wordPages.js");
const { pageInventory, pageProblems, pageOf, draftOf, problemText } = await import("./word-pages-rules.js");
const { HSK_VERSIONS, HSK_MAX_LEVEL, hskLevelWords, hskFrequency, hskTagFor } = await import("../src/services/hsk.js");
const { defaultMeaning } = await import("../src/services/lookup.js");
const { minLevel } = await import("../src/services/sentences.js");
const { prisma } = await import("../src/services/db.js");
type Draft = import("./word-pages-rules.js").Draft;
type ListWord = import("./word-pages-rules.js").ListWord;
type WordPage = import("../src/services/wordPages.js").WordPage;

const argOf = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const SAMPLE_OUT = argOf("--sample");

let failed = 0;
function check(what: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

// --- 1. The rules ---

console.log("\n1. The rules");
check("一下 yí xià is yi1 xia4 (一 changes its tone)", readsAs("一下", "yí xià", "yi1 xia4"));
check("你好 ní hǎo is ni3 hao3 (a third tone before another)", readsAs("你好", "ní hǎo", "ni3 hao3"));
check("好处 hǎo chu is hao3 chu4 (a neutral tone inside a longer word)", readsAs("好处", "hǎo chu", "hao3 chu4"));
check("哪儿 nǎr is na3 r5", readsAs("哪儿", "nǎr", "na3 r5"));
check("得 de is de5", readsAs("得", "de", "de5"));
check("得 dé is not de5 (on its own a neutral tone is another word)", !readsAs("得", "dé", "de5"));
check("还 huán is not hai2", !readsAs("还", "huán", "hai2"));
check("为 wéi is not wei4", !readsAs("为", "wéi", "wei4"));
const inPhrase = readingInPhrase("一点", "差一点儿", "chà yì diǎnr");
check("一点 inside 差一点儿 reads yi1 dian3", inPhrase !== null && readsAs("一点", inPhrase, "yi1 dian3"), String(inPhrase));
check("a joined reading doesn't line up", readingInPhrase("还", "还没来", "háiméilái") === null);

const he = pageInventory("和");
check("和's \"and\" is not rare for its Taiwan pronunciation note", Boolean(he?.some((g) => /\band\b/.test(g.text) && !g.rare)));
const hai: ListWord ={ word: "还", pinyin: "hái", level: 1, meaning: "ещё; возвращать, платить" };
const inv = pageInventory("还");
check("还's inventory has both readings, no surname", Boolean(inv && inv.some((g) => g.reading === "hái") && inv.some((g) => g.reading === "huán") && !inv.some((g) => /surname/.test(g.text))));
const n = (reading: string, text: string) => inv!.find((g) => g.reading === reading && g.text === text)!.n;
const good: Draft = {
  pos: "наречие",
  senses: [
    {
      refs: [n("hái", "still"), n("hái", "yet")],
      pos: "наречие",
      meaning: "ещё, всё ещё",
      phrases: [
        { text: "还没来", reading: "hái méi lái", translation: "ещё не пришёл" },
        { text: "还在下雨", reading: "hái zài xià yǔ", translation: "всё ещё идёт дождь" },
      ],
    },
    {
      refs: [n("hái", "fairly"), n("hái", "passably (good)")],
      pos: "наречие",
      meaning: "довольно, вполне",
      phrases: [
        { text: "还不错", reading: "hái bú cuò", translation: "довольно неплохо" },
        { text: "还可以", reading: "hái kě yǐ", translation: "сойдёт" },
      ],
    },
    {
      refs: [n("huán", "to pay back"), n("huán", "to return")],
      pos: "глагол",
      meaning: "возвращать, платить",
      phrases: [
        { text: "还书", reading: "huán shū", translation: "вернуть книгу" },
        { text: "还钱", reading: "huán qián", translation: "отдать деньги" },
      ],
    },
  ],
  synonyms: ["仍然", "依然"],
  antonyms: ["借"],
};
const hardOf = (d: Draft) => pageProblems(hai, d, inv!).filter((p) => p.hard);
check("a right page for 还 has no hard problem", hardOf(good).length === 0, problemText(hardOf(good)));
const broken = (what: string, change: (d: Draft) => void, expect: RegExp, hard = true) => {
  const d: Draft = structuredClone(good);
  change(d);
  const ps = pageProblems(hai, d, inv!).filter((p) => p.hard === hard);
  check(`caught: ${what}`, ps.some((p) => expect.test(p.note)), problemText(ps) || "nothing flagged");
};
broken("还书 read hái under the huán sense", (d) => (d.senses[2].phrases[0].reading = "hái shū"), /is read huán/);
broken("a sense citing a gloss that isn't there", (d) => (d.senses[0].refs = [99]), /not in the inventory/);
broken("a sense spanning both readings", (d) => (d.senses[0].refs = [n("hái", "still"), n("huán", "to return")]), /different readings/);
broken("a phrase without the word", (d) => (d.senses[2].phrases[0].text = "借书"), /must contain/);
broken("pinyin not one syllable per character", (d) => (d.senses[0].phrases[0].reading = "háiméilái"), /one pinyin syllable/);
broken("a meaning in English", (d) => (d.senses[1].meaning = "fairly"), /must be Russian/);
broken("the card's «возвращать» missing from the page", (d) => d.senses.splice(2, 1), /the card says "возвращать/, false);
broken("the word alone as a phrase", (d) => (d.senses[0].phrases[0] = { text: "还", reading: "hái", translation: "ещё" }), /not the word alone/);
broken("two senses citing one gloss", (d) => (d.senses[1].refs = [n("hái", "still")]), /same gloss as sense 1/, false);
broken("a part of speech that isn't one", (d) => (d.pos = "одеяло"), /is not a part of speech/, false);
broken("English left in the Russian", (d) => (d.senses[0].meaning = "ещё, всё ещё, still"), /English in it \(still\)/, false);
check("…but not a name or an acronym", !pageProblems(hai, { ...good, senses: [{ ...good.senses[0], meaning: "ещё (Apple, SMS)" }, ...good.senses.slice(1)] }, inv!).some((p) => /English/.test(p.note)));
broken("one phrase under two senses", (d) => (d.senses[1].phrases[0] = { ...d.senses[0].phrases[0] }), /already under sense 1/, false);
check("还书 is a collocation, not flagged as inside a longer word", !pageProblems(hai, good, inv!).length, problemText(pageProblems(hai, good, inv!)));
const pruned = (() => {
  const d: Draft = structuredClone(good);
  d.senses[2].phrases[0].reading = "hái shū";
  return pageOf(hai, d, inv!);
})();
check(
  "the page keeps the sense and drops only the wrong phrase",
  pruned?.s.length === 3 && pruned.s[2].p.length === 1 && pruned.s[2].p[0].t === "还钱" && Boolean(pruned.f?.some((f) => /2 phrases/.test(f))),
  JSON.stringify(pruned?.s[2]),
);

// --- 2. The shipped file ---

console.log("\n2. The shipped pages");
const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
const pagesFile = `${dataDir}hsk-pages.jsonl`;
const rows = existsSync(pagesFile)
  ? readFileSync(pagesFile, "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
  : [];
const pages: WordPage[] = rows.filter((r) => r.w);
// The levels the file covers (HSK 1–6 shipped first; 7 = HSK 7–9).
const maxLevel: number = rows.find((r) => r._meta)?._meta.maxLevel ?? 7;
// Keyed as the build keys them: an 儿 word under its base unless the base is a list word.
const listWords = new Map<string, ListWord>();
for (const v of HSK_VERSIONS)
  for (let lv = 1; lv <= HSK_MAX_LEVEL[v]; lv++)
    for (const e of hskLevelWords(v, lv)) {
      const erhua = e.word.length > 1 && e.word.endsWith("儿") && !hskTagFor(e.word.slice(0, -1));
      const word = erhua ? e.word.slice(0, -1) : e.word;
      if (!listWords.has(word))
        listWords.set(word, { word, pinyin: erhua ? e.pinyin.replace(/\s*r$/, "") : e.pinyin, level: minLevel(e.word) ?? 7, meaning: defaultMeaning(word, "ru") ?? "" });
    }
const withInventory = [...listWords.values()].filter((w) => w.level <= maxLevel && pageInventory(w.word)).length;
if (!pages.length) {
  console.log("     no data/hsk-pages.jsonl yet — build it: npx tsx scripts/build-hsk-pages.ts");
} else {
  let hard = 0;
  let soft = 0;
  const hardSeen: string[] = [];
  const wrongFirst: string[] = [];
  for (const page of pages) {
    const w = listWords.get(page.w);
    const pinv = pageInventory(page.w);
    if (!w || !pinv) {
      hard++;
      hardSeen.push(`${page.w}: not a list word in CC-CEDICT`);
      continue;
    }
    const ps = pageProblems(w, draftOf(page), pinv);
    const h = ps.filter((p) => p.hard);
    hard += h.length;
    soft += ps.length - h.length;
    if (h.length) hardSeen.push(`${page.w}: ${problemText(h)}`);
    const first = headGloss(w.meaning.split(/[;；]/)[0] ?? "");
    if (first && page.s[0] && headGloss(page.s[0].m) !== first && page.s.some((s) => headGloss(s.m) === first))
      wrongFirst.push(`${page.w} «${w.meaning}» → ${page.s[0].m}`);
  }
  // The build finishes the file with up to 25 words still missing; the rest are off CC-CEDICT.
  const covered = pages.filter((p) => (listWords.get(p.w)?.level ?? 99) <= maxLevel).length;
  check(`${covered}/${withInventory} list words up to HSK ${maxLevel < 7 ? maxLevel : "7–9"} in CC-CEDICT have a page`, covered >= withInventory - 25);
  check("no shipped page carries a hard problem", hard === 0, hardSeen.slice(0, 5).join(" | "));
  const senses = pages.reduce((a, p) => a + p.s.length, 0);
  console.log(`     ${senses} senses (${(senses / pages.length).toFixed(2)} a word); ${soft} soft notes on ${pages.filter((p) => p.f?.length).length} pages`);
  console.log(`     ${wrongFirst.length} cards whose one-line meaning leads with a rarer sense than the page, e.g.:`);
  for (const x of wrongFirst.slice(0, 15)) console.log(`       ${x}`);

  const tagFile = `${dataDir}hsk-situations.jsonl`;
  if (existsSync(tagFile)) {
    const known = new Set(Object.keys(SITUATIONS));
    const rows = readFileSync(tagFile, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((r) => r.w);
    check("every situation tag is on the list, at most two", rows.every((r) => r.s.length <= 2 && r.s.every((t: string) => known.has(t))));
    check("护照 is an airport word", hskSituations("护照").includes("airport"), hskSituations("护照").join(",") || "none");
    const none = rows.filter((r) => !r.s.length).length;
    console.log(`     ${rows.length} words tagged, ${none} (${Math.round((none / rows.length) * 100)}%) with no situation`);
  } else console.log("     no data/hsk-situations.jsonl yet — build it: npx tsx scripts/build-hsk-situations.ts");

  if (SAMPLE_OUT) {
    const byW = new Map(pages.map((p) => [p.w, p]));
    const polysemous = pages
      .filter((p) => (pageInventory(p.w)?.length ?? 0) >= 5 || new Set(p.s.map((s) => s.r)).size > 1)
      .sort((a, b) => hskFrequency(b.w) - hskFrequency(a.w))
      .slice(0, 500);
    let seed = 20260927;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    const random = [...pages].sort(() => rand() - 0.5).slice(0, 200);
    const flagged = pages.filter((p) => p.f?.length);
    const show = (p: WordPage) =>
      [
        `${p.w} ${listWords.get(p.w)?.pinyin ?? ""} · card: ${listWords.get(p.w)?.meaning ?? ""} · ${p.pos} · syn ${p.syn.join(" ") || "—"} · ant ${p.ant.join(" ") || "—"}`,
        ...p.s.map((s, i) => `  ${i + 1}. [${s.r}] ${s.pos} — ${s.m} :: ${s.p.map((x) => `${x.t} ${x.r} (${x.ru})`).join(" / ")}`),
        ...(p.f ?? []).map((f) => `  ! ${f}`),
      ].join("\n");
    const part = (title: string, list: WordPage[]) => `## ${title} (${list.length})\n\n${list.map(show).join("\n\n")}`;
    writeFileSync(
      SAMPLE_OUT,
      [part("Kept with notes", flagged), part("The 500 most polysemous common words", polysemous), part("200 at random", random)].join("\n\n\n") + "\n",
    );
    console.log(`     wrote the hand-read set to ${SAMPLE_OUT} (${new Set([...flagged, ...polysemous, ...random].map((p) => byW.get(p.w)?.w)).size} words)`);
  }
}

// --- 3. Serving ---

console.log("\n3. Serving");
if (!hskPage("还", "ru")) {
  console.log("     skipped: no page for 还 yet");
} else {
  const { wordSenses, wordFamily, getWord, updateWord } = await import("../src/services/vocab.js");
  const { deleteAccount } = await import("../src/services/accountData.js");
  const TG = `test-word-pages-${Date.now()}`;
  const user = await prisma.user.create({ data: { telegramId: TG, firstName: "Pages", nativeLang: "ru" } });
  try {
    const page = hskPage("还", "ru")!;
    const card = await prisma.word.create({
      data: { userId: user.id, word: "还", phonetic: "hái", sourceLang: "zh", targetLang: "ru", meaningZh: defaultMeaning("还", "ru") },
    });
    const t0 = performance.now();
    const got = await wordSenses(card.id);
    const ms = performance.now() - t0;
    check("a fresh HSK card's Meanings come back with the model off", got.senses.length === page.s.length && got.grounded);
    check("…in well under a model call", ms < 150, `${ms.toFixed(1)} ms`);
    check("…with the card's own meaning ticked", got.senses.some((s) => s.onCard), got.senses.map((s) => `${s.onCard ? "✓" : " "} ${s.meaning}`).join(" | "));
    const other = got.senses.find((s) => s.reading);
    check("…and a sense under another reading labelled", !page.s.some((s) => s.r && !readsAs("还", s.r, "hái")) || other?.reading === "huán", other?.reading ?? "none");
    const fetched = await getWord(card.id);
    check("the word's own fetch carries them, for the first paint", JSON.stringify(fetched?.sensesNow?.senses) === JSON.stringify(got.senses) && Boolean(fetched?.sensesNow?.credit));
    const fam = await wordFamily(card.id);
    check("its word family too, with the model off", JSON.stringify(fam) === JSON.stringify({ synonyms: page.syn, antonyms: page.ant }), JSON.stringify(fam));
    const last = got.senses.length - 1;
    await updateWord(card.id, { meaningZh: got.senses[last].meaning, senseIndexes: [last] });
    const after = await wordSenses(card.id);
    check("a hand pick on the page's list sticks", after.senses.map((s) => s.onCard).join() === got.senses.map((_, i) => i === last).join(), after.senses.map((s) => (s.onCard ? "✓" : "·")).join(""));
    const en = await prisma.word.create({
      data: { userId: user.id, word: "还", phonetic: "hái", sourceLang: "zh", targetLang: "en", meaningZh: "still" },
    });
    const asked = await wordSenses(en.id).then(
      () => false,
      () => true,
    );
    check("a card in English still asks the model (it has no page)", asked);
  } finally {
    await deleteAccount(TG);
  }
}

await prisma.$disconnect();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
