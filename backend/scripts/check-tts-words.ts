// Short words read aloud come out as the word (services/tts.ts heardWord).
//
// The voice slips on a word on its own — 味 with extra syllables, 儿 as "Are we?",
// 味道 as 那道 — and a clip is made once and kept, so one bad take stayed for
// everyone. This makes each word's clip afresh (its stored copy deleted first) and
// has the ASR hear it back. Costs a few fen of Bailian per run.
//   cd backend && npx tsx scripts/check-tts-words.ts [words…]
import { createHash } from "node:crypto";
import { pinyin } from "pinyin-pro";
import { prisma } from "../src/services/db.js";
import { speechClip, TTS_MODEL } from "../src/services/tts.js";
import { transcribeAudio } from "../src/services/llm.js";

const words = process.argv.slice(2).length ? process.argv.slice(2) : ["儿", "味", "味道"];
const syl = (t: string) => pinyin(t.replace(/[^\p{Script=Han}]/gu, ""), { toneType: "none", type: "array" }).join(" ");

async function main() {
  const bad: string[] = [];
  for (const w of words) {
    const key = createHash("sha256").update(`${TTS_MODEL}|${process.env.BAILIAN_TTS_VOICE || "Cherry"}|heard|${w}`).digest("hex");
    await prisma.ttsClip.deleteMany({ where: { key } });
    const t0 = Date.now();
    const mp3 = await speechClip(w);
    const heard = await transcribeAudio({ base64: mp3.toString("base64"), format: "mp3", sourceLang: "zh" });
    const ok = syl(heard) === syl(w);
    console.log(`${w}: ${mp3.length} bytes in ${Date.now() - t0} ms, heard ${JSON.stringify(heard)} ${ok ? "ok" : "WRONG"}`);
    if (!ok) bad.push(w);
    if (!(await prisma.ttsClip.findUnique({ where: { key }, select: { key: true } }))) throw new Error(`${w}: clip not stored under its key`);
  }
  if (bad.length) throw new Error(`read wrong: ${bad.join(", ")}`);
}

main()
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
