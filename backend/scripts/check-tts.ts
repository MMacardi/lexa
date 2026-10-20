// Checks MP3 encoding, DB replay and recognized text through qwen3-asr-flash.
// Recognition does not establish acoustic tone accuracy. Costs a few hundredths
// of a yuan (two short texts, once each). Use the LOCAL development database.
//   cd backend && npx tsx scripts/check-tts.ts
import { speechClip, speechCacheKey, wavToMp3 } from "../src/services/tts.js";
import { transcribeAudio } from "../src/services/llm.js";
import { prisma } from "../src/services/db.js";

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const han = (s: string) => s.replace(/[^\p{Script=Han}]/gu, "");
// An MP3 starts with an ID3 tag or a frame sync (11 set bits).
const isMp3 = (b: Buffer) => b.toString("ascii", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);

// The encoder alone, on a made-up WAV: one second of a 220 Hz tone at 24 kHz.
{
  const rate = 24_000;
  const pcm = Buffer.alloc(rate * 2);
  for (let i = 0; i < rate; i++) pcm.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 220 * i) / rate)), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0, "ascii");
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write("WAVEfmt ", 8, "ascii");
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36, "ascii");
  head.writeUInt32LE(pcm.length, 40);
  const mp3 = wavToMp3(Buffer.concat([head, pcm]));
  check(isMp3(mp3) && mp3.length > 4_000 && mp3.length < 9_000, `1 s tone → MP3 of ${mp3.length} bytes (48 kbps ≈ 6 KB)`);
}

for (const text of ["服务器", "海鸥在头顶盘旋，狭窄的石板街道里弥漫着海盐的味道。"]) {
  const key = speechCacheKey(text);
  await prisma.ttsClip.deleteMany({ where: { key } }); // start from a miss
  let t0 = Date.now();
  const first = await speechClip(text);
  const made = Date.now() - t0;
  check(isMp3(first), `${text}: made in ${made} ms, ${first.length} bytes of MP3`);
  t0 = Date.now();
  const again = await speechClip(text);
  const served = Date.now() - t0;
  check(again.equals(first) && served < 1_000, `${text}: the second play comes from the database (${served} ms)`);
  check((await prisma.ttsClip.count({ where: { key } })) === 1, `${text}: stored once`);
  const heard = await transcribeAudio({ base64: first.toString("base64"), format: "mp3", sourceLang: "zh" });
  check(han(heard) === han(text), `${text}: speech-to-text hears «${heard}»`);
}

await prisma.$disconnect();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
