// The HSK list's readings (data/hskWords.ts), which the check, the daily words,
// the lists and the Reader all show. The list once took each word's first
// CC-CEDICT reading, alphabetical, so 听 was "yǐn", 说 "shuì" and 便宜 "biàn yí".
// This pins the words a learner meets first, checks how every reading is written,
// then scans the whole list against pinyin-pro: a word where the two differ in more
// than a dictionary neutral tone must be one somebody checked by hand, in
// scripts/hsk-readings.mjs (the list is corrected there) or LIST_IS_RIGHT below.
// A re-run of build-hsk-lists.mjs or a pinyin-pro upgrade that moves a reading
// fails here until someone looks.
//
// No database, no model.
//   cd backend && npx tsx scripts/check-hsk-readings.ts

const { HSK_WORDS } = await import("../src/data/hskWords.js");
const { READINGS } = (await import("./hsk-readings.mjs")) as { READINGS: Record<string, string> };
const { pinyin } = await import("pinyin-pro");

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const list = new Map<string, string>();
for (const line of HSK_WORDS.split("\n")) {
  const [word, reading] = line.split("\t");
  list.set(word, reading);
}

// 1. The words from the bug report, and the ones pinyin-pro alone would get wrong.
const PINNED: Record<string, string> = {
  听: "tīng", 说: "shuō", 读: "dú", 行: "xíng", 都: "dōu", 还: "hái", 页: "yè", 万: "wàn", 句: "jù",
  提: "tí", 离: "lí", 骑: "qí", 鸟: "niǎo", 厂: "chǎng", 胖: "pàng", 追: "zhuī", 便宜: "pián yi",
  了: "le", 地: "de", 只: "zhǐ", 着: "zhe", 长: "cháng", 教: "jiāo", 东西: "dōng xi", 一会儿: "yī huì r",
  有空儿: "yǒu kòng r", 策略: "cè lüè", 女儿: "nǚ ér", 电动车: "diàn dòng chē",
};
const wrong = Object.entries(PINNED).filter(([w, p]) => list.get(w) !== p);
check(wrong.length === 0, `${Object.keys(PINNED).length} pinned readings${wrong.length ? `: ${wrong.map(([w, p]) => `${w} ${list.get(w)} (want ${p})`).join(", ")}` : ""}`);

// 2. How it's written: tone marks (no numbers, no CC-CEDICT "u:"), each on the
// vowel pinyin puts it on, and one space per syllable with erhua as its own "r".
const MARK = /[̀́̄̌]/;
function markOk(syl: string): boolean {
  const chars = [...syl.normalize("NFC")];
  const at = chars.findIndex((c) => MARK.test(c.normalize("NFD")));
  if (at < 0) return true;
  if (chars.filter((c) => MARK.test(c.normalize("NFD"))).length > 1) return false;
  const base = chars.map((c) => c.normalize("NFD").replace(new RegExp(MARK, "g"), "").normalize("NFC").toLowerCase()).join("");
  // a or e takes the mark; in "ou" the o does; otherwise the last vowel.
  let want = base.search(/[ae]/);
  if (want < 0) want = base.indexOf("ou");
  if (want < 0) for (let i = 0; i < base.length; i++) if ("iouü".includes(base[i])) want = i;
  return at === want;
}
const syllablesOf = (w: string) =>
  pinyin(w, { toneType: "num", type: "array", toneSandhi: false }).map((s) => s.toLowerCase().replace(/ü/g, "v"));

const badChars: string[] = [];
const badMarks: string[] = [];
const badSpacing: string[] = [];
for (const [w, p] of list) {
  if (!p || /[0-9:˙]/.test(p)) badChars.push(`${w} ${p}`);
  if (!p.split(" ").every(markOk)) badMarks.push(`${w} ${p}`);
  if (p.split(" ").length !== syllablesOf(w).length) badSpacing.push(`${w} ${p}`);
}
check(badChars.length === 0, `no tone numbers, "u:" or empty readings${badChars.length ? `: ${badChars.slice(0, 12).join(", ")}` : ""}`);
check(badMarks.length === 0, `tone marks on the right vowel${badMarks.length ? `: ${badMarks.slice(0, 12).join(", ")}` : ""}`);
check(badSpacing.length === 0, `one space per syllable${badSpacing.length ? ` (${badSpacing.length}): ${badSpacing.slice(0, 12).join(", ")}` : ""}`);

// 3. The scan. The list's reading as numbered syllables, to set against pinyin-pro's.
const TONE: Record<string, number> = { "̄": 1, "́": 2, "̌": 3, "̀": 4 };
function numbered(p: string): string[] {
  return p.split(" ").map((syl) => {
    const d = syl.normalize("NFD").toLowerCase();
    const tone = [...d].map((c) => TONE[c]).find(Boolean) ?? 0;
    return d.replace(/[̀́̄̌]/g, "").normalize("NFC").replace(/ü/g, "v") + tone;
  });
}

// Words where the list and pinyin-pro disagree and the list is right, checked by
// hand against 现代汉语词典 and the official HSK 3.0 pinyin (see hsk-readings.mjs).
const LIST_IS_RIGHT = new Set(
  [
    // A reading pinyin-pro doesn't know in this word, or gives for another sense.
    "剥夺 朝三暮四 处长 穿着 船长 都会 嗨 还款 湖泊 局长 卡子 率先 秘书长 排行榜 商贾 呜咽 一行 一言一行",
    "用不着 用得着 有朝一日 粘 粘贴 重组 谁 谁知道 眼里 了 只",
    // A full tone where pinyin-pro reads a neutral one, or another tone of the same syllable.
    "挨打 变为 抽空 处在 揣测 揣摩 粗心大意 大大咧咧 逮捕 待会儿 倒计时 反倒 肝脏 供暖 豁达 假日 卷入 理发",
    "列为 遛 麻将 呕吐 千钧一发 请帖 忍饥挨饿 少林寺 舍不得 实际上 视为 说干就干 踏实 泰斗 挑起 网吧 相片",
    "心脏 心脏病 一应俱全 尤为 油炸 载体 知识分子 只得 种植 钻空子",
  ].flatMap((s) => s.split(" ")),
);

const unreviewed: string[] = [];
let differ = 0;
for (const [w, p] of list) {
  const ours = numbered(p);
  const theirs = syllablesOf(w);
  const same =
    ours.length === theirs.length &&
    ours.every((s, i) => {
      const t = theirs[i];
      if (s === t) return true;
      // The erhua r (一会儿 yī huì r), which pinyin-pro reads as a syllable er.
      if (s === "r0" && i === ours.length - 1 && /^er[02]$/.test(t)) return true;
      // A neutral tone where pinyin-pro has a full one is the dictionary's (好处 hǎo chu).
      return s.endsWith("0") && s.slice(0, -1) === t.slice(0, -1);
    });
  if (same) continue;
  differ++;
  if (!(w in READINGS) && !LIST_IS_RIGHT.has(w)) unreviewed.push(`${w} ${p} (pinyin-pro: ${pinyin(w, { toneSandhi: false })})`);
}
check(
  unreviewed.length === 0,
  `${differ} of ${list.size} words differ from pinyin-pro, all checked by hand${unreviewed.length ? ` — not yet (${unreviewed.length}):\n  ${unreviewed.join("\n  ")}` : ""}`,
);

// 4. Every hand-checked word is still on the list (a stale entry hides nothing, but misleads).
const stale = [...Object.keys(READINGS), ...LIST_IS_RIGHT].filter((w) => !list.has(w));
check(stale.length === 0, `hand-checked words are all on the list${stale.length ? `: ${stale.join(" ")}` : ""}`);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
