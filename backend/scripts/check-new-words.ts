// Proves part 3 of "New words that learn well together, straight from the dictionary"
// (BACKLOG 1e, PLAN-word-groups.md): Flashcards and Writing hand out new words without
// adding them first. The words are what is left of today's group, then the next group;
// they come as ready-made cards with nothing written; a word becomes a card on its
// first grade, "Easy" on first sight is "I know it" with no card, Writing's first
// grade leaves the reading schedule new, Undo leaves no trace, and a quit session
// adds nothing it never showed.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-new-words.ts
import { prisma } from "../src/services/db.js";
import { hskLevelWords } from "../src/services/hsk.js";
import { hskDailyWords } from "../src/services/wordGroups.js";
import { hskNextWords, learnWord, readyCards, unlearnWord } from "../src/services/newWords.js";
import { deleteAccount } from "../src/services/accountData.js";

const TG = `test-new-words-${Date.now()}`;
const DAY = 86_400_000;
let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

async function main() {
  const user = await prisma.user.create({
    data: { telegramId: TG, firstName: "New", hskVersion: "3.0", hskTarget: 4, dailyGoal: 5, nativeLang: "ru", invited: true },
  });
  const below = [1, 2, 3].flatMap((n) => hskLevelWords("3.0", n).map((w) => w.word));
  await prisma.word.createMany({
    data: below.map((word) => ({
      userId: user.id, word, sourceLang: "zh", targetLang: "ru", collocations: [], synonyms: [], antonyms: [], createdAt: new Date(Date.now() - 3 * DAY),
    })),
  });
  const cards = () => prisma.word.count({ where: { userId: user.id } });
  const before = await cards();

  // 1. Today's group first, as ready-made cards, nothing written.
  const day = await hskDailyWords(TG);
  const next = await hskNextWords(TG, 8);
  check(
    next.theme === day.theme && next.words.map((w) => w.word).join() === day.words.map((w) => w.word).join(),
    `the new words are today's group (${next.theme}: ${next.words.map((w) => w.word).join(" ")})`,
  );
  const ready = await readyCards(TG, next.words);
  for (const c of ready.slice(0, 2)) console.log(`  ${c.id} ${c.phonetic} «${c.meaningZh}» — ${c.examples[0]?.sentenceEn ?? "(no example)"}`);
  check(ready.every((c) => c.id.startsWith("new:") && /[а-яё]/i.test(c.meaningZh ?? "") && c.phonetic && c.reviewCount === 0), "each has its meaning in Russian, pinyin, no reviews");
  check(ready.filter((c) => c.examples.length === 1).length >= ready.length - 1, `the pool's sentence on ${ready.filter((c) => c.examples.length).length} of ${ready.length}`);
  check((await cards()) === before, "nothing written to the account");

  // 2. Flashcards: Good and Again make cards, "Easy" on first sight makes none.
  const [good, again, easy, write, quit] = next.words.map((w) => w.word);
  const g = await learnWord(TG, { word: good, grade: 3, source: "review" });
  const a = await learnWord(TG, { word: again, grade: 1, source: "review" });
  const e = await learnWord(TG, { word: easy, grade: 4, source: "review" });
  check("card" in g && g.card.reviewCount === 1 && g.card.examples.length >= 1, `${good}: Good makes a card, reviewed once, with its sentence`);
  // reviewCount counts Good and Easy only; the log has every grade.
  const graded = (id: string) => prisma.reviewEvent.count({ where: { wordId: id } });
  check("card" in a && (await graded(a.card.id)) === 1, `${again}: Again makes a card, its grade logged`);
  check("known" in e, `${easy}: Easy on first sight is "I know it"`);
  const a2 = await learnWord(TG, { word: again, grade: 3, source: "review" });
  const againCards = await prisma.word.count({ where: { userId: user.id, word: again } });
  check("card" in a2 && (await graded(a2.card.id)) === 2 && againCards === 1, `${again} graded again in the session: still one card, graded twice`);

  // 3. Writing: the first graded write makes the card; reading starts as a new card.
  const w = await learnWord(TG, { word: write, grade: 3, source: "write" });
  check("card" in w && w.card.writeStability != null && w.card.reviewCount === 0, `${write}: written once, its reading schedule still new`);

  // 4. A quit session: the word never graded is not a card.
  check((await cards()) === before + 3 && (await prisma.word.count({ where: { userId: user.id, word: quit } })) === 0, `3 cards made, none for ${quit} (never graded)`);

  // 5. Today agrees: the cards read as taken, the known word left the day.
  const dayAfter = await hskDailyWords(TG);
  const added = dayAfter.words.filter((x) => x.added).map((x) => x.word);
  check(
    [good, again, write].every((x) => added.includes(x)) && !dayAfter.words.some((x) => x.word === easy),
    `Today: ${added.join(" ")} taken, ${easy} replaced`,
  );

  // 6. Undo: a first grade taken back leaves nothing behind.
  check(await unlearnWord(TG, good), `undo ${good}`);
  check((await prisma.word.count({ where: { userId: user.id, word: good } })) === 0, `${good}'s card is gone`);
  check(
    (await prisma.placementAnswer.count({ where: { userId: user.id, word: good } })) === 0 &&
      (await prisma.reviewEvent.count({ where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 60_000) }, wordId: null } })) === 0,
    "no answer and no orphaned review left",
  );
  check(await unlearnWord(TG, easy), `undo ${easy}'s "I know it"`);
  check((await hskDailyWords(TG)).words.some((x) => x.word === easy), `${easy} is back in today's words`);

  // 7. Once today's group is taken, the next new words are the group after it.
  const left = (await hskDailyWords(TG)).words.filter((x) => !x.added);
  for (const x of left) await learnWord(TG, { word: x.word, grade: 3, source: "review" });
  const todayWords = new Set((await hskDailyWords(TG)).words.map((x) => x.word));
  const beyond = await hskNextWords(TG, 8);
  console.log(`  next: ${beyond.theme} — ${beyond.words.map((x) => x.word).join(" ")}`);
  check(
    beyond.words.length === 8 && beyond.words.every((x) => !todayWords.has(x.word) && x.level === 4),
    "8 HSK 4 words, none of today's",
  );
  check(beyond.theme != null && beyond.words.filter((x) => x.situation === beyond.theme).length >= 3, `one situation leads it (${beyond.theme})`);
}

try {
  await main();
} finally {
  await deleteAccount(TG);
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
