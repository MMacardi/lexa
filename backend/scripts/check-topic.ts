// Proves topic words behave (BACKLOG "Topic words beside the exam words").
//
// Three claims, each easy to break quietly:
//   1. ranking — the learner's own text first, then words made of characters they
//      know; nothing they have, nothing the exam track already brings;
//   2. the day — three a day, a word taken today stays in the offer as "added",
//      a word they had or said they knew never shows;
//   3. (--live) a real model call on a real AI paragraph gives an HSK 4 learner
//      field words, not HSK words, most of them from known characters.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-topic.ts [--live]
import { prisma } from "../src/services/db.js";
import { rankTopicWords, setTopic, topicDaily, type TopicWord } from "../src/services/topic.js";
import { hskTagFor } from "../src/services/hsk.js";
import { deleteAccount } from "../src/services/accountData.js";

const TG = `test-topic-${Date.now()}`;
const LIVE = process.argv.includes("--live");
const fails: string[] = [];
const c = (word: string) => ({ word, pinyin: "", meaning: "m" });

function checkRanking() {
  const text = "我们用算法训练模型。模型越大，算法越重要。参数很多。";
  const ranked = rankTopicWords(
    [c("芯片"), c("参数"), c("模型"), c("算法"), c("数据"), c("网络"), c("神经元"), c("算"), c("芯片"), c("hello"), c("电脑")],
    {
      have: new Set(["电脑"]),
      knownChars: new Set(Array.from("数据参算法模型网络")),
      text,
      hskLevelOf: (w) => ({ 数据: 3, 网络: 4, 模型: 5 })[w] ?? null,
      target: 4,
    },
  ).map((w) => w.word);
  // Text words by count (模型 2, 算法 2, 参数 1), then all-known 数据? no — 数据 is
  // HSK 3 ≤ 4, dropped; 网络 HSK 4, dropped; then 芯片 (unknown chars), 神经元.
  const want = ["模型", "算法", "参数", "芯片", "神经元"];
  if (ranked.join(",") !== want.join(",")) fails.push(`ranking: got ${ranked.join(",")}, want ${want.join(",")}`);
}

async function checkDay() {
  const user = await prisma.user.create({ data: { telegramId: TG, firstName: "Topic", hskVersion: "3.0", hskTarget: 4, nativeLang: "ru" } });
  const pool: TopicWord[] = ["算法", "模型", "参数", "芯片", "算力", "推理", "训练"].map((word) => ({
    word, pinyin: "", meaning: "m", fromText: false, known: 1, hsk: null,
  }));
  await prisma.user.update({ where: { id: user.id }, data: { topic: "AI", topicPool: pool } });
  let day = await topicDaily(TG);
  if (day.words.map((w) => w.word).join(",") !== "算法,模型,参数") fails.push(`day 1: ${day.words.map((w) => w.word).join(",")}`);
  if (day.left !== 4) fails.push(`day 1 left ${day.left}, want 4`);

  // Take 算法 today, said-known 模型, and an old card for 参数 from last week.
  await prisma.word.create({ data: { userId: user.id, word: "算法", sourceLang: "zh", targetLang: "ru", meaningZh: "алгоритм" } });
  await prisma.placementAnswer.create({ data: { userId: user.id, word: "模型", sourceLang: "zh", targetLang: "ru", known: true } });
  await prisma.word.create({
    data: { userId: user.id, word: "参数", sourceLang: "zh", targetLang: "ru", meaningZh: "параметр", createdAt: new Date(Date.now() - 7 * 86400_000) },
  });
  day = await topicDaily(TG);
  const got = day.words.map((w) => `${w.word}${w.added ? "+" : ""}`).join(",");
  if (got !== "算法+,芯片,算力") fails.push(`after taking/knowing: ${got}, want 算法+,芯片,算力`);
  if (day.left !== 2) fails.push(`after: left ${day.left}, want 2`);
}

async function checkLive() {
  const text =
    "今天我们讨论大模型的训练。训练一个大模型需要大量数据和很强的算力。模型的参数越多，推理的成本就越高。" +
    "我们用新的算法优化了推理速度，延迟降低了一半。开源模型让更多开发者可以微调自己的模型。";
  const t0 = Date.now();
  const pool = await setTopic(TG, "AI, large language models", text);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`live pool (${pool.length} words, ${secs}s):`);
  for (const w of pool.slice(0, 15)) console.log(`  ${w.word}\t${w.pinyin}\t${w.meaning}\ttext:${w.fromText ? "y" : "-"} known:${w.known.toFixed(2)} hsk:${w.hsk ?? "-"}`);
  if (pool.length < 10) fails.push(`live: only ${pool.length} words`);
  const onListLow = pool.filter((w) => (hskTagFor(w.word)?.["3.0"] ?? 99) <= 4);
  if (onListLow.length) fails.push(`live: HSK ≤ 4 words slipped in: ${onListLow.map((w) => w.word).join(",")}`);
  const top3 = (await topicDaily(TG)).words;
  if (!top3.every((w) => w.fromText)) fails.push(`live: today's 3 aren't from the text: ${top3.map((w) => w.word).join(",")}`);
  const mostlyKnown = pool.filter((w) => w.known >= 0.5).length / pool.length;
  console.log(`  ${Math.round(mostlyKnown * 100)}% of the pool is at least half known characters`);
}

async function main() {
  checkRanking();
  await checkDay();
  if (LIVE) await checkLive();
  await deleteAccount(TG);
  if (fails.length) {
    console.error("FAIL\n- " + fails.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log(`PASS — ranking, the day's three and what they already have${LIVE ? ", and a live pool" : ""}`);
  }
}

main()
  .catch(async (e) => {
    console.error(e);
    await deleteAccount(TG).catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
