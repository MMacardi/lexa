// Public-text listening fixtures only; no cache deletion or production DB access.
// cd backend && npx tsx scripts/inspect-tts.ts [voice] [model]
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

// This diagnostic uses only the local development database (encoder/ASR imports).
process.env.DATABASE_URL = "postgresql://vocab:vocab@localhost:5433/vocab?schema=public";
const { env } = await import("../src/lib/env.js");
const { wavToMp3, TTS_MODEL } = await import("../src/services/tts.js");
const { transcribeAudio } = await import("../src/services/llm.js");
const { prisma } = await import("../src/services/db.js");
const voice = process.argv[2] || process.env.BAILIAN_TTS_VOICE || "Cherry";
const model = process.argv[3] || TTS_MODEL;
if (!/^[\w-]+$/.test(voice) || !/^[\w.-]+$/.test(model)) throw new Error("Invalid voice/model label");
const instructions = model.includes("instruct") ? "用标准普通话清晰、自然地朗读输入的字词。保持正常语速，准确读出声母、韵母和声调。只读输入文本，不添加任何其他声音或解释。" : undefined;
const out = fileURLToPath(new URL(`../../.playwright-cli/word-audio/${model === TTS_MODEL ? voice : `${model}-${voice}`}/`, import.meta.url));
await fs.mkdir(out, { recursive: true });
const endpoint = `${new URL(env.BAILIAN_BASE_URL).origin}/api/v1/services/aigc/multimodal-generation/generation`;
const words = ["顺", "序", "顺序", "味", "儿", "味道"];
const sentences = ["祝你一路顺风。", "请按顺序排队。", "我们按顺序来。", "我喜欢这个味。", "他是我的儿子。", "这个菜的味道很好。"];
const fixtures: Record<string, unknown>[] = [];
const previous: Record<string, unknown>[] = JSON.parse(await fs.readFile(path.join(out, "manifest.json"), "utf8").catch(() => "[]"));
try {
  for (const [i, text] of [...words.flatMap(w => [w, `${w}。`]), ...sentences].entries()) {
    const stem = `${String(i + 1).padStart(2, "0")}-${text.replace(/。/g, "-stop")}`;
    const wavFile = path.join(out, `${stem}.wav`), mp3File = path.join(out, `${stem}.mp3`);
    const saved = previous.find(f => f.text === text && f.model === model && f.instructions === instructions);
    if (saved) { fixtures.push(saved); continue; } // resume without paying/transcribing twice
    let wav: Buffer, existing = true;
    try { wav = await fs.readFile(wavFile); } catch {
      existing = false;
      const res = await fetch(endpoint, {
        method: "POST", headers: { Authorization: `Bearer ${env.BAILIAN_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, input: { text, voice, language_type: "Chinese", instructions, ...(instructions ? { optimize_instructions: false } : {}) } }),
        signal: AbortSignal.timeout(30_000),
      });
      const body = await res.json() as { output?: { audio?: { url?: string } }; message?: string };
      if (!res.ok || !body.output?.audio?.url) throw new Error(`TTS ${res.status}: ${body.message}`);
      const audio = await fetch(body.output.audio.url, { signal: AbortSignal.timeout(30_000) });
      if (!audio.ok) throw new Error(`Audio download ${audio.status}`);
      wav = Buffer.from(await audio.arrayBuffer());
      await fs.writeFile(wavFile, wav);
    }
    const mp3 = wavToMp3(wav);
    await fs.writeFile(mp3File, mp3);
    const heard = await transcribeAudio({ base64: mp3.toString("base64"), format: "mp3", sourceLang: "zh" });
    const fixture = { text, model, voice, instructions, provider: new URL(endpoint).host, fallback: false,
      wav: path.basename(wavFile), mp3: path.basename(mp3File), bytes: mp3.length, reusedFixture: existing, heard,
      toneVerified: false };
    fixtures.push(fixture);
    console.log(JSON.stringify(fixture));
    await fs.writeFile(path.join(out, "manifest.json"), JSON.stringify(fixtures, null, 2));
  }
} finally {
  const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const html = `<!doctype html><meta charset="utf-8"><title>Mandarin listening fixtures</title>
<style>body{font:18px system-ui;max-width:1000px;margin:24px auto;padding:12px}article{padding:12px;border-bottom:1px solid #ccc}audio{width:290px}label{display:inline-block;margin:8px}button{font:inherit;margin:8px}</style>
<h1>${model} / ${voice}</h1><p>Bailian, Chinese. Original WAV versus 48 kbps MP3; no carrier or trimming. ASR transcripts do not verify acoustic tones.</p>
<p>Listen for shùn, xù, shùnxù, wèi, ér, wèi dao (CC-CEDICT: wei4 dao5, neutral second syllable): tones, extra syllables, language, onset. Compare isolated/context and both speeds.</p>
<button onclick="rate(1)">1×</button><button onclick="rate(.75)">0.75× (preserve pitch)</button>
${fixtures.map(f => `<article id="${escape(String(f.wav).slice(0, 2))}"><b>${escape(String(f.wav).slice(0, 2))}. ${escape(f.text)}</b> — ASR: ${escape(f.heard)}<br><label>WAV <audio controls preload="none" src="${escape(f.wav)}"></audio></label><label>MP3 <audio controls preload="none" src="${escape(f.mp3)}"></audio></label></article>`).join("\n")}
<script>function rate(r){document.querySelectorAll('audio').forEach(a=>{a.preservesPitch=true;a.webkitPreservesPitch=true;a.playbackRate=r})}document.addEventListener('play',e=>{document.querySelectorAll('audio').forEach(a=>{if(a!==e.target)a.pause()})},true)</script>`;
  await fs.writeFile(path.join(out, "index.html"), html);
  await prisma.$disconnect();
}
