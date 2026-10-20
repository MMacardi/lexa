// Local Postgres + a local model stub; no production data or paid model calls.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let fail = false;
let hold: (() => Promise<void>) | undefined;
const prompts: string[] = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", async () => {
    const messages = JSON.parse(body).messages as { role: string; content: string }[];
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const word = messages.find((m) => m.role === "user")?.content ?? "";
    prompts.push(system);
    const enrichment = system.includes("dictionary. For the given");
    if (enrichment && hold) await hold();
    res.setHeader("content-type", "application/json");
    if (fail && (enrichment || system.startsWith("Write ONE natural"))) {
      res.writeHead(400); res.end(JSON.stringify({ error: { message: "Injected local failure" } })); return;
    }
    const sentence = word === "背" ? "他把孩子背到医院以后，才发现自己忘了带手机。"
      : word === "餐补" ? "公司每个月都给员工发餐补，大家可以自己选择在哪里吃饭。"
      : "今天下雨，然而我们还是按计划去了学校。";
    const reply = system.includes("native Mandarin editor") ? { natural: true }
      : system.startsWith("Each item is a Chinese word") ? { items: [{ n: 0 }] }
      : system.includes('"items":[{"word"') ? { items: JSON.parse(word).map((c: { word: string }) => ({ word: c.word, meaning: "однако" })) }
      : system.startsWith("You write example sentences") ? { example: sentence, exampleTranslation: "Мы пошли в школу по плану." }
      : system.startsWith("Write ONE natural") ? { sentence, translation: "Мы пошли в школу по плану." }
      : enrichment ? { phonetic: "", partOfSpeech: "союз", meaningZh: word === "背" ? "нести на себе" : "однако", collocations: [], synonyms: [], antonyms: [], example: sentence, exampleTranslation: "Мы пошли в школу по плану." }
      : { translation: "А. Однако Б. Поэтому В. Кроме того" };
    res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.BAILIAN_API_KEY = "local-test";
process.env.BAILIAN_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
const { prisma } = await import("../src/services/db.js");
const { importWordsForUser } = await import("../src/services/importWords.js");
const { processImportJob } = await import("../src/services/importWorker.js");
const { queueCardUpgrade } = await import("../src/services/cardJobs.js");
const { removeExample, saveGeneratedExample } = await import("../src/services/exampleWrites.js");
const { getWord, updateWord, addProvidedExample } = await import("../src/services/vocab.js");
const { upgradeCard } = await import("../src/services/capture.js");
const { deleteAccount } = await import("../src/services/accountData.js");
const telegramId = `test-capture-examples-${Date.now()}`;
const original = "A. 然而 B. 因此 C. 而且";
const base = { telegramId, sourceLang: "zh", targetLang: "ru", keepProvidedExtras: true, generateDetails: true, generateExamples: true, poolExamples: false, level: "B2", exampleSourceName: "Упражнение A/B/C" };
async function capture(style: string, word = "然而", meaning = "однако", source = base.exampleSourceName, sentence = original) {
  const result = await importWordsForUser({ ...base, exampleStyle: style, exampleSourceName: source, items: [{ word, meaning, example: sentence, exampleTranslation: "", synonyms: [] }] });
  assert.ok(result.job);
  const card = await prisma.word.findFirstOrThrow({ where: { user: { telegramId }, word }, include: { examples: true } });
  assert.equal(card.exampleStatus, "queued");
  return { card, job: result.job };
}
async function run(id: string) {
  await prisma.importJob.update({ where: { id }, data: { status: "processing", leaseUntil: new Date(Date.now() + 300_000) } });
  await processImportJob(await prisma.importJob.findUniqueOrThrow({ where: { id } }));
}
async function clear() { await prisma.word.deleteMany({ where: { user: { telegramId } } }); }
try {
  await prisma.user.create({ data: { telegramId, nativeLang: "ru", hskTarget: 4 } });
  for (const style of ["casual", "news", "internet"]) {
    const before = prompts.length;
    const { card, job } = await capture(style);
    await run(job.id);
    const done = (await getWord(card.id))!;
    assert.equal(done.examples.length, 2);
    assert.equal(done.exampleStatus, "ready");
    const kept = done.examples.find((e) => e.id === card.examples[0].id)!;
    assert.equal(kept.sentenceEn, original); assert.equal(kept.sourceName, base.exampleSourceName); assert.ok(kept.sentenceZh);
    const added = done.examples.find((e) => e.id !== kept.id)!;
    assert.equal(added.register, style); assert.equal(added.level, "HSK 1–4"); assert.equal(added.sourceName, "Onomika AI");
    const prompt = prompts.slice(before).find((p) => p.includes("dictionary. For the given"))!;
    assert.ok(prompt.includes(original)); assert.ok(prompt.includes("HSK 4"));
    assert.ok(prompt.includes(style === "news" ? "formal written" : style === "internet" ? "internet slang" : "everyday, casual"));
    await upgradeCard(card.id, { exampleStyle: style });
    assert.equal(await prisma.example.count({ where: { wordId: card.id } }), 2, "replay never forces a third");
    await clear();
  }
  console.log("PASS captured exercise preserved + translated, one second example, saved formal/casual/internet and level, replay");

  const none = await capture("none"); await run(none.job.id);
  assert.equal((await getWord(none.card.id))!.examples.length, 1);
  assert.ok((await getWord(none.card.id))!.examples[0].sentenceZh);
  await clear();
  const chat = await capture("casual", "然而", "однако", "Onomika AI"); await run(chat.job.id);
  assert.equal((await getWord(chat.card.id))!.examples.length, 2, "AI-attributed captured context is still the original");
  await clear();
  const missing = await capture("casual", "餐补", "компенсация питания"); await run(missing.job.id);
  assert.equal((await getWord(missing.card.id))!.examples.length, 2);
  await clear();
  fail = true;
  const broken = await capture("news"); await run(broken.job.id);
  assert.equal((await getWord(broken.card.id))!.exampleStatus, "failed");
  fail = false;
  const retry = await queueCardUpgrade(broken.card.id); assert.ok(retry); await run(retry.id);
  assert.equal((await getWord(broken.card.id))!.examples.length, 2);
  await clear();
  fail = true;
  const fallback = await capture("casual", "然而", ""); await run(fallback.job.id);
  assert.equal((await getWord(fallback.card.id))!.examples.length, 2, "checked default-sense pool stands in when generation is down");
  fail = false; await clear();
  const senseStart = prompts.length;
  const sense = await capture("news", "背", "нести на себе", base.exampleSourceName, "他背着孩子回家。");
  await run(sense.job.id);
  const sensed = (await getWord(sense.card.id))!;
  assert.equal(sensed.meaningZh, "нести на себе");
  assert.equal(sensed.examples.length, 2);
  assert.ok(sensed.examples.some((e) => e.sentenceEn.includes("孩子背到医院")));
  assert.ok(prompts.slice(senseStart).some((p) => p.includes("他背着孩子回家。") && p.includes("same sense")));
  await clear();
  console.log("PASS no-example preference, chat context, missing pool, failure/retry and prepared fallback");

  let release!: () => void;
  let started!: () => void;
  const pending = new Promise<void>((r) => { started = r; });
  const gate = new Promise<void>((r) => { release = r; });
  hold = async () => { started(); await gate; };
  const racing = await capture("news");
  const running = run(racing.job.id); await pending;
  await removeExample(racing.card.id, racing.card.examples[0].id);
  release(); await running; hold = undefined;
  assert.equal((await getWord(racing.card.id))!.examples.length, 0);
  const replay = await queueCardUpgrade(racing.card.id); assert.ok(replay); await run(replay.id);
  assert.equal((await getWord(racing.card.id))!.examples.length, 0);
  assert.equal((await getWord(racing.card.id))!.exampleStatus, "disabled");
  await addProvidedExample(racing.card.id, "明天下雨，然而他还是打算出去。", "Завтра дождь, однако он всё равно собирается выйти.");
  assert.equal((await getWord(racing.card.id))!.examples.length, 1, "explicit additions still work");
  await clear();

  const item = await capture("casual"); await run(item.job.id);
  const before = await prisma.word.findUniqueOrThrow({ where: { id: item.card.id }, include: { examples: true } });
  const own = before.examples.find((e) => !e.captured)!;
  await prisma.example.update({ where: { id: own.id }, data: { sourceUrl: "https://example.com/lesson", checkedAt: new Date(1) } });
  const snapshot = await prisma.example.findUniqueOrThrow({ where: { id: own.id } });
  await removeExample(item.card.id, item.card.examples[0].id);
  assert.deepEqual(await prisma.example.findUnique({ where: { id: own.id } }), snapshot, "remaining metadata unchanged");
  await updateWord(item.card.id, { examples: [{ id: own.id, sentenceEn: "今天很忙，然而我们还是一起吃了饭。" }] });
  assert.equal(await saveGeneratedExample(item.card.id, before.exampleRevision, { sentenceEn: original, sentenceZh: "", sourceName: "Onomika AI", sourceUrl: "" }), null);
  await removeExample(item.card.id, own.id);
  const after = await prisma.word.findUniqueOrThrow({ where: { id: item.card.id } });
  for (const key of ["stability", "difficulty", "due", "reps", "lapses", "reviewCount", "state", "nextReviewAt"] as const) assert.deepEqual(after[key], before[key]);
  await assert.rejects(removeExample(item.card.id, "not-on-this-card"));
  await assert.rejects(updateWord(item.card.id, { examples: [{ id: "foreign-example", sentenceEn: original }] }));
  assert.equal(after.exampleRevision, (await prisma.word.findUniqueOrThrow({ where: { id: item.card.id } })).exampleRevision, "failed edits/deletes roll back");
  console.log("PASS removal of original/generated/last, running generation + retry, manual re-add, edits, metadata, FSRS and scoped IDs");
} finally {
  await deleteAccount(telegramId);
  await prisma.$disconnect();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
