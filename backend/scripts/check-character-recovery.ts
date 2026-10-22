// Local dictionary gaps: one failed adaptation must preserve another and retry only gaps.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";

const calls = new Map<string, number>();
const server = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const inv = JSON.parse(body.messages[1].content);
  const count = (calls.get(inv.word) ?? 0) + 1;
  calls.set(inv.word, count);
  const content = { senses: [{ reading: 0, glosses: [inv.word === "嗷" && count === 1 ? 999 : 0],
    meaning: inv.word === "嗷" ? "выть" : "мяукать", pos: "" }] };
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) }, finish_reason: "stop" }] }));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address() as { port: number };
process.env.BAILIAN_BASE_URL = `http://127.0.0.1:${port}/v1`;
process.env.BAILIAN_API_KEY = "local-character-check";

const { wordCharacters } = await import("../src/services/characters.js");
const { cedictLookup, mainReading, isMeaningGloss } = await import("../src/services/cedict.js");
const { defaultMeaning } = await import("../src/services/lookup.js");
const { prisma } = await import("../src/services/db.js");
const keys: string[] = [];
for (const word of ["嗷", "喵"]) {
  assert.equal(defaultMeaning(word, "ru"), null);
  const entry = cedictLookup(word, { count: false })!;
  assert.ok(entry);
  const main = (await mainReading(entry)).reading;
  const readings = [main, ...entry.readings.filter(r => r !== main)]
    .map(r => ({ pinyin: r.pinyin, glosses: r.glosses.filter(isMeaningGloss).slice(0, 24) }))
    .filter(r => r.glosses.length).slice(0, 8);
  keys.push(createHash("sha256").update(JSON.stringify([2, entry.word, "ru", readings])).digest("hex"));
}
const backup = await prisma.dictionaryAdaptation.findMany({ where: { key: { in: keys } } });
const telegramId = `test-character-recovery-${Date.now()}`;
try {
  await prisma.dictionaryAdaptation.deleteMany({ where: { key: { in: keys } } });
  await prisma.user.create({ data: { telegramId, invited: true, nativeLang: "ru" } });
  const partial = await wordCharacters(telegramId, "嗷喵", "áo miāo", "ru", true);
  assert.equal(partial[0].english, true);
  assert.equal(partial[0].meaning, "");
  assert.equal(partial[1].meaning, "мяукать");
  assert.equal(partial[1].english, false);
  console.log("PASS a failed gap preserves the other character's translation");
  const retried = await wordCharacters(telegramId, "嗷喵", "áo miāo", "ru", true);
  assert.ok(retried.every(c => !c.english && c.meaning));
  assert.equal(calls.get("嗷"), 2);
  assert.equal(calls.get("喵"), 1);
  console.log("PASS retry translates only the remaining gap; successful meanings use shared cache");
} finally {
  await prisma.user.deleteMany({ where: { telegramId } });
  await prisma.dictionaryAdaptation.deleteMany({ where: { key: { in: keys } } });
  for (const row of backup) await prisma.dictionaryAdaptation.create({ data: row });
  await prisma.$disconnect();
  await new Promise<void>((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
}
