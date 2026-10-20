// Local DB only; fake model responses exercise durable progress, failure and retry.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

let fail = false;
let failSecond = false;
const prompts: string[] = [];
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const messages = JSON.parse(body).messages as { role: string; content: string }[];
    const system = messages.find((m) => m.role === "system")?.content ?? "";
    const word = messages.find((m) => m.role === "user")?.content ?? "";
    prompts.push(system);
    res.setHeader("content-type", "application/json");
    if (fail || (failSecond && system.startsWith("Write ONE natural"))) {
      res.writeHead(400); res.end(JSON.stringify({ error: { message: "Local injected generation failure" } })); return;
    }
    const sentence = `老师说“${word}”这个词很常用。`;
    const reply = system.includes("native Mandarin editor") ? { natural: true }
      : system.startsWith("You write example sentences") ? { example: sentence, exampleTranslation: "Это частое слово." }
      : system.startsWith("Write ONE natural") ? { sentence: `我们今天又学了“${word}”这个词。`, translation: "Сегодня мы снова учили это слово." }
      : system.includes("dictionary. For the given") ? { phonetic: "", partOfSpeech: "глагол", meaningZh: "нести на себе", collocations: [], synonyms: [], antonyms: [], example: sentence, exampleTranslation: "Это частое слово." }
      : { translation: "Мы учим это слово." };
    setTimeout(() => res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })), 30);
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
process.env.BAILIAN_API_KEY = "local-test";
process.env.BAILIAN_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
const { prisma } = await import("../src/services/db.js");
const { addWordForUser, getWord } = await import("../src/services/vocab.js");
const { importWordsForUser } = await import("../src/services/importWords.js");
const { processImportJob, getImportJobForUser, cancelImportJobForUser } = await import("../src/services/importWorker.js");
const { queueCardUpgrade } = await import("../src/services/cardJobs.js");
const { deleteAccount } = await import("../src/services/accountData.js");
const telegramId = `test-example-progress-${Date.now()}`;
const base = { telegramId, sourceLang: "zh", targetLang: "ru", exampleStyle: "casual" };
async function runJob(id: string) {
  await prisma.importJob.update({ where: { id }, data: { status: "processing", leaseUntil: new Date(Date.now() + 300_000) } });
  await processImportJob(await prisma.importJob.findUniqueOrThrow({ where: { id } }));
}
try {
  await prisma.user.create({ data: { telegramId, nativeLang: "ru", hskTarget: 4 } });
  for (const senseIndex of [undefined, 0]) {
    const callsBefore = prompts.length;
    const card = await addWordForUser({ ...base, word: "顺序", senseIndex });
    assert.ok("job" in card && card.job);
    assert.equal(card.exampleStatus, "queued");
    assert.ok(card.partOfSpeech, "dictionary-complete cards still report pending examples");
    assert.equal(prompts.length, callsBefore, "creation makes no model call");
    await prisma.word.update({ where: { id: card.id }, data: { createdAt: new Date(Date.now() - 180_000) } });
    assert.equal((await getWord(card.id))?.exampleStatus, "queued", "pending does not expire after two minutes");
    await runJob(card.job.id);
    const done = await getWord(card.id);
    assert.equal(done?.exampleStatus, "ready"); assert.equal(done.enrichmentStatus, "ready");
    assert.equal(done.examples.length, 2);
    const job = await getImportJobForUser(card.job.id, telegramId);
    assert.deepEqual(job?.cards, [{ id: card.id, word: "顺序" }]);
    assert.deepEqual(job?.errors, []);
  }
  console.log("PASS both 顺序 paths, instant capture, durable >2-minute status and exact job card IDs");

  fail = true;
  const broken = await addWordForUser({ ...base, word: "认真" });
  assert.ok("job" in broken && broken.job);
  await runJob(broken.job.id);
  assert.equal((await getWord(broken.id))?.exampleStatus, "failed");
  assert.deepEqual((await getImportJobForUser(broken.job.id, telegramId))?.errors, ["认真"]);
  fail = false;
  const retries = await Promise.all([queueCardUpgrade(broken.id), queueCardUpgrade(broken.id)]);
  assert.equal(retries.filter(Boolean).length, 1);
  await runJob(retries.find(Boolean)!.id);
  assert.equal((await getWord(broken.id))?.exampleStatus, "ready");
  assert.equal(await prisma.word.count({ where: { user: { telegramId }, word: "认真" } }), 1);
  const cancelledRetry = await queueCardUpgrade(broken.id);
  await cancelImportJobForUser(cancelledRetry!.id, telegramId);
  assert.ok(await getWord(broken.id), "cancelling a retry never undoes the original add");
  console.log("PASS failed job is reported; concurrent retries recover the same card once");

  failSecond = true;
  const sense = await addWordForUser({ ...base, word: "背", senseIndex: 1 });
  assert.ok("job" in sense && sense.job);
  await runJob(sense.job.id);
  assert.equal((await getWord(sense.id))?.exampleStatus, "failed");
  const partial = (await getWord(sense.id))!;
  assert.equal(partial.examples.length, 1);
  failSecond = false;
  const retry = await queueCardUpgrade(sense.id);
  await runJob(retry!.id);
  const recovered = (await getWord(sense.id))!;
  assert.equal(recovered.exampleStatus, "ready");
  assert.equal(recovered.examples.length, 2);
  assert.ok(recovered.examples.some((e) => e.id === partial.examples[0].id));
  assert.equal(recovered.phonetic, "bēi");
  console.log("PASS partial failure retries only the missing example, retaining selected sense and existing example");

  const disabled = await addWordForUser({ ...base, word: "朋友", exampleStyle: "none" });
  assert.ok("job" in disabled && disabled.job);
  assert.equal(disabled.exampleStatus, "disabled");
  await runJob(disabled.job.id);
  const disabledRetry = await queueCardUpgrade(disabled.id);
  await runJob(disabledRetry!.id);
  assert.equal((await getWord(disabled.id))?.exampleStatus, "disabled");
  assert.equal((await getWord(disabled.id))?.examples.length, 0);
  console.log("PASS explicit no-example stays disabled, including retry");

  const reader = await importWordsForUser({ ...base, items: [{ word: "环境", meaning: "", example: "我们学习环境。", exampleTranslation: "", synonyms: [] }], keepProvidedExtras: true, generateDetails: true, generateExamples: false });
  assert.ok(reader.job);
  const readerId = (await getImportJobForUser(reader.job.id, telegramId))!.cards[0].id;
  assert.equal((await getWord(readerId))?.exampleStatus, "queued");
  await runJob(reader.job.id);
  assert.equal((await getWord(readerId))?.exampleStatus, "ready");
  assert.equal((await getWord(readerId))?.examples.length, 1);
  assert.ok((await getWord(readerId))?.examples[0].sentenceZh);
  const owned = await importWordsForUser({ ...base, items: [{ word: "环境", meaning: "", example: "", exampleTranslation: "", synonyms: [] }], generateDetails: true, generateExamples: true });
  assert.equal(owned.created, 0); assert.equal(owned.skipped, 1); assert.equal(owned.job, null);
  console.log("PASS Reader/popup context translation progress and already-owned skip");

  const kept = await addWordForUser({ ...base, word: "工作" });
  assert.ok("job" in kept && kept.job);
  await prisma.word.update({ where: { id: kept.id }, data: { reviewCount: 1 } });
  await cancelImportJobForUser(kept.job.id, telegramId);
  assert.equal((await getWord(kept.id))?.exampleStatus, "failed");
  assert.equal((await getWord(kept.id))?.enrichmentStatus, "failed");
  assert.equal(await prisma.word.count({ where: { user: { telegramId }, word: "顺序" } }), 2, "intentional separate cards survive");
  console.log("PASS stop keeps reviewed cards recoverable; separate same-spelling cards remain");
} finally {
  await deleteAccount(telegramId);
  await prisma.$disconnect();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
