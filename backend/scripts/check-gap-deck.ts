// Proves "Pick HSK N, get HSK N words — every day" (BACKLOG): an account aiming
// at HSK 4 is handed HSK 4 words, the ones it tapped as unknown first, a word it
// rejects never comes back, and the daily offer is a day's worth, not a refill.
//
// Worth a script because the fault it guards was invisible in review: the old
// deck walked HSK 1 → target in file order, so a real HSK 4 learner got 一下儿,
// 一些, 七, 三 … and the code read fine. One seeded account catches it.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-gap-deck.ts
import { prisma } from "../src/services/db.js";
import { hskDailyWords, hskGapWords, hskLevelWords } from "../src/services/hsk.js";
import { savePlacementAnswers } from "../src/services/learnerPrefs.js";
import { deleteAccount } from "../src/services/accountData.js";

const TG = `test-gap-${Date.now()}`;
const TG2 = `${TG}-b`;
let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

async function main() {
  const user = await prisma.user.create({
    data: { telegramId: TG, firstName: "Gap", hskVersion: "3.0", hskTarget: 4, dailyGoal: 5, invited: true },
  });

  // The check: one HSK 2 and one HSK 4 word tapped as unknown, a few HSK 1 words known.
  const l1 = hskLevelWords("3.0", 1);
  const tapped = [hskLevelWords("3.0", 2)[7].word, hskLevelWords("3.0", 4)[11].word];
  await savePlacementAnswers(TG, {
    sourceLang: "zh",
    targetLang: "ru",
    known: l1.slice(0, 10).map((w) => w.word),
    unknown: tapped,
  });

  // 1. The deck: tapped words first, then HSK 4 — no HSK 1 anywhere near the top.
  const deck = await hskGapWords(TG, "3.0", 4, 20);
  check(deck.length === 20, `deck has 20 words (${deck.length})`);
  check(
    tapped.every((w) => deck.slice(0, 2).some((d) => d.word === w)),
    `the tapped words lead the deck (${deck.slice(0, 2).map((d) => d.word).join(", ")})`,
  );
  const rest = deck.slice(2);
  check(rest.every((d) => d.level === 4), `the rest is HSK 4 (${[...new Set(rest.map((d) => d.level))].join(",")})`);
  check(!deck.some((d) => l1.slice(0, 10).some((w) => w.word === d.word)), "words ticked as known never appear");
  const again = await hskGapWords(TG, "3.0", 4, 20);
  check(again.map((d) => d.word).join() === deck.map((d) => d.word).join(), "same order on a reload the same day");

  // 2. Rejecting a word ("I know it") — it never comes back, in the deck or the drip.
  const rejected = rest[0].word;
  await savePlacementAnswers(TG, { sourceLang: "zh", targetLang: "ru", known: [rejected], unknown: [] });
  const afterReject = await hskGapWords(TG, "3.0", 4, 200);
  check(!afterReject.some((d) => d.word === rejected), `rejected ${rejected} is gone from the deck`);

  // 3. The daily drip: dailyGoal words at the level; adding them makes today "done".
  const day1 = await hskDailyWords(TG);
  check(day1.level === 4 && day1.words.length === 5, `today offers 5 HSK 4-first words (${day1.words.map((w) => `${w.word}/${w.level}`).join(" ")})`);
  check(!day1.words.some((w) => w.word === rejected), "the rejected word is not in today's offer");
  const take = day1.words.slice(0, 3);
  await prisma.word.createMany({
    data: take.map((w) => ({ userId: user.id, word: w.word, sourceLang: "zh", targetLang: "ru", collocations: [], synonyms: [], antonyms: [] })),
  });
  const day1b = await hskDailyWords(TG);
  check(
    day1b.words.map((w) => w.word).join() === day1.words.map((w) => w.word).join() && day1b.words.filter((w) => w.added).length === 3,
    "after adding 3, today's offer is the same 5 with 3 marked added — not 5 new ones",
  );

  // A rejection mid-day frees a slot for the next word.
  const dropped = day1b.words.find((w) => !w.added)!.word;
  await savePlacementAnswers(TG, { sourceLang: "zh", targetLang: "ru", known: [dropped], unknown: [] });
  const day1c = await hskDailyWords(TG);
  check(day1c.words.length === 5 && !day1c.words.some((w) => w.word === dropped), `rejecting ${dropped} brings in another word`);

  // 4. Onboarding day: build the deck with two words turned down, and Today's
  // offer is already done — the deck was today's words. (Caught in the browser:
  // filtering before the shuffle reshuffled the level on every rejection.)
  const u2 = await prisma.user.create({ data: { telegramId: TG2, hskVersion: "3.0", hskTarget: 4, dailyGoal: 5 } });
  const deck2 = await hskGapWords(TG2, "3.0", 4, 20);
  const turnedDown = [deck2[1].word, deck2[3].word];
  await savePlacementAnswers(TG2, { sourceLang: "zh", targetLang: "ru", known: turnedDown, unknown: [] });
  await prisma.word.createMany({
    data: deck2
      .filter((w) => !turnedDown.includes(w.word))
      .map((w) => ({ userId: u2.id, word: w.word, sourceLang: "zh", targetLang: "ru", collocations: [], synonyms: [], antonyms: [] })),
  });
  const onboardingDay = await hskDailyWords(TG2);
  check(onboardingDay.words.every((w) => w.added), `after onboarding, today's offer is done (${onboardingDay.words.map((w) => `${w.word}${w.added ? "✓" : ""}`).join(" ")})`);

  // 5. Tomorrow: the cards made "today" are yesterday's — five new words.
  await prisma.word.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });
  const day2 = await hskDailyWords(TG);
  check(
    day2.words.length === 5 && day2.words.every((w) => !w.added && !take.some((t) => t.word === w.word)),
    `the next day brings 5 new words (${day2.words.map((w) => w.word).join(" ")})`,
  );
}

try {
  await main();
} finally {
  await deleteAccount(TG);
  await deleteAccount(TG2);
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
