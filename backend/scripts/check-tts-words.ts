// Fresh/cache listening fixtures through the real service, against LOCAL Docker DB.
// This checks syllable recognition and cache bytes/latency, never acoustic tones.
// cd backend && npx tsx scripts/check-tts-words.ts [words…]
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { pinyin } from "pinyin-pro";
import "dotenv/config";

process.env.DATABASE_URL = "postgresql://vocab:vocab@localhost:5433/vocab?schema=public";
const { prisma } = await import("../src/services/db.js");
const { speechClip, speechCacheKey, wavToMp3 } = await import("../src/services/tts.js");
const { WORD_TTS_MODEL, wordSpeechRate, wordWav } = await import("../src/services/wordTts.js");
const { transcribeAudio } = await import("../src/services/llm.js");
const { env } = await import("../src/lib/env.js");
const words = process.argv.slice(2).length ? process.argv.slice(2) : ["顺", "序", "顺序", "味", "儿", "味道"];
assert.ok(words.every(w => /^\p{Script=Han}{1,4}$/u.test(w)), "Use 1–4 Han characters per word");
const out = fileURLToPath(new URL("../../.playwright-cli/word-audio/zhijia-service/", import.meta.url));
await fs.mkdir(out, { recursive: true });
const syl = (t: string) => pinyin(t.replace(/[^\p{Script=Han}]/gu, ""), { toneType: "num", type: "array" }).join(" ");

async function main() {
  const bad: string[] = [];
  const results: Record<string, unknown>[] = JSON.parse(await fs.readFile(path.join(out, "manifest.json"), "utf8").catch(() => "[]"));
  for (const w of words) {
    const old = results.findIndex(r => r.word === w);
    if (old >= 0) results.splice(old, 1);
    const key = speechCacheKey(w);
    await prisma.ttsClip.deleteMany({ where: { key } }); // only this LOCAL fixture's key
    try {
      const t0 = Date.now();
      const mp3 = await speechClip(w);
      const freshMs = Date.now() - t0;
      await fs.writeFile(path.join(out, `${w}-fresh.mp3`), mp3);
      const cachedAt = Date.now();
      const cached = await speechClip(w), cachedMs = Date.now() - cachedAt;
      await fs.writeFile(path.join(out, `${w}-cached.mp3`), cached);
      assert.ok(cached.equals(mp3), `${w}: cached bytes changed`);
      assert.ok(cachedMs < 1000, `${w}: cache too slow (${cachedMs} ms)`);
      // A second raw take checks the final 48 kHz → 96 kbps encoder separately.
      // Repair WAV length placeholders for browser decoding; do not touch PCM.
      const wav = await wordWav(w), reference = wavToMp3(wav, 96);
      let at = 12;
      while (at + 8 <= wav.length && wav.toString("ascii", at, at + 4) !== "data") {
        const size = wav.readUInt32LE(at + 4); at += 8 + size + size % 2;
      }
      assert.ok(at + 8 <= wav.length, "Expected WAV data chunk");
      const pcm = Buffer.from(wav.subarray(at + 8));
      wav.writeUInt32LE(wav.length - 8, 4); wav.writeUInt32LE(wav.length - at - 8, at + 4);
      assert.ok(pcm.equals(wav.subarray(at + 8)));
      await fs.writeFile(path.join(out, `${w}-reference.wav`), wav);
      await fs.writeFile(path.join(out, `${w}-reference.mp3`), reference);
      const heard = await transcribeAudio({ base64: mp3.toString("base64"), format: "mp3", sourceLang: "zh" });
      const ok = syl(heard) === syl(w);
      const result = { word: w, freshMs, cachedMs, key, bytes: mp3.length, heard, recognizedReadingMatch: ok,
        model: WORD_TTS_MODEL, voice: "Zhijia", synthesisRate: wordSpeechRate(w), sampleRate: 48000, mp3Kbps: 96,
        wav: `${w}-reference.wav`, mp3: `${w}-reference.mp3`,
        provider: new URL(env.BAILIAN_BASE_URL).host, fallback: false, toneVerified: false };
      results.push(result); console.log(JSON.stringify(result));
      // Preserve recognition mismatches as evidence; never treat ASR as an
      // acoustic verdict on the voice accepted in the listening comparison.
      if (!(await prisma.ttsClip.findUnique({ where: { key }, select: { key: true } }))) throw new Error(`${w}: clip not stored under its key`);
    } catch (error) {
      bad.push(w);
      const message = error instanceof Error ? error.message : String(error);
      results.push({ word: w, error: message, toneVerified: false });
      console.error(`${w}: ${message}`);
    }
    await fs.writeFile(path.join(out, "manifest.json"), JSON.stringify(results, null, 2));
  }
  const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  await fs.writeFile(path.join(out, "index.html"), `<!doctype html><meta charset="utf-8"><title>Fresh and cached Mandarin</title>
<style>body{font:18px system-ui;max-width:1000px;margin:auto;padding:24px}article{padding:12px;border-bottom:1px solid #ccc}label{display:inline-block;margin:8px}button{font:inherit;margin:8px}</style>
<h1>Fresh / cached: ${escape(WORD_TTS_MODEL)} / Zhijia</h1><p>Bailian. Single characters: native synthesis rate 1.25; words: 1.0. Playback controls below are independent. Author accepted Zhijia after comparison with a native xu4 reference; ASR and identical bytes alone do not establish tone accuracy.</p>
<p><a href="../Cherry/">Raw / full stop / sentence / WAV versus MP3</a> · <a href="../Serena/">Alternative voice</a></p>
<button onclick="rate(1)">1×</button><button onclick="rate(.75)">0.75× (preserve pitch)</button>
${results.map((r, i) => `<article id="${i + 1}"><b>${i + 1}. ${escape(r.word)}</b> — ${escape(r.error || r.heard)}${r.error ? "" : `<br><label>Fresh <audio controls src="${escape(r.word)}-fresh.mp3"></audio></label><label>Cached <audio controls src="${escape(r.word)}-cached.mp3"></audio></label>`}</article>`).join("\n")}
<script>function rate(r){document.querySelectorAll('audio').forEach(a=>{a.preservesPitch=true;a.webkitPreservesPitch=true;a.playbackRate=r})}document.addEventListener('play',e=>{document.querySelectorAll('audio').forEach(a=>{if(a!==e.target)a.pause()})},true)</script>`);
  if (bad.length) throw new Error(`Provider/cache check failed (ASR is diagnostic only): ${bad.join(", ")}`);
}

main()
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
