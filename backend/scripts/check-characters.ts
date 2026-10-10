// Proves the backend of the word page's Characters block (learning audit 8e):
// GET /api/dict/chars → services/characters.ts, against a DEV database.
//
//   1. Each character with its reading and meaning: 电 of 电脑 in Russian; 觉 of
//      觉得 as jué with that reading's gloss, not 觉 jiào «сон»; 长 of 长大 as
//      zhǎng; 西 of 东西 is still xī.
//   2. The HSK words built on it, easiest first on the learner's list, the word
//      itself and the bare character left out; 妈妈's 妈 once.
//   3. The learner's own cards marked with their id and their own meaning.
//
//   cd backend && npx tsx scripts/check-characters.ts
//
// The model is switched off before anything loads the environment: dotenv never
// overrides a variable that is already set, and nothing here may need it.
process.env.BAILIAN_BASE_URL = "http://127.0.0.1:9/v1";
process.env.BAILIAN_API_KEY = "switched-off-by-check-characters";

const { wordCharacters } = await import("../src/services/characters.js");
const { prisma } = await import("../src/services/db.js");
const { deleteAccount } = await import("../src/services/accountData.js");

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "  ok " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}

const TG = `test-characters-${Date.now()}`;
const user = await prisma.user.create({ data: { telegramId: TG, firstName: "Chars", nativeLang: "ru", hskVersion: "3.0" } });
try {
  const tv = await prisma.word.create({
    data: { userId: user.id, word: "电视", phonetic: "diàn shì", sourceLang: "zh", targetLang: "ru", meaningZh: "телик" },
  });

  console.log("1. Characters");
  const pc = await wordCharacters(TG, "电脑", "diàn nǎo", "ru");
  const dian = pc[0];
  check("电脑 → 电, 脑", pc.map((c) => c.word).join("") === "电脑", pc.map((c) => c.word).join(" "));
  check("电 reads diàn, in Russian", dian?.pinyin === "diàn" && !dian.english && /[а-я]/i.test(dian.meaning), `${dian?.pinyin} ${dian?.meaning}`);
  const sleep = await wordCharacters(TG, "睡觉", "shuì jiào", "ru");
  check("觉 of 睡觉 is its own jiào «сон»", sleep[1]?.pinyin === "jiào" && !sleep[1].english, `${sleep[1]?.pinyin} ${sleep[1]?.meaning}`);
  const feel = await wordCharacters(TG, "觉得", "jué de", "ru");
  check("觉 of 觉得 is jué with that reading's gloss", feel[0]?.pinyin === "jué" && feel[0].english && /feel/i.test(feel[0].meaning), `${feel[0]?.pinyin} ${feel[0]?.meaning}`);
  const grow = await wordCharacters(TG, "长大", "zhǎng dà", "ru");
  // The reading's first glosses ("chief; head; elder"), not the sense 长大 uses: no model here.
  check("长 of 长大 is zhǎng, not cháng «длинный»", grow[0]?.pinyin === "zhǎng" && grow[0].english, `${grow[0]?.pinyin} ${grow[0]?.meaning}`);
  const thing = await wordCharacters(TG, "东西", "dōng xi", "ru");
  check("西 of 东西 (neutral tone) is still xī", thing[1]?.pinyin === "xī" && !thing[1].english, `${thing[1]?.pinyin} ${thing[1]?.meaning}`);
  const mum = await wordCharacters(TG, "妈妈", "mā ma", "ru");
  check("妈妈 → 妈 once", mum.length === 1 && mum[0].word === "妈");
  check("a word with no hanzi → nothing", (await wordCharacters(TG, "hello", "", "ru")).length === 0);

  console.log("\n2. Words built on it");
  const near = dian?.words.map((w) => w.word) ?? [];
  check("电's words: 电视, 电影, 电话 among them, at most 6", ["电视", "电影", "电话"].every((w) => near.includes(w)) && near.length <= 6, near.join(" "));
  check("not the word itself, nor the bare character", !near.includes("电脑") && !near.includes("电"));
  const levels = dian?.words.map((w) => w.level ?? 99) ?? [];
  check("easiest first", levels.every((l, i) => i === 0 || levels[i - 1] <= l), levels.join(" "));
  check("each with pinyin and a meaning", (dian?.words ?? []).every((w) => w.pinyin && w.meaning));

  console.log("\n3. The learner's cards");
  const mine = dian?.words.find((w) => w.word === "电视");
  check("电视 carries the card's id and its own meaning", mine?.id === tv.id && mine.meaning === "телик", JSON.stringify(mine));
  check("a word without a card carries no id", !dian?.words.find((w) => w.word === "电影")?.id);
} finally {
  await deleteAccount(TG);
  await prisma.$disconnect();
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
