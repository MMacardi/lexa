import { createHash } from "node:crypto";
import { Mp3Encoder } from "@breezystack/lamejs";
import { env } from "../lib/env.js";
import { prisma } from "./db.js";
import { currentUserId } from "../lib/usageContext.js";

// Chinese read aloud by Bailian's voice instead of the browser's: on Windows the
// browser's Chinese voice is the robotic Huihui, and some Android phones have none.
// Each text is synthesised once (¥0.8 per 10,000 characters, verified 2026-10-10 at
// help.aliyun.com/zh/model-studio/qwen3-tts-flash), stored as MP3 (TtsClip), and
// every later play by anyone is a DB read — a browser-cache hit after that.
export const TTS_MODEL = process.env.BAILIAN_TTS_MODEL || "qwen3-tts-flash";
const TTS_VOICE = process.env.BAILIAN_TTS_VOICE || "Cherry"; // standard Mandarin, female
export const TTS_MAX_CHARS = 300; // the API takes 600; a word or a sentence is far below
const MP3_KBPS = 48; // speech at 24 kHz mono: ~6 KB a second instead of WAV's 48

// The native DashScope endpoint lives on the same host as the OpenAI-compatible one
// (Beijing or Singapore, whichever BAILIAN_BASE_URL points at).
const ENDPOINT = () => `${new URL(env.BAILIAN_BASE_URL).origin}/api/v1/services/aigc/multimodal-generation/generation`;

const keyOf = (text: string) => createHash("sha256").update(`${TTS_MODEL}|${TTS_VOICE}|${text}`).digest("hex");

// Two taps on the same new word while it is being made share one synthesis.
const pending = new Map<string, Promise<Buffer>>();

/** The MP3 of `text` read in Mandarin: stored if anyone played it before, made now if not. */
export async function speechClip(text: string): Promise<Buffer> {
  const key = keyOf(text);
  const hit = await prisma.ttsClip.findUnique({ where: { key }, select: { mp3: true } });
  if (hit) return Buffer.from(hit.mp3);
  let job = pending.get(key);
  if (!job) {
    job = synthesize(text)
      .then(async (mp3) => {
        // A second server instance may have stored it meanwhile; theirs is as good.
        await prisma.ttsClip.create({ data: { key, mp3: new Uint8Array(mp3), chars: text.length } }).catch(() => {});
        return mp3;
      })
      .finally(() => pending.delete(key));
    pending.set(key, job);
  }
  return job;
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
  logTts(body.usage?.characters ?? text.length, Date.now() - t0);
  return mp3;
}

// Same row shape as llm.ts logUsage, so the admin dashboard counts the voice's cost:
// characters stand in for prompt tokens (pricing.ts prices them per character).
function logTts(chars: number, ms: number) {
  console.log(`[llm usage] tts chars=${chars} ms=${ms}`);
  void prisma.tokenUsage
    .create({
      data: { feature: "tts", model: TTS_MODEL, kind: "tts", promptTokens: chars, totalTokens: chars, ms, telegramId: currentUserId() },
    })
    .catch(() => {});
}

/** 16-bit PCM WAV → mono MP3. Reads the chunks rather than assuming a 44-byte header. */
export function wavToMp3(wav: Buffer): Buffer {
  if (wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("TTS audio isn't WAV");
  let channels = 1;
  let rate = 24_000;
  let bits = 16;
  let pcm: Buffer | null = null;
  for (let at = 12; at + 8 <= wav.length; ) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    const start = at + 8;
    if (id === "fmt ") {
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
  if (!pcm || bits !== 16) throw new Error("TTS audio isn't 16-bit PCM");
  const frames = Math.floor(pcm.length / (2 * channels));
  const mono = new Int16Array(frames);
  for (let i = 0; i < frames; i++) mono[i] = pcm.readInt16LE(i * 2 * channels); // first channel
  const enc = new Mp3Encoder(1, rate, MP3_KBPS);
  const out: Uint8Array[] = [];
  for (let i = 0; i < mono.length; i += 1152) {
    const chunk = enc.encodeBuffer(mono.subarray(i, i + 1152));
    if (chunk.length) out.push(new Uint8Array(chunk));
  }
  const tail = enc.flush();
  if (tail.length) out.push(new Uint8Array(tail));
  return Buffer.concat(out);
}
