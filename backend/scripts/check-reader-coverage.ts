// Proves the Reader's "you know 82%" (BACKLOG "Reader: HSK colours, pinyin only
// where you need it, how much of a text you know"): the saved-text list's % is
// a hand count of the text's running words, with the same rules the Reader uses
// for the open text — a number is not a word, a card still in learning is not
// known, a card for another pair doesn't count. Also that the segmenter's words
// carry the HSK levels the colours come from. No model call.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-reader-coverage.ts
const { prisma } = await import("../src/services/db.js");
const { createText, listTexts } = await import("../src/services/readerText.js");
const { readerTokens, countsAsWord } = await import("../src/services/coverage.js");
const { hskTagFor } = await import("../src/services/hsk.js");
const { deleteAccount } = await import("../src/services/accountData.js");

const TG = `test-coverage-${Date.now()}`;
let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const TEXT = "我喜欢学习汉语。我有3本书，我也学习。";

async function main() {
  // The hand count rests on this split: 12 words, of which 3 is not one.
  const words = readerTokens(TEXT, "zh").filter((t) => t.wordLike).map((t) => t.text);
  const want = ["我", "喜欢", "学习", "汉语", "我", "有", "3", "本", "书", "我", "也", "学习"];
  check(words.join("|") === want.join("|"), `split: ${words.join(" | ")}`);
  check(readerTokens(TEXT, "zh").filter(countsAsWord).length === 11, "3 is not counted as a word");

  const user = await prisma.user.create({ data: { telegramId: TG, firstName: "Coverage", nativeLang: "ru" } });
  const card = (word: string, state: number, extra: { targetLang?: string; canUseAt?: Date } = {}) =>
    prisma.word.create({
      data: { userId: user.id, word, sourceLang: "zh", targetLang: extra.targetLang ?? "ru", state, canUseAt: extra.canUseAt, collocations: [], synonyms: [], antonyms: [] },
    });
  await card("我", 2); // Review → known
  await card("学习", 3); // Relearning → still past learning, known
  await card("汉语", 1); // Learning → not known yet
  await card("书", 0, { canUseAt: new Date() }); // can use it → known
  await card("喜欢", 2, { targetLang: "en" }); // another pair → doesn't count here

  // Known running words: 我 ×3 + 学习 ×2 + 书 = 6 of 11 → 55%.
  await createText(TG, { title: "coverage", content: TEXT, sourceLang: "zh", targetLang: "ru" });
  const [row] = await listTexts(TG);
  check(row?.knownPct === 55, `saved text: ${row?.knownPct}% known (hand count 6/11 = 55%)`);

  // Graduating 汉语 moves the % on the next list, nothing stored to go stale.
  await prisma.word.updateMany({ where: { userId: user.id, word: "汉语" }, data: { state: 2 } });
  const [again] = await listTexts(TG);
  check(again?.knownPct === 64, `after 汉语 graduates: ${again?.knownPct}% (7/11 = 64%)`);

  // The colours: every word here is on both HSK lists.
  for (const w of ["我", "喜欢", "学习", "汉语", "也"]) {
    const tag = hskTagFor(w);
    check(Boolean(tag?.["3.0"] && tag?.["2.0"]), `${w}: HSK 3.0 ${tag?.["3.0"]}, 2.0 ${tag?.["2.0"]}`);
  }
}

try {
  await main();
} finally {
  await deleteAccount(TG);
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
