// Real route/service/Sambert transport against a LOCAL fake WebSocket provider.
// cd backend && npx tsx scripts/check-tts-http.ts
import assert from "node:assert/strict";
import express from "express";
import { WebSocketServer } from "ws";

const provider = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise<void>(resolve => provider.once("listening", resolve));
const providerAddress = provider.address();
assert.ok(typeof providerAddress !== "string");
process.env.DATABASE_URL = "postgresql://vocab:vocab@localhost:5433/vocab?schema=public";
process.env.BAILIAN_BASE_URL = `http://127.0.0.1:${providerAddress.port}/compatible-mode/v1`;
process.env.BAILIAN_API_KEY = "fixture";
delete process.env.BAILIAN_WORD_TTS_MODEL;
const { prisma } = await import("../src/services/db.js");
const rows = new Map<string, { mp3: Uint8Array }>();
prisma.ttsClip.findUnique = (async ({ where: { key } }: any) => rows.get(key) ?? null) as any;
prisma.ttsClip.create = (async ({ data }: any) => { rows.set(data.key, data); return data; }) as any;
prisma.tokenUsage.create = (async () => ({})) as any;
let mode = "ok";
const requests: any[] = [];
const nativeFetch = globalThis.fetch;
const wav = Buffer.alloc(44 + 9600);
wav.write("RIFF"); wav.writeUInt32LE(0x7fffffff, 4); wav.write("WAVEfmt ", 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(0x7fffff9b, 40);
for (let i = 0; i < 4800; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 300 / 48000) * 10000), 44 + i * 2);
provider.on("connection", (ws, request) => {
  assert.equal(request.url, "/api-ws/v1/inference");
  assert.equal(request.headers.authorization, "Bearer fixture");
  ws.on("message", raw => {
    const message = JSON.parse(raw.toString()); requests.push(message);
    assert.equal(message.header.action, "run-task", "Sambert receives one complete run-task, no duplex messages");
    const event = (event: string, extra = {}) => ws.send(JSON.stringify({ header: { task_id: message.header.task_id, event, ...extra } }));
    if (mode === "close") return ws.close();
    if (mode === "malformed") return ws.send("{broken");
    if (mode === "failed") return event("task-failed", { error_code: "fixture_failure" });
    if (mode === "stall") return;
    event("task-started");
    if (mode === "oversize") { ws.send(Buffer.alloc(1024 * 1024 + 1)); ws.send(Buffer.alloc(1024 * 1024)); return; }
    if (mode === "invalid-wav") ws.send(Buffer.from("not WAV"));
    else if (mode !== "empty") { ws.send(wav.subarray(0, 44)); ws.send(wav.subarray(44)); }
    event("task-finished");
  });
});
globalThis.fetch = async (input, options) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url.endsWith("/chat/completions")) throw new Error("Live word playback must not call ASR");
  if (url.startsWith("http://127.0.0.1:")) return nativeFetch(input, options);
  throw new Error(`Unexpected external network request: ${url}`);
};
const { wordWav } = await import("../src/services/wordTts.js");
const { wordsRouter } = await import("../src/routes/words.js");
const app = express();
// Production auth/invite gates are verified by the local browser check.
app.use("/api", wordsRouter);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address();
assert.ok(address && typeof address !== "string");
const url = `http://127.0.0.1:${address.port}/api/tts?lang=zh&text=序&v=word-3`;
try {
  assert.ok((await wordWav("序")).equals(wav), "binary frames assembled without altering PCM");
  const single = requests.at(-1).payload;
  assert.equal(single.model, "sambert-zhijia-v1");
  assert.equal(single.input.text, "序");
  assert.equal(single.parameters.rate, 1.25);
  assert.equal(single.parameters.sample_rate, 48000);
  assert.equal(single.parameters.pitch, 1);
  await wordWav("顺序");
  assert.equal(requests.at(-1).payload.parameters.rate, 1);
  for (const [failure, expected] of [["close", /before completion/], ["malformed", /JSON|Unexpected|Expected/], ["failed", /fixture_failure/], ["empty", /no audio/], ["oversize", /too large/]] as const) {
    mode = failure;
    await assert.rejects(wordWav("序"), expected);
  }
  mode = "ok";
  let res = await nativeFetch(url);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("cache-control")!, /private.*immutable/);
  const fresh = Buffer.from(await res.arrayBuffer()), count = requests.length;
  assert.ok(fresh.length > 0); assert.equal(rows.size, 1);
  res = await nativeFetch(url, { headers: { Range: "bytes=0-1" } });
  assert.equal(res.status, 206); assert.match(res.headers.get("cache-control")!, /private.*immutable/);
  assert.ok(fresh.subarray(0, 2).equals(Buffer.from(await res.arrayBuffer())));
  res = await nativeFetch(url); assert.ok(fresh.equals(Buffer.from(await res.arrayBuffer())));
  assert.equal(requests.length, count, "cache hit makes no provider requests");
  mode = "failed";
  res = await nativeFetch(url.replace("序", "儿"));
  assert.equal(res.status, 502);
  assert.equal(rows.size, 1, "failed takes remain uncached");
  mode = "ok";
  res = await nativeFetch(url.replace("序", "儿"));
  assert.equal(res.status, 200); await res.arrayBuffer(); assert.equal(rows.size, 2);
  mode = "invalid-wav";
  res = await nativeFetch(url.replace("序", "味"));
  assert.equal(res.status, 502); assert.equal(rows.size, 2);
  console.log("PASS: Sambert protocol/rates/binary assembly, provider failure/close/malformed/empty/oversize, immutable 200/206 byte cache, provider/encoding failure 502 uncached, recovery and no live ASR dependency.");
  mode = "stall";
  await assert.rejects(wordWav("序"), /timed out/);
  console.log("PASS: stalled provider times out and closes the socket.");
} finally {
  globalThis.fetch = nativeFetch;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  for (const socket of provider.clients) socket.terminate();
  await new Promise<void>(resolve => provider.close(() => resolve()));
  await prisma.$disconnect();
}
