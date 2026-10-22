/** Deterministic service checks. No real API, usage writes or learner database. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";

type Request = { model: string; stream?: boolean; enable_thinking?: boolean; messages: { role: string; content: unknown }[] };
const requests: Request[] = [];
let responses: (string | { answer: string; readerText?: { title: string; content: string }; addWords?: string[]; addCards?: { word: string; meaning: string }[] })[] = [];
let abortAfterDraft: AbortController | undefined;
const server = createServer(async (req, res) => {
  let body = ""; for await (const chunk of req) body += chunk;
  const request = JSON.parse(body) as Request; requests.push(request);
  const value = responses.shift(); assert.notEqual(value, undefined, "unexpected extra model request");
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  if (request.stream) {
    res.setHeader("content-type", "text/event-stream");
    for (let i = 0; i < raw.length; i += 7) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: raw.slice(i, i + 7) } }] })}\n\n`);
    res.end("data: [DONE]\n\n");
  } else {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ choices: [{ message: { content: raw } }] }));
    abortAfterDraft?.abort();
  }
});
server.listen(0, "127.0.0.1"); await once(server, "listening");
process.env.BAILIAN_API_KEY = "local-stub";
process.env.BAILIAN_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused?connect_timeout=1";
process.env.BAILIAN_TUTOR_REVIEW_MODEL = "qwen3.8-max-0902";
const { tutorChat } = await import("../src/services/tutorChat.js");
const args = { sourceLang: "zh", targetLang: "ru", messages: [{ role: "user" as const, content: "Проверь «交流»." }] };
const draft = { answer: "Непроверенный ошибочный черновик.", readerText: { title: "Текст", content: "这是原文。" }, addWords: ["交流"], addCards: [] };
const correct = { answer: "Исправленный ответ.", readerText: { title: "Другой", content: "改写。" }, addWords: ["交流", "新"], addCards: [{ word: "交流", meaning: "общение" }, { word: "新", meaning: "новый" }] };
const reset = (...values: typeof responses) => { requests.length = 0; responses = values; };
try {
  reset(draft, correct);
  let visible = "";
  const result = await tutorChat({ ...args, onDelta: (text) => { visible += text; } });
  assert.deepEqual(requests.map((r) => [r.model, !!r.stream]), [["qwen-plus", false], ["qwen3.8-max-0902", true]]);
  assert.equal(requests[1].enable_thinking, false);
  assert.equal(visible, correct.answer, "draft must not appear in learner stream");
  assert.equal(result.answer, correct.answer);
  assert.deepEqual(result.readerText, draft.readerText, "review must not rewrite source passage");
  assert.deepEqual(result.addWords, draft.addWords, "review must not expand save actions");
  assert.deepEqual(result.addCards?.map((c) => c.word), ["交流"]);
  const reviewInput = JSON.parse(requests[1].messages[1].content as string);
  assert.equal(JSON.parse(reviewInput.draft).answer, draft.answer);
  assert.equal(reviewInput.conversation.at(-1).content, args.messages[0].content);

  reset(draft, { ...correct, addWords: [] });
  const withdrawn = await tutorChat({ ...args, messages: [{ role: "user", content: "Проверь объяснение и список слов." }] });
  assert.deepEqual(withdrawn.addWords, [], "review may withdraw an incorrect word offer");
  assert.deepEqual(withdrawn.addCards, [], "withdrawn offers cannot retain save-ready cards");

  reset(draft, { answer: "Это 或 неверно." }, correct);
  visible = "";
  assert.equal((await tutorChat({ ...args, onDelta: (t) => { visible += t; } })).answer, correct.answer);
  assert.deepEqual(requests.map((r) => !!r.stream), [false, true, false]);
  assert.equal(requests.filter((r) => r.model === "qwen-plus").length, 1, "format repair reuses the same draft");
  assert.ok(!visible.includes(correct.answer), "repair is not appended to the provisional bubble");

  reset("7", draft, correct);
  assert.equal((await tutorChat(args)).answer, correct.answer, "malformed draft can use the single repair");
  assert.equal(requests.length, 3);
  reset(draft, { answer: "Это 或 неверно." }, { answer: "Это 或 неверно." });
  await assert.rejects(tutorChat(args), /requested language/);
  assert.equal(requests.length, 3, "never returns unreviewed draft after a failed repair");

  reset(draft);
  abortAfterDraft = new AbortController();
  await assert.rejects(tutorChat({ ...args, signal: abortAfterDraft.signal }), { name: "AbortError" });
  assert.equal(requests.length, 1, "cancellation stops before review"); abortAfterDraft = undefined;

  reset({ answer: "Обычный ответ." });
  await tutorChat({ ...args, sourceLang: "en" }); assert.equal(requests.length, 1);
  reset({ answer: "Ответ по фото." });
  await tutorChat({ ...args, messages: [{ role: "user", content: "Фото", images: ["data:image/png;base64,AA=="] }] });
  assert.equal(requests.length, 1, "photo path is unchanged");
  console.log("PASS hidden draft, review routing, final metadata, bounded repair, malformed JSON, cancellation and unaffected language/photo paths");
} finally {
  await new Promise<void>((done) => server.close(() => done()));
  const { prisma } = await import("../src/services/db.js"); await prisma.$disconnect();
}
