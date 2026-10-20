import { createHash } from "node:crypto";
import { Mp3Encoder } from "@breezystack/lamejs";
import { env } from "../lib/env.js";
import { prisma } from "./db.js";
import { currentUserId } from "../lib/usageContext.js";
import { WORD_TTS_MODEL, wordSpeechRate, wordWav } from "./wordTts.js";

// Chinese read aloud by Bailian's voice instead of the browser's: on Windows the
// browser's Chinese voice is the robotic Huihui, and some Android phones have none.
// Sentences use Qwen/Cherry; short dictionary words use Sambert/Zhijia. Both use
// the existing Bailian key. Accepted clips are stored as MP3 for later plays.
export const TTS_MODEL = process.env.BAILIAN_TTS_MODEL || "qwen3-tts-flash";
export const TTS_VOICE = process.env.BAILIAN_TTS_VOICE || "Cherry";
export const TTS_MAX_CHARS = 300; // the API takes 600; a word or a sentence is far below
const MP3_KBPS = 48; // speech at 24 kHz mono: ~6 KB a second instead of WAV's 48

// The native DashScope endpoint lives on the same host as the OpenAI-compatible one
// (Beijing or Singapore, whichever BAILIAN_BASE_URL points at).
const ENDPOINT = () => `${new URL(env.BAILIAN_BASE_URL).origin}/api/v1/services/aigc/multimodal-generation/generation`;

// Author listening preferred Zhijia's dictionary delivery after comparison with
// a native xu4 recording. Single characters use its shorter 1.25 synthesis rate;
// multi-character words use 1.0. No punctuation/carrier, trimming, or pitch edits.
const SHORT = /^\p{Script=Han}{1,4}$/u;
// v3 retires Cherry short clips and includes the word model/rate/encoding policy.
// frontend/lib/api.ts also versions their URLs: browsers keep MP3s for a year.
export const speechCacheKey = (text: string) =>
  createHash("sha256")
    .update(SHORT.test(text) ? `${WORD_TTS_MODEL}|${wordSpeechRate(text)}|dictionary-v3|mp3-96|${text}` : `${TTS_MODEL}|${TTS_VOICE}|${text}`)
    .digest("hex");

// Two taps on the same new word while it is being made share one synthesis.
const pending = new Map<string, Promise<Buffer>>();

/** The MP3 of `text` read in Mandarin: stored if anyone played it before, made now if not. */
export async function speechClip(text: string): Promise<Buffer> {
  const key = speechCacheKey(text);
  const hit = await prisma.ttsClip.findUnique({ where: { key }, select: { mp3: true } });
  if (hit) return Buffer.from(hit.mp3);
  let job = pending.get(key);
  if (!job) {
    job = (SHORT.test(text) ? synthesizeWord(text) : synthesize(text))
      .then(async mp3 => {
        // A second server instance may have stored it meanwhile; theirs is as good.
        await prisma.ttsClip.create({ data: { key, mp3: new Uint8Array(mp3), chars: text.length } }).catch(() => {});
        return mp3;
      })
      .finally(() => pending.delete(key));
    pending.set(key, job);
  }
  return job;
}

// ASR remains a diagnostic: it calls the reviewed isolated xu4 "戏" even in raw
// WAV, so it must not replace that audio with a browser voice or certify tones.
async function synthesizeWord(word: string): Promise<Buffer> {
  const started = Date.now();
  const mp3 = wavToMp3(await wordWav(word), 96);
  logTts(WORD_TTS_MODEL, word.length, Date.now() - started);
  return mp3;
}

async function synthesize(text: string): Promise<Buffer> {
  if (!env.BAILIAN_API_KEY) throw new Error("BAILIAN_API_KEY is not set — add it to backend/.env");
  const t0 = Date.now();
  const res = await fetch(ENDPOINT(), {
    method: "POST",
    headers: { Authorization: `Bearer ${env.BAILIAN_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: TTS_MODEL, input: { text, voice: TTS_VOICE, language_type: "Chinese" } }),
    signal: AbortSignal.timeout(30_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    output?: { audio?: { url?: string } };
    usage?: { characters?: number };
    message?: string;
  };
  const url = body.output?.audio?.url;
  if (!res.ok || !url) throw new Error(`TTS failed (${res.status}): ${body.message ?? "no audio"}`);
  // The answer is a link to a WAV (24 kHz, 16-bit mono) that expires in a day.
  const wav = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!wav.ok) throw new Error(`TTS audio download failed (${wav.status})`);
  const mp3 = wavToMp3(Buffer.from(await wav.arrayBuffer()));
  logTts(TTS_MODEL, body.usage?.characters ?? text.length, Date.now() - t0);
  return mp3;
}

// Same row shape as llm.ts logUsage, so the admin dashboard counts the voice's cost:
// characters stand in for prompt tokens (pricing.ts prices them per character).
function logTts(model: string, chars: number, ms: number) {
  console.log(`[llm usage] tts chars=${chars} ms=${ms}`);
  void prisma.tokenUsage
    .create({
      data: { feature: "tts", model, kind: "tts", promptTokens: chars, totalTokens: chars, ms, telegramId: currentUserId() },
    })
    .catch(() => {});
}

/** 16-bit PCM WAV → mono MP3. Reads the chunks rather than assuming a 44-byte header. */
export function wavToMp3(wav: Buffer, kbps = MP3_KBPS): Buffer {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("TTS audio isn't WAV");
  let channels = 0;
  let rate = 0;
  let bits = 0;
  let format = 0;
  let pcm: Buffer | null = null;
  for (let at = 12; at + 8 <= wav.length; ) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    const start = at + 8;
    if (id === "fmt ") {
      if (size < 16 || start + 16 > wav.length) throw new Error("TTS audio has an invalid WAV format");
      format = wav.readUInt16LE(start);
      channels = wav.readUInt16LE(start + 2);
      rate = wav.readUInt32LE(start + 4);
      bits = wav.readUInt16LE(start + 14);
    } else if (id === "data") {
      // A streamed WAV can carry a 0 or 0xFFFFFFFF size: the data is the rest of the file.
      const end = size && start + size <= wav.length ? start + size : wav.length;
      pcm = wav.subarray(start, end);
      break;
    }
    at = start + size + (size % 2);
  }
  if (!pcm?.length || format !== 1 || bits !== 16 || channels < 1 || channels > 2 || !rate || pcm.length % (2 * channels)) throw new Error("TTS audio isn't complete 16-bit PCM");
  const frames = Math.floor(pcm.length / (2 * channels));
  const mono = new Int16Array(frames);
  for (let i = 0; i < frames; i++) mono[i] = pcm.readInt16LE(i * 2 * channels); // first channel
  const enc = new Mp3Encoder(1, rate, kbps);
  const out: Uint8Array[] = [];
  for (let i = 0; i < mono.length; i += 1152) {
    const chunk = enc.encodeBuffer(mono.subarray(i, i + 1152));
    if (chunk.length) out.push(new Uint8Array(chunk));
  }
  const tail = enc.flush();
  if (tail.length) out.push(new Uint8Array(tail));
  return Buffer.concat(out);
}
