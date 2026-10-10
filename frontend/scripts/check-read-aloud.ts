// Regression guard for read-aloud feedback (lib/pronounce.ts compareRead): each word
// of the sentence came through, was heard as something else (shown with the pinyin
// of what was heard), or was missing from the recording. Sentences are pre-cut with
// "|" so the check doesn't depend on a segmenter. The first case is the 2026-10-10
// screenshot: 海鸥 read so that the recogniser wrote 好后, and the recording stopped
// at 石板.
//
// Run: npx tsx scripts/check-read-aloud.ts

import { compareRead, type ReadStatus } from "../lib/pronounce";

let failures = 0;
const toks = (cut: string) => cut.split("|").map((text) => ({ text, wordLike: /[\p{L}\p{N}]/u.test(text) }));

async function check(name: string, cut: string, heard: string, want: Record<string, ReadStatus | [ReadStatus, string]>, understood?: number) {
  const r = await compareRead(toks(cut), heard);
  const bad: string[] = [];
  for (const [word, w] of Object.entries(want)) {
    const [status, heardPinyin] = Array.isArray(w) ? w : [w, undefined];
    const got = r.words.find((x) => x.text === word);
    if (!got) bad.push(`${word}: not a word`);
    else if (got.status !== status) bad.push(`${word}: ${got.status}, want ${status}`);
    else if (heardPinyin !== undefined && got.heardPinyin !== heardPinyin) bad.push(`${word}: heard ${got.heardPinyin}, want ${heardPinyin}`);
  }
  if (understood !== undefined && r.understood !== understood) bad.push(`understood ${r.understood}, want ${understood}`);
  const shown = r.words
    .filter((w) => w.status && w.status !== "ok")
    .map((w) => `${w.text}${w.status === "missed" ? " (missed)" : ` ${w.pinyin} → ${w.heard} ${w.heardPinyin}`}`)
    .join("; ");
  console.log(`${bad.length ? "FAIL" : "ok  "} ${name}: ${r.understood}/${r.total}${shown ? ` — ${shown}` : ""}`);
  if (bad.length) {
    console.log(`     ${bad.join("\n     ")}`);
    failures++;
  }
}

async function main() {
  await check(
    "screenshot",
    "清晨|的|小城|慢慢|醒来|。|渔民|在|修补|渔网|，|海鸥|在|头顶|盘旋|，|狭窄|的|石板|街道|里|久久|弥漫|着|海盐|的|味道|。",
    "清晨的小城慢慢醒来，渔民在修补渔网，好后在到近旁选，狭窄的石板。",
    {
      清晨: "ok",
      渔网: "ok",
      海鸥: ["misheard", "hǎo hòu"],
      头顶: "misheard",
      盘旋: "misheard",
      石板: "ok",
      街道: "missed",
      味道: "missed",
    },
  );
  // A wrong tone that makes another word is caught, with the tone it was heard in.
  await check("tone", "他|在|买|东西|。", "他在卖东西。", { 买: ["misheard", "mài"], 东西: "ok" }, 3);
  // A homophone in the same tones is the word said right.
  await check("homophone", "我们|去|公园|。", "我们去公元。", { 公园: "ok" }, 3);
  // Polyphones read in context on both sides (银行 háng) match.
  await check("polyphone", "我|去|银行|取|钱|。", "我去银行取钱。", { 银行: "ok" }, 5);
  // A filler before the sentence changes nothing.
  await check("filler", "我|去|银行|。", "嗯，我去银行。", { 我: "ok", 银行: "ok" }, 3);
  // The recording stopped early: the rest is missing, not misheard.
  await check("cut short", "我|今天|很|高兴|。", "我今天", { 今天: "ok", 很: "missed", 高兴: "missed" }, 2);
  // Nothing heard at all.
  await check("silence", "我|今天|很|高兴|。", "", { 我: "missed", 高兴: "missed" }, 0);
  // A syllable swallowed inside a word.
  await check("half a word", "我|喜欢|图书馆|。", "我喜欢图书。", { 喜欢: "ok", 图书馆: "misheard" }, 2);
}

main().then(() => {
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
});
