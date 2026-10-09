// Proves topic words behave (BACKLOG "Topic words beside the exam words", "Your
// field without asking again").
//
// Claims, each easy to break quietly:
//   1. ranking — the learner's own text first, then words made of characters they
//      know; nothing they have, nothing the exam track already brings;
//   2. the day — three a day, a word taken today stays in the offer as "added",
//      a word they had or said they knew never shows;
//   3. the fields are the interests: split from the coach memory; the day goes
//      round them (2 + 1, then 1 + 2); a field run dry lends its slot; turned off
//      stays off, with no model call;
//   4. (--live) interests with no words yet become words on the first load, both
//      fields, and the reload makes no second call; "More words" brings words the
//      pool didn't hold, none of them HSK ≤ target.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-topic.ts [--live]
import { Prisma } from "@prisma/client";
import { prisma } from "../src/services/db.js";
import {
  clearTopic,
  coveredByLevel,
  dayNumber,
  moreTopicWords,
  rankTopicWords,
  setTopics,
  slotTopics,
  splitInterests,
  topicDaily,
  type TopicWord,
} from "../src/services/topic.js";
import { hskTagFor } from "../src/services/hsk.js";
import { deleteAccount } from "../src/services/accountData.js";

const TG = `test-topic-${Date.now()}`;
const LIVE = process.argv.includes("--live");
const fails: string[] = [];
const c = (word: string) => ({ word, pinyin: "", meaning: "m" });
const pool = (words: string) =>
  Array.from(words.split(",")).map((word): TopicWord => ({ word, pinyin: "", meaning: "m", fromText: false, known: 1, hsk: null }));
const show = (day: Awaited<ReturnType<typeof topicDaily>>) => day.words.map((w) => `${w.word}${w.added ? "+" : ""}`).join(",");

function checkRanking() {
  const text = "我们用算法训练模型。模型越大，算法越重要。参数很多。";
  const ranked = rankTopicWords(
    [c("芯片"), c("参数"), c("模型"), c("算法"), c("数据"), c("网络"), c("神经元"), c("算"), c("芯片"), c("hello"), c("电脑")],
    {
      have: new Set(["电脑"]),
      knownChars: new Set(Array.from("数据参算法模型网络")),
      text,
      hskLevelOf: (w) => ({ 数据: 3, 网络: 4, 模型: 5 })[w] ?? null,
      covered: (w) => ["数据", "网络"].includes(w),
    },
  ).map((w) => w.word);
  // Text words by count (模型 2, 算法 2, 参数 1), then all-known 数据? no — 数据 is
  // HSK 3 ≤ 4, dropped; 网络 HSK 4, dropped; then 芯片 (unknown chars), 神经元.
  const want = ["模型", "算法", "参数", "芯片", "神经元"];
  if (ranked.join(",") !== want.join(",")) fails.push(`ranking: got ${ranked.join(",")}, want ${want.join(",")}`);

  // Covered by the level, on the real lists. 火车 is HSK 1 on 3.0 and off 2.0: a
  // beginner's word for a 2.0 HSK 4 learner all the same. 高铁 is 3.0 HSK 4: the
  // 3.0 track brings it, the 2.0 one never does, so it's a travel word there.
  const cases: [string, "2.0" | "3.0", number, boolean][] = [
    ["火车", "2.0", 4, true],
    ["火车", "3.0", 4, true],
    ["高铁", "2.0", 4, false],
    ["高铁", "3.0", 4, true],
    ["高铁", "2.0", 3, false],
    ["算法", "2.0", 4, false],
    ["数据", "2.0", 4, false], // 2.0 HSK 5, 3.0 HSK 4: neither at-or-below on theirs nor below on the other
    ["数据", "3.0", 4, true],
  ];
  for (const [w, v, target, want] of cases) {
    if (coveredByLevel(w, v, target) !== want) fails.push(`covered ${w} on ${v} at HSK ${target}: ${!want}, want ${want}`);
  }
}

function checkPure() {
  const split = splitInterests(" Технологии и IT, Игры и аниме，旅行、технологии и it\n\n");
  if (split.join("|") !== "Технологии и IT|Игры и аниме|旅行") fails.push(`split: ${split.join("|")}`);
  const rot = (n: number, day: number) => slotTopics("ABCDE".slice(0, n).split(""), day).join("");
  const want: [number, number, string][] = [[1, 0, "AAA"], [2, 0, "ABA"], [2, 1, "BAB"], [3, 5, "ABC"], [5, 0, "ABC"], [5, 1, "DEA"], [5, 2, "BCD"]];
  for (const [n, day, s] of want) if (rot(n, day) !== s) fails.push(`slots ${n} fields day ${day}: ${rot(n, day)}, want ${s}`);
}

async function checkDay() {
  const user = await prisma.user.create({ data: { telegramId: TG, firstName: "Topic", hskVersion: "3.0", hskTarget: 4, nativeLang: "ru" } });
  await prisma.coachMemory.create({ data: { userId: user.id, lang: "zh", interests: "AI" } });
  await prisma.user.update({ where: { id: user.id }, data: { topicPool: { AI: pool("算法,神经元,参数,芯片,算力,推理,显卡") } } });
  let day = await topicDaily(TG);
  if (show(day) !== "算法,神经元,参数") fails.push(`day 1: ${show(day)}`);
  if (day.left !== 4) fails.push(`day 1 left ${day.left}, want 4`);
  if (!day.words.every((w) => w.topic === "AI")) fails.push("day 1: words not labelled with their field");

  // Take 算法 today, said-known 神经元, and an old card for 参数 from last week.
  await prisma.word.create({ data: { userId: user.id, word: "算法", sourceLang: "zh", targetLang: "ru", meaningZh: "алгоритм" } });
  await prisma.placementAnswer.create({ data: { userId: user.id, word: "神经元", sourceLang: "zh", targetLang: "ru", known: true } });
  await prisma.word.create({
    data: { userId: user.id, word: "参数", sourceLang: "zh", targetLang: "ru", meaningZh: "параметр", createdAt: new Date(Date.now() - 7 * 86400_000) },
  });
  day = await topicDaily(TG);
  if (show(day) !== "算法+,芯片,算力") fails.push(`after taking/knowing: ${show(day)}, want 算法+,芯片,算力`);
  if (day.left !== 2) fails.push(`after: left ${day.left}, want 2`);
}

async function checkFields() {
  // Two fields: today's slots go round them; a field run dry lends its slot.
  await setTopics(TG, ["AI", "Travel"]);
  await prisma.user.update({
    where: { telegramId: TG },
    data: { topicPool: { AI: pool("算法,芯片,算力,推理"), Travel: pool("签证,行李,登机") } },
  });
  const slots = slotTopics(["AI", "Travel"], dayNumber());
  const day = await topicDaily(TG);
  const byField = day.words.map((w) => w.topic).join(",");
  if (byField !== slots.join(",")) fails.push(`two fields: ${show(day)} from ${byField}, want slots ${slots.join(",")}`);
  const ai = day.words.filter((w) => w.topic === "AI").map((w) => w.word);
  if (ai[0] !== "算法" || (ai[1] && ai[1] !== "芯片")) fails.push(`two fields: AI words ${ai.join(",")}`);

  await prisma.user.update({ where: { telegramId: TG }, data: { topicPool: { AI: pool("算法,芯片,算力,推理"), Travel: [] } } });
  const dry = await topicDaily(TG);
  if (show(dry) !== "算法+,芯片,算力") fails.push(`a dry field doesn't lend its slot: ${show(dry)} (${dry.words.map((w) => w.topic).join(",")})`);

  // Turned off stays off, interests kept — no model call (the pools are there anyway).
  await clearTopic(TG);
  const off = await topicDaily(TG);
  if (off.on || off.words.length) fails.push(`off: on=${off.on}, ${off.words.length} words`);
  if (off.topics.join("|") !== "AI|Travel") fails.push(`off: topics ${off.topics.join("|")}`);
  await setTopics(TG, ["AI", "Travel"]);
  if (!(await topicDaily(TG)).on) fails.push("picking fields didn't turn it back on");
}

// A pool listed before the level rule (or before a level change) still holds 火车:
// the day skips what the level covers. 2.0 HSK 4: 火车 is 3.0 HSK 1, 签证 2.0 HSK 4,
// 护照 2.0 HSK 3 — all out; 高铁 (3.0 HSK 4, off 2.0) and 登机 stay.
async function checkCoveredDay() {
  await setTopics(TG, ["Travel"]);
  await prisma.user.update({ where: { telegramId: TG }, data: { hskVersion: "2.0", topicPool: { Travel: pool("火车,高铁,签证,护照,登机") } } });
  const day = await topicDaily(TG);
  if (show(day) !== "高铁,登机" || day.left !== 0) fails.push(`covered by the level: ${show(day)} left ${day.left}, want 高铁,登机 left 0`);
}

// Never had words: the first Today lists the day's fields — both of them.
async function checkSeedLive() {
  await setTopics(TG, ["Технологии и IT", "Игры и аниме"]);
  await prisma.user.update({ where: { telegramId: TG }, data: { topicPool: Prisma.DbNull } });
  const t0 = Date.now();
  const day = await topicDaily(TG);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`seeded in ${secs}s: ${day.words.map((w) => `${w.word} ${w.meaning} [${w.topic}]`).join(" · ")}`);
  const fields = new Set(day.words.map((w) => w.topic));
  if (day.words.length !== 3 || fields.size !== 2) fails.push(`seed: ${day.words.length} words from ${[...fields].join(",")}`);
  // The next load reads the saved pools: no second model call.
  const t1 = Date.now();
  const again = await topicDaily(TG);
  if (Date.now() - t1 > 1500) fails.push(`seed: second load took ${Date.now() - t1} ms — listed again?`);
  if (show(again) !== show(day)) fails.push("seed: the day changed on reload");
}

// "More words": the pools grow by words they didn't hold.
async function checkMoreLive() {
  const before = await prisma.user.findUniqueOrThrow({ where: { telegramId: TG }, select: { topicPool: true } });
  const old = before.topicPool as Record<string, TopicWord[]>;
  const t0 = Date.now();
  await moreTopicWords(TG);
  const after = (await prisma.user.findUniqueOrThrow({ where: { telegramId: TG }, select: { topicPool: true } })).topicPool as Record<string, TopicWord[]>;
  for (const [field, words] of Object.entries(after)) {
    const had = new Set((old[field] ?? []).map((w) => w.word));
    const fresh = words.filter((w) => !had.has(w.word));
    console.log(`more "${field}" (${((Date.now() - t0) / 1000).toFixed(1)}s): +${fresh.length} — ${fresh.slice(0, 10).map((w) => w.word).join(" ")}`);
    // A field's everyday words are often HSK ≤ target (dropped: the exam track brings
    // them), so a second list may keep only a handful — games kept 7 of 30.
    if (fresh.length < 5) fails.push(`more: only ${fresh.length} new words for ${field}`);
    if (new Set(words.map((w) => w.word)).size !== words.length) fails.push(`more: duplicates in ${field}`);
    const low = words.filter((w) => (hskTagFor(w.word)?.["3.0"] ?? 99) <= 4);
    if (low.length) fails.push(`more: HSK ≤ 4 words slipped into ${field}: ${low.map((w) => w.word).join(",")}`);
  }
}

async function main() {
  checkRanking();
  checkPure();
  await checkDay();
  await checkFields();
  await checkCoveredDay();
  if (LIVE) await checkSeedLive();
  if (LIVE) await checkMoreLive();
  await deleteAccount(TG);
  if (fails.length) {
    console.error("FAIL\n- " + fails.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log(`PASS — ranking, the day's three, fields round the interests, off stays off, covered words skipped${LIVE ? ", a seeded day and more words" : ""}`);
  }
}

main()
  .catch(async (e) => {
    console.error(e);
    await deleteAccount(TG).catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
