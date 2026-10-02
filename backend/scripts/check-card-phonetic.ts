// Proves every Chinese card has pinyin by the time it is shown, and the add form's
// lookup rows speak the interface's language.
//
// 拮据的 (not in CC-CEDICT) came in through the add sheet with no pinyin at all: the
// import path took pinyin only from the dictionary, and the upgrade's last write
// that would have added it never came. And 有钱, off the HSK list, showed
// "well-off; wealthy" to a Russian interface (the author, 2026-10-02).
// One live model call (~¥0.001).
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-card-phonetic.ts
const { prisma } = await import("../src/services/db.js");
const { importWordsForUser } = await import("../src/services/importWords.js");
const { fillMissingPhonetic } = await import("../src/services/capture.js");
const { translateGlosses, lookup } = await import("../src/services/lookup.js");
const { deleteAccount } = await import("../src/services/accountData.js");

const TG = `test-phonetic-${Date.now()}`;
let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

async function main() {
  // 1. Off the dictionary, and a dictionary word added with its meaning typed: pinyin at once.
  await importWordsForUser({
    telegramId: TG,
    sourceLang: "zh",
    targetLang: "ru",
    items: [
      { word: "拮据的", meaning: "", example: "", exampleTranslation: "", synonyms: [] },
      { word: "有钱", meaning: "богатый", example: "", exampleTranslation: "", synonyms: [] },
    ],
    generateDetails: false,
    generateExamples: false,
  });
  const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: TG } });
  const cards = await prisma.word.findMany({ where: { userId: user.id }, select: { id: true, word: true, phonetic: true } });
  const by = new Map(cards.map((c) => [c.word, c]));
  check(by.get("拮据的")?.phonetic === "jié jū de", `拮据的 imported with pinyin (${by.get("拮据的")?.phonetic})`);
  check(by.get("有钱")?.phonetic === "yǒu qián", `有钱 with a typed meaning still gets CC-CEDICT's pinyin (${by.get("有钱")?.phonetic})`);

  // 2. A card already saved without pinyin gets it when opened.
  const bare = await prisma.word.create({ data: { userId: user.id, word: "拮据", sourceLang: "zh", targetLang: "ru", meaningZh: "бедный" } });
  await fillMissingPhonetic(bare.id);
  const filled = await prisma.word.findUnique({ where: { id: bare.id }, select: { phonetic: true } });
  check(filled?.phonetic === "jiéjū" || filled?.phonetic === "jié jū", `a saved card without pinyin gets it on open (${filled?.phonetic})`);
  const edited = await prisma.word.create({ data: { userId: user.id, word: "有钱", sourceLang: "zh", targetLang: "ru", phonetic: "yǒuqián!" } });
  await fillMissingPhonetic(edited.id);
  check((await prisma.word.findUnique({ where: { id: edited.id } }))?.phonetic === "yǒuqián!", "pinyin the learner wrote is left alone");

  // 3. Lookup rows: English only when there's no default; translated for a Russian interface.
  const ru = await lookup("有钱", "ru");
  const row = ru.hits.find((h) => h.word === "有钱");
  check(Boolean(row?.english), `有钱's row starts in English (${row?.meaning})`);
  const t0 = Date.now();
  const meanings = await translateGlosses(["有钱", "访问"], "ru");
  check(/[а-яё]/i.test(meanings["有钱"] ?? ""), `有钱 in Russian: ${meanings["有钱"]} (${Date.now() - t0} ms)`);
  check(!("访问" in meanings), "a word with a Russian default isn't asked again");
  const t1 = Date.now();
  const again = await translateGlosses(["有钱"], "ru");
  check(again["有钱"] === meanings["有钱"] && Date.now() - t1 < 50, "the second ask is cached");
  check(Object.keys(await translateGlosses(["有钱"], "en")).length === 0, "an English interface keeps CC-CEDICT's English");
  const en = await lookup("有钱", "en");
  check(Boolean(en.hits.find((h) => h.word === "访问" || h.word === "有钱")?.english), "the English lookup gives English rows");
  const enHsk = await lookup("访问", "en");
  check(enHsk.hits[0]?.english === true, `an HSK word's row is English for an English interface (${enHsk.hits[0]?.meaning})`);
}

try {
  await main();
} finally {
  await deleteAccount(TG);
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
