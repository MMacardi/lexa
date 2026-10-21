// One local HTTP smoke check for Mika's card-context memory path (real Qwen).
import assert from "node:assert/strict";
import { prisma } from "../src/services/db.js";
import { deleteAccount } from "../src/services/accountData.js";

assert.match(process.env.DATABASE_URL ?? "", /localhost:5433\//, "Local Docker DB only");
const telegramId = `memory-card-${Date.now()}`;
const base = "http://localhost:3000/api";
try {
  const user = await prisma.user.create({ data: { telegramId, invited: true, nativeLang: "ru" } });
  const word = await prisma.word.create({ data: {
    userId: user.id, word: "到达", sourceLang: "zh", targetLang: "ru", meaningZh: "прибыть", partOfSpeech: "глагол",
  } });
  const login = await fetch(`${base}/auth/dev`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telegramId }) });
  assert.equal(login.status, 200);
  const headers = { "Content-Type": "application/json", Cookie: login.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
  assert.equal((await fetch(`${base}/coach/profile`, { method: "PUT", headers, body: JSON.stringify({
    lang: "zh", notes: "Предпочитаю один короткий пример про лодки.",
  }) })).status, 200);
  const messages = [{ role: "user" as const, content: "Покажи короткий пример с 到达 с учётом моих учебных предпочтений." }];
  const response = await fetch(`${base}/words/${word.id}/ask`, { method: "POST", headers, body: JSON.stringify({ chatId: "cardmemorytest", messages }) });
  assert.equal(response.status, 200, await response.clone().text());
  const reply = await response.json() as { answer: string };
  assert.match(reply.answer, /лодк|船|boat/i);
  const memory = await prisma.coachMemory.findUniqueOrThrow({ where: { userId_lang: { userId: user.id, lang: "zh" } } });
  assert.equal(await prisma.coachMemoryUpdate.count({ where: { memoryId: memory.id } }), 1);
  assert.equal(await prisma.coachMemory.count({ where: { userId: user.id, lang: "en" } }), 0);
  console.log("PASS card-context HTTP reply uses learner memory and persists a source-language checkpoint");
  console.log(reply.answer);
} finally {
  await deleteAccount(telegramId);
  await prisma.$disconnect();
}
