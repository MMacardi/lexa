// Proves the backend half of "Review that trains reading" (learning audit 8d):
//
//   1. Measure words come out of CC-CEDICT per reading (data/cedict.jsonl `cl`,
//      built by scripts/build-cedict.mjs): 电脑 → 台, 东西 dōng xi → 个 件 but
//      dōng xī "east and west" → none, and a card that isn't a noun gets none.
//   2. Serving, against a DEV database: a card's own fetch and the word list carry
//      `measureWords`, and a card the dictionary gives none carries no field.
//
//   cd backend && npx tsx scripts/check-review-reading.ts
//
// The model is switched off before anything loads the environment: dotenv never
// overrides a variable that is already set, and nothing here may need it.
process.env.BAILIAN_BASE_URL = "http://127.0.0.1:9/v1";
process.env.BAILIAN_API_KEY = "switched-off-by-check-review-reading";

const { measureWordsFor } = await import("../src/services/cedict.js");
const { prisma } = await import("../src/services/db.js");

let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (!ok) failed++;
  console.log(`${ok ? "  ok " : "FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
}
const words = (word: string, phonetic: string | null, pos?: string | null) =>
  measureWordsFor(word, phonetic, pos)
    .map((m) => `${m.word} ${m.pinyin}`)
    .join(", ");

// --- 1. The dictionary ---

console.log("1. Measure words from CC-CEDICT");
check("电脑 diàn nǎo → 台", words("电脑", "diàn nǎo", "noun") === "台 tái", words("电脑", "diàn nǎo", "noun"));
check("衣服 yī fu (neutral tone) → 件, 套", words("衣服", "yī fu", "существительное") === "件 jiàn, 套 tào", words("衣服", "yī fu"));
check("河 → 条, 道 (listed inside a gloss)", words("河", "hé") === "条 tiáo, 道 dào", words("河", "hé"));
check("书 shū → 本 first, not the Shu1 abbreviation's nothing", words("书", "shū").startsWith("本 běn"), words("书", "shū"));
check("东西 dōng xi 'thing' → 个, 件", words("东西", "dōng xi") === "个 gè, 件 jiàn", words("东西", "dōng xi"));
check("东西 dōng xī 'east and west' → none", words("东西", "dōng xī") === "", words("东西", "dōng xī"));
check("no reading given and one reading has them → that one", words("东西", null) === "个 gè, 件 jiàn", words("东西", null));
check("a verb card gets none (票 as «голосовать» would be odd with 张)", words("票", "piào", "verb") === "");
check("'noun / verb' counts as a noun (工作 → 份)", words("工作", "gōng zuò", "noun / verb").includes("份 fèn"));
check("a noun the dictionary gives none → none (老师)", words("老师", "lǎo shī", "noun") === "");
check("a word off the HSK lists, from the extra file (书签 → 张)", words("书签", "shū qiān").startsWith("张 zhāng"), words("书签", "shū qiān"));

// --- 2. Serving ---

console.log("\n2. Serving");
const { getWord, listWordsForUser } = await import("../src/services/vocab.js");
const { deleteAccount } = await import("../src/services/accountData.js");
const TG = `test-review-reading-${Date.now()}`;
const user = await prisma.user.create({ data: { telegramId: TG, firstName: "Reading", nativeLang: "ru" } });
try {
  const pc = await prisma.word.create({
    data: { userId: user.id, word: "电脑", phonetic: "diàn nǎo", sourceLang: "zh", targetLang: "ru", meaningZh: "компьютер" },
  });
  const teacher = await prisma.word.create({
    data: { userId: user.id, word: "老师", phonetic: "lǎo shī", sourceLang: "zh", targetLang: "ru", meaningZh: "учитель" },
  });
  const one = await getWord(pc.id);
  check("a card's own fetch carries its measure words", JSON.stringify(one?.measureWords) === JSON.stringify([{ word: "台", pinyin: "tái" }]), JSON.stringify(one?.measureWords));
  const list = await listWordsForUser(TG);
  check("the word list (the review card's back) carries them too", list.find((w) => w.id === pc.id)?.measureWords?.[0]?.word === "台");
  check("a card with none carries no field", !("measureWords" in (list.find((w) => w.id === teacher.id) ?? {})));
} finally {
  await deleteAccount(TG);
}

await prisma.$disconnect();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
