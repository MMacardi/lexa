// Local only: real dictionary/add/detail/reload plus controlled enrichment races.
// docker compose exec -T backend npx tsx scripts/check-dictionary-meanings.ts [--live]
import assert from "node:assert/strict";
import { createServer } from "node:http";
const live = process.argv.includes("--live");
let arrived: (() => void) | undefined, release: (() => void) | undefined;
let calls = 0;
const server = live ? null : createServer(async (req, res) => {
  let raw = ""; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); calls++;
  const system = body.messages[0].content as string;
  if (arrived) { const mark = arrived; arrived = undefined; mark(); await new Promise<void>((r) => { release = r; }); }
  let content: unknown;
  if (system.includes("Translate and group ONLY")) {
    const inv = JSON.parse(body.messages[1].content);
    const meaning = inv.word === "照镜子" ? "смотреться в зеркало" : "съедобный моллюск";
    content = { senses: [{ reading: 0, glosses: [0], meaning, pos: "существительное" }] };
  } else if (system.includes('"items"')) {
    const items = JSON.parse(body.messages[1].content);
    content = { items: items.map((item: { senses: string[] }) => ({ n: item.senses.length === 1 ? 1 : 2 })) };
  }
  else content = { phonetic: "", partOfSpeech: "глагол", meaningZh: "реагировать, отвечать на запрос",
    collocations: [], synonyms: [], antonyms: [], example: "", exampleTranslation: "" };
  if (body.messages[1].content === "照镜子") content = { phonetic: "", partOfSpeech: "глагол", meaningZh: "глядеться в зеркало",
    collocations: [], synonyms: [], antonyms: [], example: "", exampleTranslation: "" };
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ id: "local-race", choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] }));
});
if (server) {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  process.env.BAILIAN_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
  process.env.BAILIAN_API_KEY = "local-test-only";
}
const { prisma } = await import("../src/services/db.js");
const { addWordForUser, addWordManual, getWord, updateWord, wordSenses } = await import("../src/services/vocab.js");
const { lookup, translateGlosses, cardMeaning } = await import("../src/services/lookup.js");
const { upgradeCard, fitMeaningsToPages } = await import("../src/services/capture.js");
const { cachedDictionary, localizedDictionary } = await import("../src/services/localizedDictionary.js");
const { cedictLookup } = await import("../src/services/cedict.js");
const { matchingSenseIndexes } = await import("../src/services/wordPages.js");
const { deleteAccount } = await import("../src/services/accountData.js");
const tg = `dictionary-check-${Date.now()}`;
const before = new Set((await prisma.dictionaryAdaptation.findMany({ select: { key: true } })).map((r) => r.key));
async function add(word: string, senseIndex?: number) {
  const card = await addWordForUser({ telegramId: tg, word, sourceLang: "zh", targetLang: "ru", exampleStyle: "none", senseIndex });
  await prisma.importJob.updateMany({ where: { user: { telegramId: tg } }, data: { status: "cancelled" } });
  return card;
}
function gate() {
  const started = new Promise<void>((r) => { arrived = r; });
  return { started, finish: () => { assert.ok(release); release(); release = undefined; } };
}
try {
  assert.deepEqual(matchingSenseIndexes(["внимательный, тщательный; внимательно"], "внимательно; тщательно!"), [0]);
  assert.deepEqual(matchingSenseIndexes(["спина", "нести на себе", "учить наизусть"], "учить наизусть!"), [2]);
  for (const word of ["仔细", "及时"]) {
    const row = (await lookup(word, "ru")).hits.find((h) => h.word === word)!;
    const card = await add(word);
    assert.equal(card.meaningZh, row.meaning);
    assert.ok((await wordSenses(card.id)).senses.some((s) => s.onCard), `${word}: tested sense`);
    await upgradeCard(card.id, { withExample: false });
    assert.equal((await getWord(card.id))?.meaningZh, row.meaning);
  }
  const picked = await add("背", 1);
  assert.equal(picked.phonetic, "bēi");
  await upgradeCard(picked.id, { withExample: false, sense: "нести" });
  assert.deepEqual((await wordSenses(picked.id)).senses.map((s) => s.onCard), [false, true, false]);
  assert.equal((await getWord(picked.id))?.meaningZh, picked.meaningZh);
  await updateWord(picked.id, { meaningZh: "спина", senseIndexes: [0] });
  assert.equal((await getWord(picked.id))?.phonetic, "bèi", "switch back to main reading");
  await updateWord(picked.id, { meaningZh: "нести на себе, таскать на спине", senseIndexes: [1] });
  assert.equal((await getWord(picked.id))?.phonetic, "bēi", "switch to alternate reading again");

  for (const word of ["照镜子", "蛤蜊"]) {
    assert.ok(cedictLookup(word, { count: false }));
    assert.equal(cardMeaning(word, "ru"), null, "off-list adaptation path");
    const card = await add(word);
    await upgradeCard(card.id, { withExample: false });
    const entry = await localizedDictionary(word, "ru");
    const afterFirst = calls;
    const gloss = (await translateGlosses([word], "ru"))[word];
    if (word === "照镜子") assert.match(gloss, /смотр|гляд/i, "mirror action retains its verb");
    assert.equal(gloss, entry?.meaning);
    assert.equal(calls, afterFirst, "shared cached adaptation");
    assert.equal((await cachedDictionary(word, "ru"))?.meaning, gloss);
    const row = (await lookup(word, "ru")).hits.find((h) => h.word === word)!;
    assert.equal(row.meaning, gloss); assert.equal(row.english, false);
    assert.equal((await getWord(card.id))?.meaningZh, gloss);
    const senses = await wordSenses(card.id);
    assert.ok(senses.grounded && senses.senses.some((s) => s.onCard));
    await upgradeCard(card.id, { withExample: false });
    assert.equal((await getWord(card.id))?.meaningZh, gloss);
    assert.equal((await getWord(card.id))?.partOfSpeech, entry?.senses.find((s) => s.onCard)?.pos, "card and dictionary use localized part of speech");
  }
  const en = (await lookup("照镜子", "en")).hits.find((h) => h.word === "照镜子")!;
  assert.equal(en.meaning, "to look in the mirror");
  if (live) {
    assert.equal(cedictLookup("拮据的", { count: false }), null);
    const gap = await add("拮据的");
    assert.ok(gap.meaningZh && /[а-яё]/i.test(gap.meaningZh));
    assert.equal((await wordSenses(gap.id)).grounded, false);
  } else {
    const offContext = await add("照镜子");
    await prisma.example.create({ data: { wordId: offContext.id, sentenceEn: "他在照镜子。", sentenceZh: "", sourceName: "Local test", sourceUrl: "", captured: true } });
    await upgradeCard(offContext.id, { withExample: false });
    assert.equal((await getWord(offContext.id))?.meaningZh, "глядеться в зеркало", "cached dictionary keeps contextual wording");
    assert.ok((await wordSenses(offContext.id)).senses.some((s) => s.onCard), "context maps to the shared off-list sense");
    // Meaning edit while contextual enrichment is already waiting on the model.
    const card = await add("响应");
    await prisma.example.create({ data: { wordId: card.id, sentenceEn: "服务器响应请求。", sentenceZh: "", sourceName: "Local test", sourceUrl: "", captured: true } });
    let hold = gate();
    const pending = upgradeCard(card.id, { withExample: false });
    await hold.started;
    await updateWord(card.id, { meaningZh: "Моё личное значение" });
    hold.finish(); await pending;
    assert.equal((await getWord(card.id))?.meaningZh, "Моё личное значение");
    await upgradeCard(card.id, { withExample: false });
    assert.equal((await getWord(card.id))?.meaningZh, "Моё личное значение");

    const context = await addWordManual({ telegramId: tg, word: "响应", sourceLang: "zh", targetLang: "ru", meaningZh: "ответ на запрос" });
    await fitMeaningsToPages([{ id: context.id, word: "响应", meaning: "ответ на запрос", sentence: "服务器响应请求。" }], "ru");
    assert.equal((await getWord(context.id))?.meaningZh, "ответ на запрос", "context wording preserved");
    assert.deepEqual((await wordSenses(context.id)).senses.map((s) => s.onCard), [false, true]);

    const racing = await addWordManual({ telegramId: tg, word: "响应", sourceLang: "zh", targetLang: "ru", meaningZh: "ответ на запрос" });
    hold = gate();
    const fitting = fitMeaningsToPages([{ id: racing.id, word: "响应", meaning: "ответ на запрос", sentence: "服务器响应请求。" }], "ru");
    await hold.started;
    await updateWord(racing.id, { meaningZh: "откликаться (на призыв)", senseIndexes: [0] });
    hold.finish(); await fitting;
    assert.deepEqual((await wordSenses(racing.id)).senses.map((s) => s.onCard), [true, false]);
    assert.equal((await getWord(racing.id))?.meaningZh, "откликаться (на призыв)");
  }
  console.log(`PASS ${live ? "live" : "controlled"}: lookup/add/enrich/detail/reload, off-list cache, polyphonic selection, ${live ? "dictionary gap" : "manual edit and sense races, contextual wording"}`);
} finally {
  await deleteAccount(tg);
  if (!live) await prisma.dictionaryAdaptation.deleteMany({ where: { key: { notIn: [...before] } } });
  await prisma.$disconnect();
  await new Promise<void>((r) => server ? server.close(() => r()) : r());
}
