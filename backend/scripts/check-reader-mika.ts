// Local-only regression and live Qwen/Bailian check for PLAN-reader-mika-fixes.
// Run in the local Docker backend: npx tsx scripts/check-reader-mika.ts
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { prisma } from "../src/services/db.js";
import { tutorChat } from "../src/services/tutorChat.js";
import { glossInContext, translateText } from "../src/services/translate.js";
import { alignmentUnits, alignByIds, alignTranslation, validAlignment } from "../src/services/translationAlignment.js";
import { focusedWords } from "../src/lib/wordOffers.js";
import { chatWindow } from "../src/lib/chatWindow.js";
import { costCny } from "../src/lib/pricing.js";
import { dictCardFields, upgradeCard } from "../src/services/capture.js";
import { runAsUser } from "../src/lib/usageContext.js";
import { hskPage } from "../src/services/wordPages.js";
import { deleteAccount } from "../src/services/accountData.js";
import { tutorChatSchema } from "../src/lib/schemas.js";

assert(["db", "localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL!).hostname), "Local database only");
const stamp = Date.now();
const users = [`test-reader-mika-${stamp}`, `test-reader-mika-other-${stamp}`];
const began = new Date();
const pair = { sourceLang: "zh", targetLang: "ru", level: "4" };
const artifacts: Record<string, unknown> = {};
const api = "http://localhost:3000/api";
async function account(telegramId: string) {
  const login = await fetch(api + "/auth/dev", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ telegramId }) });
  assert.equal(login.status, 200);
  await prisma.user.update({ where: { telegramId }, data: { invited: true, invitedAt: new Date() } });
  const cookie = login.headers.getSetCookie().map((s) => s.split(";")[0]).join("; ");
  return async (path: string, data?: unknown, method = data === undefined ? "GET" : "POST") => {
    const res = await fetch(api + path, { method, headers: { Cookie: cookie, "Content-Type": "application/json" }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { status: res.status, body: await res.json() };
  };
}

async function main() {
  assert.deepEqual(focusedWords("Объясни 无论", ["都", "也", "无论", "谁"]), ["无论"]);
  assert.deepEqual(focusedWords("Добавь все слова из объяснения 无论", ["无论", "都"]), ["无论", "都"]);
  assert.deepEqual(tutorChatSchema.parse({ answer: "Объяснение", addWords: [{ word: "无论", meaning: "независимо от" }] }).addWords, ["无论"]);
  const latest = "新".repeat(20_000);
  assert.equal(chatWindow([{ content: "a".repeat(50_000) }, { content: latest }]).at(-1)?.content, latest);
  const sample = "🙂妈妈的书。妈妈的笔。";
  const sourceUnits = alignmentUnits(sample, true);
  const targetUnits = alignmentUnits("Мамина книга. Мамина ручка.");
  const moms = sourceUnits.filter((u) => u.text === "妈妈");
  const possessives = sourceUnits.filter((u) => u.text === "的");
  const mothers = targetUnits.filter((u) => u.text === "Мамина");
  const unicode = alignByIds(sample, "Мамина книга. Мамина ручка.", [
    { source: [moms[0].id, possessives[0].id], target: [mothers[0].id], kind: "phrase" },
    { source: [moms[1].id, possessives[1].id], target: [mothers[1].id], kind: "phrase" },
    { source: [possessives[0].id], target: [], kind: "word" },
    { source: [9999], target: [0], kind: "word" },
  ]);
  assert.equal(unicode.spans.length, 3);
  assert.equal(unicode.spans[0].sourceStart, 2);
  assert.equal(unicode.spans[1].sourceStart, 7);
  assert.equal(validAlignment({ ...unicode, translation: "wrong" }, unicode.source, unicode.translation), null);
  assert.equal(validAlignment({ ...unicode, spans: [{ ...unicode.spans[0], sourceStart: 1 }] }, unicode.source, unicode.translation), null);
  const wrongRepeat = alignByIds(sample, "Мамина книга. Мамина ручка.", [
    { source: [moms[1].id], target: [mothers[0].id], kind: "word" },
  ], [{ source: 0, target: [0] }, { source: 1, target: [1] }]);
  assert(!wrongRepeat.spans.some((s) => s.kind === "word"), "cross-sentence repeat must fall back, never point to the first occurrence");
  console.log("PASS deterministic focus, bounded window, repeated spans, UTF-16 and invalid cache guards");

  const own = await account(users[0]);
  const other = await account(users[1]);
  const content = "小雨说她明天去北京。她想在红桥饭店见妈妈。妈妈的书在桌子上。今天有小雨。";
  const body = { title: "Урок с Сяоюй", content, ...pair, autosave: true };
  const copies = await Promise.all(Array.from({ length: 5 }, () => own("/reader/texts", body)));
  for (const r of copies) assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(new Set(copies.map((r) => r.body.id)).size, 1, "concurrent hand-offs reuse the same row");
  const id = copies[0].body.id;
  assert.equal((await other(`/reader/texts/${id}`)).status, 404);
  assert.equal((await other("/tutor/chats/ownercheck", { messages: [{ role: "user", content: "Чужая реплика" }], expectedOwner: users[0] }, "PUT")).status, 409);
  assert.equal((await own("/translate", { ...pair, text: "字".repeat(6001) })).status, 400);
  assert.equal((await own("/tutor/ask", { ...pair, messages: [{ role: "user", content: "字".repeat(20_001) }] })).status, 400);
  assert.equal((await own("/tutor/ask", { ...pair, readerContext: { ...pair, content: "字".repeat(20_001) }, messages: [{ role: "user", content: "Прочитай текст" }] })).status, 400);
  assert.equal((await other("/tutor/ask", { ...pair, readerContext: { id, content, ...pair }, messages: [{ role: "user", content: "Прочитай мой текст" }] })).status, 404);
  const translated = await translateText({ text: content, ...pair, align: true });
  artifacts.translation = translated;
  assert.match(translated.translation, /Сяо[ -]?юй/i);
  assert.match(translated.translation, /дожд/i);
  assert(translated.alignment?.spans.length, "live alignment has validated spans");
  assert(translated.alignment.spans.some((s) => content.slice(s.sourceStart, s.sourceEnd).includes("妈妈") && /мам|матер|мат[ьи]/i.test(translated.translation.slice(s.targetStart, s.targetEnd))), "possessive phrase aligned");
  const rainAt = content.lastIndexOf("小雨");
  const rainSpan = translated.alignment.spans.filter((s) => s.sourceStart <= rainAt && s.sourceEnd >= rainAt + 2 && s.targetEnd > s.targetStart)
    .sort((a, b) => a.sourceEnd - a.sourceStart - (b.sourceEnd - b.sourceStart))[0];
  assert(rainSpan && /дожд|морос/i.test(translated.translation.slice(rainSpan.targetStart, rainSpan.targetEnd)), "weather occurrence never links to the earlier personal name");
  assert.equal((await own(`/reader/texts/${id}`, { translation: translated.translation, translationAlignment: translated.alignment, expectedContent: content }, "PUT")).status, 200);
  assert.deepEqual((await own(`/reader/texts/${id}`)).body.translationAlignment, translated.alignment);
  assert.equal((await own(`/reader/texts/${id}`, { title: "Новое название", translation: translated.translation }, "PUT")).status, 200);
  assert.deepEqual((await own(`/reader/texts/${id}`)).body.translationAlignment, translated.alignment);
  assert.equal((await own("/reader/texts", body)).body.translation, translated.translation);
  assert.equal((await own(`/reader/texts/${id}`, { translation: "Старый ответ", expectedTranslation: "уже другой перевод" }, "PUT")).status, 400);
  assert.equal((await own(`/reader/texts/${id}`, { translationAlignment: { ...translated.alignment, source: "wrong" } }, "PUT")).status, 400);
  assert.equal((await own(`/reader/texts/${id}`, { content: "新课文。" }, "PUT")).status, 200);
  const changed = (await own(`/reader/texts/${id}`)).body;
  assert.equal(changed.translation, null);
  assert.equal(changed.translationAlignment, null);
  assert.equal((await own(`/reader/texts/${id}`, { translation: "stale", expectedContent: content }, "PUT")).status, 400);
  assert.equal((await own(`/reader/texts/${id}`, { content }, "PUT")).status, 200);
  console.log("PASS ownership, concurrent hand-off, saved mapping, metadata, invalidation, stale write guards");

  const readerContext = { id, title: "Урок", content, selection: "妈妈的", sentence: "妈妈的书在桌子上。", ...pair };
  const read = await own("/tutor/ask", { ...pair, readerContext, messages: [{ role: "user", content: "Прочитай текст, который я сейчас читаю. Куда завтра едет героиня и как её зовут?" }] });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.match(read.body.answer, /北京|Пекин/i);
  assert.match(read.body.answer, /小雨|Сяо[ -]?юй/i);
  artifacts.reader = read.body;
  const longText = "我们今天学习汉语。".repeat(1500) + "最后一句：明天十点三十五分在上海见。";
  const long = await own("/tutor/ask", { ...pair, readerContext: { content: longText, ...pair }, messages: [{ role: "user", content: "Внимательно прочитай последнюю строку моего текста: где и во сколько встреча?" }] });
  assert.equal(long.status, 200, JSON.stringify(long.body));
  assert.match(long.body.answer, /上海|Шанха/i);
  assert.match(long.body.answer, /10[:：]35|десять.*тридцать пять/i);
  artifacts.longReader = long.body;
  const focus = await tutorChat({ ...pair, messages: [{ role: "user", content: "Объясни 无论" }] });
  assert.deepEqual(focus.addWords, ["无论"]);
  const bulk = await tutorChat({ ...pair, messages: [{ role: "user", content: "Предложи 5 слов HSK 4 по теме путешествия." }] });
  assert(bulk.addWords.length >= 5, JSON.stringify(bulk));
  artifacts.focus = focus;
  artifacts.bulk = bulk;
  const pasted = await tutorChat({ ...pair, messages: [{ role: "user", content: `Открой этот текст в Читалке:\n${content}` }] });
  assert.equal(pasted.readerText?.content, content);
  const photo = `data:image/jpeg;base64,${readFileSync(new URL("./fixtures/lesson-page.jpg", import.meta.url)).toString("base64")}`;
  const photographed = await tutorChat({ ...pair, messages: [{ role: "user", content: "Прочитай текст с фото и предложи открыть его в Читалке.", images: [photo] }] });
  assert(photographed.readerText?.content.includes("图书馆"), JSON.stringify(photographed));
  artifacts.photo = photographed;
  console.log("PASS live Reader context, focused/bulk offers, pasted and photographed text hand-off");

  const name = await glossInContext({ word: "小雨", sentence: "小雨说她明天去北京。", ...pair });
  const weather = await glossInContext({ word: "小雨", sentence: "今天有小雨，记得带伞。", ...pair });
  assert.match(name.gloss, /Сяо[ -]?юй/i);
  assert.match(weather.gloss, /дожд|морос/i);
  const u = await prisma.user.findUniqueOrThrow({ where: { telegramId: users[0] } });
  const fields = await dictCardFields("小雨", "zh", "ru");
  const card = await prisma.word.create({ data: { userId: u.id, word: "小雨", sourceLang: "zh", targetLang: "ru", ...fields,
    examples: { create: { sentenceEn: "小雨说她明天去北京。", sentenceZh: "Мой собственный перевод", sourceName: "Учебник", sourceUrl: "" } } } });
  await upgradeCard(card.id, { withExample: false });
  const enriched = await prisma.word.findUniqueOrThrow({ where: { id: card.id }, include: { examples: true } });
  assert.match(enriched.meaningZh!, /Сяо[ -]?юй/i);
  assert.equal(enriched.examples[0].sentenceZh, "Мой собственный перевод");
  await prisma.word.update({ where: { id: card.id }, data: { meaningZh: "Авторская заметка: имя подруги" } });
  await upgradeCard(card.id, { withExample: false });
  assert.equal((await prisma.word.findUniqueOrThrow({ where: { id: card.id } })).meaningZh, "Авторская заметка: имя подруги");
  assert(!hskPage("复杂", "ru")?.syn.includes("难"));
  assert(!hskPage("难", "ru")?.syn.includes("复杂"));
  artifacts.names = { name, weather, card: enriched.meaningZh };
  console.log("PASS live names versus weather, captured card, learner edits and related-word audit");

  const messages: { role: "user" | "assistant"; content: string; images?: string[]; readerContext?: typeof readerContext }[] = [];
  for (let i = 0; i < 16; i++) {
    const question = i === 0 ? "В нашем учебном диалоге героиню зовут Лена, её номер комнаты 721, встреча в 17:40. Запомни эти детали. Ответь очень кратко." :
      `Урок ${i}: напиши по-китайски число ${i + 20} с пиньинем, одной строкой.`;
    messages.push({ role: "user", content: question });
    const reply = await tutorChat({ ...pair, messages });
    messages.push({ role: "assistant", content: reply.answer });
    console.log(`memory exchange ${i + 1}/16`);
  }
  messages[0].readerContext = readerContext;
  assert.equal((await own("/tutor/chats/readerlongtest", { messages }, "PUT")).status, 200);
  assert.equal((await other("/tutor/chats/readerlongtest")).status, 404);
  const restored = (await own("/tutor/chats/readerlongtest")).body.messages;
  assert.equal(restored.length, 32);
  assert.equal(restored[0].readerContext.content, content);
  artifacts.memory = restored;
  const recall = await tutorChat({ ...pair, messages: [...restored, { role: "user", content: "Как зовут героиню нашего учебного диалога, какой у неё номер комнаты и во сколько встреча?" }] });
  assert.match(recall.answer, /Лен|Lena|列娜/i);
  assert.match(recall.answer, /721/);
  assert.match(recall.answer, /17[:：]40/);
  const afterPhoto = await tutorChat({ ...pair, messages: [...restored, { role: "user", content: "Напомни номер комнаты героини, а затем прочитай последнюю строку с фотографии.", images: [photo] }] });
  assert.match(afterPhoto.answer, /721/);
  assert.match(afterPhoto.answer, /图书馆/);
  const cardRecall = await own(`/words/${card.id}/ask`, { messages: [...messages, { role: "user", content: "Какой номер комнаты мы использовали в учебном примере?" }] });
  assert.equal(cardRecall.status, 200);
  assert.match(cardRecall.body.answer, /721/);
  artifacts.recall = { recall, afterPhoto, card: cardRecall.body };
  console.log("PASS 16 real exchanges, account history restore, ownership, recall, photo and card follow-up");
  const oldTranslation = "Авторский перевод: мама читает книгу.";
  const oldSource = "妈妈在看书。";
  const cached = await alignTranslation(oldSource, oldTranslation);
  assert.equal(cached.translation, oldTranslation);
  assert(cached.spans.length > 0);
  artifacts.cachedAlignment = cached;
  const reordered = await alignTranslation("妈妈看书。小雨去了北京。", "Сяоюй поехала в Пекин. Мама читает книгу.");
  const mom = reordered.spans.filter((s) => s.sourceStart === 0 && s.targetEnd > s.targetStart).sort((a, b) => a.sourceEnd - b.sourceEnd)[0];
  assert(mom && /Мама/.test(reordered.translation.slice(mom.targetStart, mom.targetEnd)), "reordered target sentences retain the right match");
  artifacts.reordered = reordered;
}

try { await runAsUser(users[0], main); }
catch (e) { console.error(e); process.exitCode = 1; }
finally {
  // Only this run's throwaway data; never production accounts.
  const usage = await prisma.tokenUsage.findMany({ where: { createdAt: { gte: began }, telegramId: { in: users } }, select: { model: true, promptTokens: true, completionTokens: true, cachedTokens: true } });
  const cost = usage.reduce((n, r) => n + costCny(r.model, r.promptTokens, r.completionTokens, r.cachedTokens), 0);
  console.log(`Usage since start: ${usage.length} calls, estimated ¥${cost.toFixed(4)} at project pricing rates`);
  artifacts.cost = { calls: usage.length, cny: cost };
  writeFileSync(process.exitCode ? `scripts/reader-mika-failed-${stamp}.log` : "scripts/reader-mika-result.log", JSON.stringify(artifacts, null, 2));
  for (const user of users) await deleteAccount(user);
  await prisma.$disconnect();
}
