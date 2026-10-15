// Proves part 2 of "New words that learn well together, straight from the dictionary"
// (BACKLOG 1e, PLAN-word-groups.md): Today's words are the day's group, named after
// its situation; the day holds still while its words are taken; a word said known
// leaves and the gap fills from the same theme; onboarding's deck reads as the first
// day done; and taking the words makes ready-made cards — the dictionary's meaning
// and the pool's sentence at once, with no model call queued.
//
// Run against a DEV database — it creates throwaway users and deletes them:
//   cd backend && npx tsx scripts/check-daily-group.ts
import { prisma } from "../src/services/db.js";
import { hskGuestDeck, hskLevelWords } from "../src/services/hsk.js";
import { hskDailyWords } from "../src/services/wordGroups.js";
import { likedSituations } from "../src/lib/interests.js";
import { importWordsForUser } from "../src/services/importWords.js";
import { savePlacementAnswers } from "../src/services/learnerPrefs.js";
import { deleteAccount } from "../src/services/accountData.js";

const TG = `test-daily-group-${Date.now()}`;
const TG2 = `${TG}-b`;
const TG3 = `${TG}-c`;
const DAY = 86_400_000;
let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const card = (userId: string, word: string, createdAt = new Date()) => ({
  userId,
  word,
  sourceLang: "zh",
  targetLang: "ru",
  collocations: [],
  synonyms: [],
  antonyms: [],
  createdAt,
});
const show = (ws: { word: string; situation: string | null; added: boolean }[]) =>
  ws.map((w) => `${w.word}${w.situation ? `·${w.situation}` : ""}${w.added ? "✓" : ""}`).join(" ");

async function main() {
  // An HSK 4 learner who has HSK 1–3 as cards from before today.
  const user = await prisma.user.create({
    data: { telegramId: TG, firstName: "Group", hskVersion: "3.0", hskTarget: 4, dailyGoal: 5, invited: true },
  });
  const below = [1, 2, 3].flatMap((n) => hskLevelWords("3.0", n).map((w) => w.word));
  await prisma.word.createMany({ data: below.map((w) => card(user.id, w, new Date(Date.now() - 2 * DAY))) });

  // 1. A named group: most of the day from one situation.
  const day = await hskDailyWords(TG);
  console.log(`  today: ${day.theme} — ${show(day.words)}`);
  check(day.words.length === 5 && day.words.every((w) => w.level === 4), "5 HSK 4 words");
  check(day.theme != null && day.words.filter((w) => w.situation === day.theme).length >= 3, `named after its situation (${day.theme}), 3+ words from it`);

  // 2. Taking three, the theme's last: ready-made cards, a sentence each, no model call queued.
  const take = [...day.words].sort((a, b) => Number(a.situation === day.theme) - Number(b.situation === day.theme)).slice(0, 3);
  const r = await importWordsForUser({
    telegramId: TG,
    sourceLang: "zh",
    targetLang: "ru",
    items: take.map((w) => ({ word: w.word, meaning: "", example: "", exampleTranslation: "", synonyms: [] })),
    level: "4",
    generateDetails: false,
    generateExamples: false,
    poolExamples: true,
  });
  check(r.created === 3 && r.job === null, `3 cards made, no enrichment job (job: ${r.job?.id ?? "none"})`);
  const cards = await prisma.word.findMany({
    where: { userId: user.id, word: { in: take.map((w) => w.word) } },
    include: { examples: true },
  });
  for (const c of cards) console.log(`  ${c.word} ${c.phonetic} «${c.meaningZh}» — ${c.examples[0]?.sentenceEn ?? "(no example)"}`);
  check(cards.every((c) => /[а-яё]/i.test(c.meaningZh ?? "") && c.phonetic), "each has pinyin and a Russian meaning");
  check(cards.every((c) => c.examples.length === 1 && c.examples[0].level), "each has the pool's sentence, labelled with its level");

  // 3. The day holds still, three marked added.
  const after = await hskDailyWords(TG);
  check(
    after.words.map((w) => w.word).join() === day.words.map((w) => w.word).join() &&
      after.words.filter((w) => w.added).map((w) => w.word).sort().join() === take.map((w) => w.word).sort().join(),
    `the same 5, 3 added (${show(after.words)})`,
  );

  // 4. "I know it" on a theme word: it leaves, the rest stay, the theme fills the gap.
  const themeWord = after.words.find((w) => !w.added && w.situation === after.theme)!;
  await savePlacementAnswers(TG, { sourceLang: "zh", targetLang: "ru", known: [themeWord.word], unknown: [] });
  const swapped = await hskDailyWords(TG);
  const stayed = after.words.filter((w) => w.word !== themeWord.word).map((w) => w.word);
  const fresh = swapped.words.filter((w) => !stayed.includes(w.word));
  check(
    swapped.words.length === 5 && !swapped.words.some((w) => w.word === themeWord.word) && stayed.every((w) => swapped.words.some((s) => s.word === w)),
    `${themeWord.word} leaves, the other 4 stay (${show(swapped.words)})`,
  );
  check(
    swapped.theme === after.theme && fresh.length === 1 && fresh[0].situation === after.theme,
    `the gap fills from the same theme (${fresh.map((w) => `${w.word}·${w.situation}`).join(" ")})`,
  );

  // 5. Onboarding day: the guest deck's 20 cards are today's adds, and Today reads done.
  const u2 = await prisma.user.create({ data: { telegramId: TG2, hskVersion: "3.0", hskTarget: 4, dailyGoal: 5 } });
  const deck = hskGuestDeck("3.0", 4, [], [], 20);
  await prisma.word.createMany({ data: deck.map((w) => card(u2.id, w.word)) });
  const first = await hskDailyWords(TG2);
  check(first.words.length === 5 && first.words.every((w) => w.added), `after onboarding, today is done (${show(first.words)})`);

  // 6. Tomorrow: a new group with none of the words taken or known (the ones left
  // untaken are still the next words, so they may come again).
  await prisma.word.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - DAY - 1000) } });
  await prisma.placementAnswer.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - DAY - 1000) } });
  const next = await hskDailyWords(TG);
  console.log(`  tomorrow: ${next.theme} — ${show(next.words)}`);
  check(
    next.words.length === 5 && next.words.every((w) => !w.added && w.word !== themeWord.word && !take.some((t) => t.word === w.word)),
    "the next day is 5 words not taken or known yet",
  );

  // 7. A learner who came for travel and IT (onboarding's labels, in Russian, in the
  // coach memory): their day is one of their situations, not the office or the news.
  const u3 = await prisma.user.create({ data: { telegramId: TG3, hskVersion: "3.0", hskTarget: 4, dailyGoal: 5 } });
  await prisma.coachMemory.create({ data: { userId: u3.id, lang: "zh", goal: "Сдать HSK, Путешествия", interests: "Технологии и IT" } });
  const theirs = await hskDailyWords(TG3);
  const plain = await hskDailyWords(TG);
  check(
    theirs.theme != null && likedSituations("Сдать HSK, Путешествия", "Технологии и IT").has(theirs.theme) && theirs.theme !== plain.theme,
    `travel + IT: today is ${theirs.theme} (${show(theirs.words)}), not ${plain.theme}`,
  );
}

try {
  await main();
} finally {
  await deleteAccount(TG);
  await deleteAccount(TG2);
  await deleteAccount(TG3);
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
