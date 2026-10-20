// Local-only Part 7 regression. Run from backend: npx tsx scripts/check-reader-vocabulary.ts
import assert from "node:assert/strict";
import { readerCoverage, readerVocabulary, hskRange } from "../../frontend/lib/readerVocabulary.js";

process.env.DATABASE_URL ??= "postgresql://vocab:vocab@localhost:5433/vocab?schema=public";
assert(["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname), "Local database only");
process.env.BAILIAN_API_KEY = "local-fixture";
process.env.BAILIAN_BASE_URL = "http://127.0.0.1:9/v1";
const { prisma } = await import("../src/services/db.js");
const { segmentChinese } = await import("../src/services/segment.js");
const { hskTagFor, hskLevelWords } = await import("../src/services/hsk.js");
const { createText, getText, updateText, listTexts, startGeneration } = await import("../src/services/readerText.js");
const tagged = (text: string) => segmentChinese(text).map(t => ({ ...t, hsk: hskTagFor(t.text) ?? undefined }));
const analyze = (text: string, version: "2.0" | "3.0" = "3.0") => readerVocabulary(tagged(text), version);
const stable = (level: number, version: "2.0" | "3.0" = "3.0") => hskLevelWords(version, level)
  .filter(w => { const ts = tagged(w.word); return ts.length === 1 && ts[0].text === w.word; });
const low = "我", advanced = stable(7)[0].word, four = stable(4)[0].word;
assert.equal(hskTagFor(low)?.["3.0"], 1);

// The screenshot's 76 / 62 counts can coexist with HSK 3: these are distinct
// new keys, while the vocabulary estimate weights all listed occurrences.
const lower = [...stable(1).slice(0, 20), ...stable(2).slice(0, 20), ...stable(3).slice(0, 22)].map(w => w.word);
const upper = stable(5).slice(0, 14).map(w => w.word);
const example = [...lower, ...upper, ...Array(8).fill(lower).flat()].join("，");
const coverage = readerCoverage(tagged(example), "3.0", 4, new Map(), new Set(), new Set());
assert.equal(coverage.newKeys.size, 76);
assert.equal(coverage.newForTarget, 62);
assert.equal(analyze(example).level, 3, "76 new / 62 up to target does not imply HSK 4");
const heavy = [...Array(40).fill(four), low].join("，");
assert.equal(analyze(heavy).level, 4, "HSK-4-heavy vocabulary");
assert.equal(analyze([...Array(19).fill(low), advanced].join("，")).level, 1, "exact 95% boundary");
assert.equal(analyze([...Array(18).fill(low), advanced, advanced].join("，")).level, 7, "below 95% includes 7–9");
assert.equal(analyze(`${low}，${low}，${low}`).listed, 3, "occurrences include repeats");
assert.equal(readerCoverage(tagged(`${low}，${low}`), "3.0", 4, new Map(), new Set(), new Set()).newKeys.size, 1);
const off = analyze("OnomikaZeta，OnomikaZeta，Xyzzy，123！");
assert.equal(off.level, null); assert.equal(off.listed, 0);
assert.equal(off.offList, 3); assert.equal(off.offListUnique, 2);
const names = analyze("乌兰巴托，乌兰巴托");
assert.equal(names.level, null); assert.equal(names.listed, 0);
assert.equal(names.offList, 4); assert.equal(names.offListUnique, 2); // ICU: 乌兰 / 巴托, twice
const mixed = analyze(`${low}，OnomikaZeta，OnomikaZeta`);
assert.equal(mixed.level, 1); assert.equal(mixed.offList, 2);
const long = `${`${low}，`.repeat(800)}${`${four}，`.repeat(100)}`;
assert(long.indexOf(four) > 1500);
assert.equal(analyze(long).level, 4, "analyze material after character 1500");
const both = stable(1).find(w => w.levels["2.0"] && w.levels["2.0"] !== 1)!;
assert(both);
assert.equal(analyze(both.word, "3.0").level, 1);
assert.equal(analyze(both.word, "2.0").level, both.levels["2.0"]);
assert.equal(hskRange(7), "1–9"); assert.equal(hskRange(4), "1–4");
const savedKey = lower[0], addedKey = lower[1];
const filtered = readerCoverage(tagged(example), "3.0", 4, new Map([[savedKey, "card"]]), new Set([savedKey]), new Set([addedKey]));
assert.equal(filtered.newKeys.size, 74); assert.equal(filtered.newForTarget, 60);
console.log("PASS: 76/62 reconstruction, HSK-4-heavy, exact 95%, repeats, off-list, full text, list versions, <=target");

const tg = `test-reader-vocabulary-${Date.now()}`;
const copyTg = `${tg}-copy`;
const realFetch = globalThis.fetch;
let calls = 0;
let answer: object = { title: "fixture", content: heavy };
globalThis.fetch = async (input) => {
  assert(String(input instanceof Request ? input.url : input).startsWith("http://127.0.0.1:9/"), "No external model requests");
  calls++;
  return new Response(JSON.stringify({ id: "fixture", object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: JSON.stringify(answer) }, finish_reason: "stop" }], usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }), { headers: { "Content-Type": "application/json" } });
};
try {
  const user = await prisma.user.create({ data: { telegramId: tg, firstName: "Part 7" } });
  const pair = { sourceLang: "zh", targetLang: "ru" };
  const auto = await createText(tg, { ...pair, title: "", content: example, autosave: true, estimateLevel: true });
  assert.equal(auto.level, null); assert.equal(calls, 0, "Chinese autosave makes no model call");
  const manual = await createText(tg, { ...pair, title: "Manual", content: heavy, level: "6", estimateLevel: true });
  assert.equal(manual.level, "HSK 6"); assert.equal(manual.levelSource, "manual");
  await updateText(tg, manual.id, { title: "Renamed", collection: "Part 7" });
  const reopen = await getText(tg, manual.id);
  assert.equal(reopen?.level, "HSK 6"); assert.equal(reopen?.content, heavy); assert.equal(reopen?.levelSource, "manual");
  assert.equal(analyze(reopen!.content).level, 4, "manual label differs from fresh analysis");
  const same = await createText(tg, { ...pair, title: "", content: heavy, autosave: true, estimateLevel: true, level: "2" });
  assert.equal(same.id, manual.id); assert.equal(same.level, "HSK 6");
  const legacy = await prisma.readerText.create({ data: { userId: user.id, title: "Legacy", content: long, level: "HSK 2", ...pair } });
  await updateText(tg, legacy.id, { title: "Legacy renamed" });
  const old = await getText(tg, legacy.id);
  assert.equal(old?.level, "HSK 2"); assert.equal(old?.levelSource, null); assert.equal(old?.content, long);
  assert.equal(analyze(old!.content).level, 4);
  assert.equal((await listTexts(tg)).find(r => r.id === legacy.id)?.levelSource, null);
  assert.equal(calls, 0);
  for (const requested of ["4", undefined]) {
    const generated = await startGeneration(tg, { ...pair, topic: "fixture", level: requested });
    let full = await getText(tg, generated.id);
    for (let i = 0; i < 100 && full?.status === "generating"; i++) {
      await new Promise(resolve => setTimeout(resolve, 30)); full = await getText(tg, generated.id);
    }
    assert.equal(full?.status, "ready"); assert.equal(full?.content, heavy);
    assert.equal(full?.levelSource, requested ? "requested" : null);
    assert.equal(full?.level, requested ? "HSK 4" : null);
  }
  assert.equal(calls, 2, "only generation calls; no Chinese level calls");
  answer = { level: "B2" };
  const cefr = await createText(tg, { title: "English", content: "Some English text.", sourceLang: "en", estimateLevel: true });
  assert.equal(cefr.level, "B2"); assert.equal(calls, 3, "other-language CEFR behavior preserved");
  const { exportAccount, importAccount } = await import("../src/services/accountData.js");
  const exported = await exportAccount(tg);
  await prisma.user.create({ data: { telegramId: copyTg, firstName: "Part 7 copy" } });
  await importAccount(copyTg, JSON.parse(JSON.stringify(exported)));
  const copied = await listTexts(copyTg);
  assert.equal(copied.find(r => r.title === "Renamed")?.levelSource, "manual");
  assert.equal(copied.find(r => r.title === "Legacy renamed")?.levelSource, null);
  assert.equal(copied.filter(r => r.levelSource === "requested").length, 1);
  console.log("PASS: manual/legacy preservation, autosave dedupe, saved reopen, requested generation, zero Chinese level calls, CEFR unchanged, export/import");
} finally {
  globalThis.fetch = realFetch;
  await prisma.user.deleteMany({ where: { telegramId: { in: [tg, copyTg] } } });
  await prisma.$disconnect();
}
