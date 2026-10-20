// Public pronunciation probes; no learner data or production DB operations.
// From backend: npx tsx scripts/inspect-tts-engines.ts [probe|fixtures|recognize|refined|refined-recognize|zhijia-pitch|zhijia-diction]
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import WebSocket from "ws";
const endpoint = `${new URL(process.env.BAILIAN_BASE_URL!).origin.replace(/^http/, "ws")}/api-ws/v1/inference`;
const root = fileURLToPath(new URL("../../.playwright-cli/word-audio/engines/", import.meta.url));
await fs.mkdir(root, { recursive: true });

type Candidate = { model: string; voice: string; id: string; sampleRate?: number; rate?: number; ssml?: boolean };
const readings: Record<string, string> = { "顺": "shun4", "序": "xu4", "顺序": "shun4 xu4", "味": "wei4", "儿": "er2", "味道": "wei4 dao5", "去": "qu4" };
async function synthesize(candidate: Candidate, text: string) {
  const { model, voice } = candidate;
  const useSsml = candidate.ssml && readings[text];
  const input = useSsml ? `<speak><phoneme alphabet="py" ph="${readings[text]}">${text}</phoneme></speak>` : text;
  return new Promise<Buffer>((resolve, reject) => {
    const ws = new WebSocket(endpoint, { headers: { Authorization: `Bearer ${process.env.BAILIAN_API_KEY}` }, handshakeTimeout: 15000 });
    const taskId = randomUUID(), sambert = model.startsWith("sambert"), chunks: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); ws.close();
      if (error) reject(error); else if (!chunks.length) reject(new Error("No audio returned")); else resolve(Buffer.concat(chunks));
    };
    const timer = setTimeout(() => { finish(new Error("Synthesis timeout")); ws.terminate(); }, 25000);
    const send = (action: string, payload: unknown) => ws.send(JSON.stringify({ header: { action, task_id: taskId, streaming: sambert ? "out" : "duplex" }, payload }));
    ws.on("open", () => send("run-task", { task_group: "audio", task: "tts", function: "SpeechSynthesizer", model,
      parameters: { text_type: "PlainText", ...(voice ? { voice } : {}), format: "wav", sample_rate: candidate.sampleRate || (sambert ? 16000 : 24000), volume: 50, rate: candidate.rate || 1, pitch: 1, ...(useSsml ? { enable_ssml: true } : {}) },
      input: sambert ? { text: input } : {} }));
    ws.on("message", (data: Buffer, binary: boolean) => {
      if (binary) { chunks.push(Buffer.from(data)); return; }
      const message = JSON.parse(data.toString());
      const event = message.header?.event;
      if (event === "task-started" && !sambert) {
        send("continue-task", { input: { text: input } }); send("finish-task", { input: {} });
      }
      if (event === "task-finished") finish();
      if (event === "task-failed") finish(new Error(`${message.header?.error_code}: ${message.header?.error_message}`));
    });
    ws.on("error", (error: Error) => finish(error));
    ws.on("close", () => { if (!settled) finish(new Error("Socket closed before task completion")); });
  });
}
const refined = process.argv[2]?.startsWith("refined");
const pitchProbe = process.argv[2] === "zhijia-pitch";
const dictionProbe = process.argv[2] === "zhijia-diction";
const candidates: Candidate[] = dictionProbe ? [
  { model: "sambert-zhijia-v1", voice: "", id: "F1", sampleRate: 48000, rate: 1 },
  { model: "sambert-zhijia-v1", voice: "", id: "H1", sampleRate: 48000, rate: 1, ssml: true },
  { model: "sambert-zhijia-v1", voice: "", id: "H2", sampleRate: 48000, rate: 1.25 },
  { model: "sambert-zhijia-v1", voice: "", id: "H3", sampleRate: 48000, rate: 1.25, ssml: true },
] : pitchProbe ? [
  { model: "sambert-zhijia-v1", voice: "", id: "F1", sampleRate: 48000, rate: 1 },
] : refined ? [
  { model: "sambert-zhiqi-v1", voice: "", id: "E", sampleRate: 48000, rate: 0.9 },
  { model: "sambert-zhijia-v1", voice: "", id: "F", sampleRate: 48000, rate: 0.9 },
  { model: "cosyvoice-v2", voice: "longanpei", id: "G", sampleRate: 24000, rate: 1, ssml: true },
] : [
  { model: "cosyvoice-v2", voice: "longxiaochun_v2", id: "C1" },
  { model: "cosyvoice-v2", voice: "longxiaoxia_v2", id: "C2" },
  { model: "sambert-zhichu-v1", voice: "", id: "S1" },
];
const recognize = process.argv[2] === "recognize" || process.argv[2] === "refined-recognize";
const texts = dictionProbe ? ["序", "顺", "味", "去", "顺序", "味道"] : pitchProbe ? ["序", "顺序", "序。", "顺序。", "虚", "徐", "许", "续", "去"] : process.argv[2] === "fixtures" || recognize || refined ? ["顺", "序", "顺序", "味", "儿", "味道", "我们按顺序来。", "这个菜的味道很好。"] : ["味道"];
const manifest: Record<string, unknown>[] = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8").catch(() => "[]"));
for (const candidate of candidates) {
  if (recognize) continue;
  for (const [i, text] of texts.entries()) {
    const file = `${candidate.id}-${text}.wav`;
    if (manifest.some(f => f.file === file && !f.error)) continue;
    try {
      const start = Date.now(), audio = await synthesize(candidate, text);
      await fs.writeFile(path.join(root, file), audio);
      const row = { ...candidate, text, file, bytes: audio.length, ms: Date.now() - start, provider: new URL(endpoint).host, toneVerified: false };
      const old = manifest.findIndex(f => f.file === file); if (old >= 0) manifest.splice(old, 1);
      manifest.push(row); console.log(JSON.stringify(row));
    } catch (error) {
      const row = { ...candidate, text, file, error: error instanceof Error ? error.message : String(error) };
      manifest.push(row); console.log(JSON.stringify(row));
      break; // no repeated calls to an unavailable model
    }
    await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));
  }
}
if (recognize) {
  process.env.DATABASE_URL = "postgresql://vocab:vocab@localhost:5433/vocab?schema=public";
  const { transcribeAudio } = await import("../src/services/llm.js");
  const { prisma } = await import("../src/services/db.js");
  try {
    for (const fixture of manifest.filter(f => !f.error && candidates.some(c => c.id === f.id) && /^\p{Script=Han}{1,4}$/u.test(String(f.text)))) {
      if (fixture.heard) continue;
      const audio = await fs.readFile(path.join(root, String(fixture.file)));
      fixture.heard = await transcribeAudio({ base64: audio.toString("base64"), format: "wav", sourceLang: "zh" });
      console.log(JSON.stringify({ id: fixture.id, text: fixture.text, heard: fixture.heard, toneVerified: false }));
    }
  } finally { await prisma.$disconnect(); }
}
await fs.writeFile(path.join(root, "manifest.json"), JSON.stringify(manifest, null, 2));
const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
if (dictionProbe) {
  const labels: Record<string, string> = { F1: "A · обычный Zhijia", H1: "B · задан пиньинь с тоном", H2: "C · темп синтеза 1.25", H3: "D · пиньинь + темп 1.25" };
  // Sambert's streaming WAV uses placeholder lengths. Fix only container lengths;
  // retain every PCM sample, including silence, for browser playback.
  for (const f of manifest.filter(f => !f.error && candidates.some(c => c.id === f.id) && texts.includes(String(f.text)))) {
    const wav = await fs.readFile(path.join(root, String(f.file)));
    if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("Expected WAV");
    let offset = 12;
    while (offset + 8 <= wav.length && wav.toString("ascii", offset, offset + 4) !== "data") {
      const size = wav.readUInt32LE(offset + 4);
      offset += 8 + size + (size % 2);
    }
    if (offset + 8 > wav.length) throw new Error("Missing WAV PCM");
    const originalPcm = Buffer.from(wav.subarray(offset + 8));
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.writeUInt32LE(wav.length - offset - 8, offset + 4);
    if (!originalPcm.equals(wav.subarray(offset + 8))) throw new Error("PCM changed");
    await fs.writeFile(path.join(root, `listen-${f.file}`), wav);
  }
  await fs.writeFile(path.join(root, "zhijia-diction.html"), `<!doctype html><meta charset="utf-8"><title>Zhijia: fourth-tone test</title>
<style>body{font:18px system-ui;max-width:1200px;margin:24px auto;padding:12px}.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}article{border-bottom:1px solid #aaa;padding:18px 0}audio{width:100%}small{display:block;font-size:14px}</style>
<h1>Zhijia: отдельные четвёртые тона</h1><p>A — исходный голос при нормальном темпе; B — явный пиньинь и тон; C — темп синтеза 1.25; D — оба изменения. Воспроизведение везде 1×. Все записи — исходный PCM без обрезки и обработки высоты тона. Темп задаётся при синтезе. Приложение пока не изменено.</p>
${texts.map((text, i) => `<article><h2>${i + 1}. ${escape(text)} · ${escape(readings[text])}</h2><div class="row">${candidates.map(c => {
    const f = manifest.find(f => f.id === c.id && f.text === text && !f.error);
    return f ? `<label><b>${i + 1}-${c.id === "F1" ? "A" : c.id === "H1" ? "B" : c.id === "H2" ? "C" : "D"}</b><small>${labels[c.id]}</small><audio controls preload="metadata" src="${escape(`listen-${f.file}`)}"></audio></label>` : `<span>${escape(c.id)}: unavailable</span>`;
  }).join("")}</div></article>`).join("\n")}
<script>document.addEventListener('play',e=>{document.querySelectorAll('audio').forEach(a=>{if(a!==e.target)a.pause()})},true)</script>`);
} else {
await fs.writeFile(path.join(root, pitchProbe ? "zhijia-pitch.html" : refined ? "refined.html" : "index.html"), `<!doctype html><meta charset="utf-8"><title>Word pronunciation systems</title>
<style>body{font:18px system-ui;max-width:1250px;margin:24px auto;padding:12px}article{padding:12px;border-bottom:1px solid #ccc}.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(245px,1fr));gap:12px}audio{width:100%;max-width:280px}button{font:inherit;margin:8px}label{display:block}small{display:block;font-size:13px}</style>
<h1>Другие системы: отдельные слова</h1><p>${pitchProbe ? "F1 — Zhijia, native 48 kHz, synthesis rate 1.0, pitch 1.0. Tone controls and punctuation comparison; no processing." : refined ? "A — текущая Cherry; E — Zhiqi, мягкий женский голос; F — Zhijia, стандартный женский голос; E/F записаны в 48 кГц с темпом 0.9. G — CosyVoice Anpei, голос для обучения с явно заданными словарными фонемами. 味道 задано как wei4 dao5 по CC-CEDICT." : "A — текущая Cherry; B — CosyVoice / Xiaochun; C — CosyVoice / Xiaoxia; D — Sambert / Zhichu."} У новых систем исходный WAV, без обрезки, дополнительных фраз и изменения высоты тона. Это кандидаты для прослушивания; в приложение пока не включены.</p>
<button onclick="rate(1)">1×</button><button onclick="rate(.75)">0.75×</button>
${texts.map((text, i) => `<article><h2>${i + 1}. ${escape(text)}</h2><div class="row">${!pitchProbe && i < 6 ? `<label><b>${i + 1}-A · Cherry</b><small>Текущий образец для сравнения</small><audio controls preload="none" src="../service/${escape(text)}-fresh.mp3"></audio></label>` : ""}${candidates.map((c, j) => { const f = manifest.find(f => f.id === c.id && f.text === text && !f.error); return f ? `<label><b>${i + 1}-${refined || pitchProbe ? c.id : "BCD"[j]} · ${escape(c.voice || c.model.replace("sambert-", "").replace("-v1", ""))}</b><small>${escape(c.model)}</small><audio controls preload="none" src="${escape(f.file)}"></audio></label>` : ""; }).join("")}</div></article>`).join("\n")}
<script>function rate(r){document.querySelectorAll('audio').forEach(a=>{a.preservesPitch=true;a.webkitPreservesPitch=true;a.playbackRate=r})}document.addEventListener('play',e=>{document.querySelectorAll('audio').forEach(a=>{if(a!==e.target)a.pause()})},true)</script>`);
}
