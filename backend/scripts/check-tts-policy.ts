// Deterministic concurrency/cache/failure checks; no network or database.
// cd backend && npx tsx scripts/check-tts-policy.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as crypto from "node:crypto";

const rows = new Map<string, { mp3: Uint8Array }>();
let requests = 0, failure = "";
const inputs: string[] = [], usageModels: string[] = [];
const exports: Record<string, any> = {};
const source = fs.readFileSync(new URL("../src/services/tts.ts", import.meta.url), "utf8");
const wav = Buffer.alloc(46);
wav.write("RIFF"); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(0x7fffff9b, 40);
const deps: Record<string, unknown> = {
  "node:crypto": crypto,
  "@breezystack/lamejs": { Mp3Encoder: class { encodeBuffer() { return Uint8Array.of(0xff, 0xfb, requests); } flush() { return []; } } },
  "../lib/env.js": { env: { BAILIAN_BASE_URL: "https://bailian.invalid/compatible-mode/v1", BAILIAN_API_KEY: "test" } },
  "./db.js": { prisma: {
    ttsClip: { findUnique: async ({ where: { key } }: any) => rows.get(key), create: async ({ data }: any) => rows.set(data.key, data) },
    tokenUsage: { create: async ({ data }: any) => { usageModels.push(data.model); } },
  } },
  "../lib/usageContext.js": { currentUserId: () => undefined },
  "./wordTts.js": { WORD_TTS_MODEL: "sambert-zhijia-v1", wordSpeechRate: (text: string) => [...text].length === 1 ? 1.25 : 1,
    wordWav: async (text: string) => {
      requests++; inputs.push(text);
      if (failure === "provider") throw new Error("provider unavailable");
      return failure === "encoding" ? Buffer.from("not WAV") : wav;
    } },
};
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  exports, require: (name: string) => { assert.ok(name in deps, name); return deps[name]; },
  Buffer, URL, Uint8Array, Int16Array, AbortSignal, console, process: { env: {} },
  fetch: async (url: string, options: { body?: string }) => {
    if (url.endsWith("/generation")) {
      requests++; inputs.push(JSON.parse(options.body!).input.text);
      return { ok: true, json: async () => ({ output: { audio: { url: "https://audio.invalid/test.wav" } } }) };
    }
    assert.equal(url, "https://audio.invalid/test.wav");
    return { ok: true, arrayBuffer: async () => wav };
  },
});
const { speechClip, speechCacheKey, wavToMp3 } = exports;
const oldKey = (text: string, policy = "heard|") => crypto.createHash("sha256").update(`qwen3-tts-flash|Cherry|${policy}${text}`).digest("hex");
for (const policy of ["", "heard|", "heard-v2|"]) assert.notEqual(speechCacheKey("顺序"), oldKey("顺序", policy));
assert.equal(speechCacheKey("我们按顺序来。"), oldKey("我们按顺序来。", ""));
rows.set(oldKey("顺序"), { mp3: Uint8Array.of(99) });
const [first, concurrent] = await Promise.all([speechClip("顺序"), speechClip("顺序")]);
assert.equal(requests, 1, "concurrent taps share one synthesis");
assert.deepEqual(inputs, ["顺序"], "no punctuation/carrier or ASR request");
assert.ok(first.equals(concurrent)); assert.notEqual(first[0], 99);
assert.ok((await speechClip("顺序")).equals(first)); assert.equal(requests, 1);
assert.ok(rows.has(oldKey("顺序")), "old clips remain; no global deletion");
for (const kind of ["provider", "encoding"]) {
  failure = kind;
  await assert.rejects(speechClip("序"), kind === "provider" ? /provider unavailable/ : /isn't WAV/);
  assert.equal(rows.has(speechCacheKey("序")), false, "failed synthesis never cached");
}
failure = "";
assert.ok((await speechClip("序")).length, "failed job removed for a later retry");
assert.ok(rows.has(speechCacheKey("序")));
await speechClip("我们按顺序来。");
assert.equal(usageModels.at(-1), "qwen3-tts-flash");
assert.ok(usageModels.slice(0, -1).every(model => model === "sambert-zhijia-v1"));
const incomplete = Buffer.from(wav); incomplete.writeUInt16LE(3, 20);
assert.throws(() => wavToMp3(incomplete), /complete 16-bit PCM/);
assert.throws(() => wavToMp3(wav.subarray(0, -1)), /complete 16-bit PCM/);
console.log("PASS: concurrent taps, old-cache bypass, replay bytes, provider/encoding failures uncached, retry recovery, actual model usage, unchanged sentence key/path and malformed WAV rejection. ASR is diagnostic only.");
