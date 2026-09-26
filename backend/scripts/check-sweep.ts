// Proves what a sweep's answers do (BACKLOG "A sweep instead of a big test").
//
// The sweep page only writes placement answers; the claims are all downstream:
// a word marked known leaves the daily words for good, a word marked "to learn"
// comes first in them, and the list tells the sweep which words it already asked
// about — or a resumed sweep opens on the very words just marked "don't know".
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-sweep.ts
import { prisma } from "../src/services/db.js";
import { hskDailyWords, hskLevelWords, hskListWords } from "../src/services/hsk.js";
import { savePlacementAnswers } from "../src/services/learnerPrefs.js";
import { deleteAccount } from "../src/services/accountData.js";

const TG = `test-sweep-${Date.now()}`;

async function main() {
  await prisma.user.create({ data: { telegramId: TG, firstName: "Sweep", hskVersion: "3.0", hskTarget: 4, dailyGoal: 5 } });
  const level4 = hskLevelWords("3.0", 4).map((w) => w.word);
  // A screen: the first 40 of the level, four of them tapped as "to learn".
  const screen = level4.slice(0, 40);
  const toLearn = [screen[3], screen[11], screen[25], screen[38]];
  const known = screen.filter((w) => !toLearn.includes(w));
  await savePlacementAnswers(TG, { sourceLang: "zh", targetLang: "ru", level: "B2", known, unknown: toLearn });

  const fails: string[] = [];
  const list = await hskListWords(TG, "3.0", 4);
  const flagged = list.filter((w) => w.toLearn).map((w) => w.word);
  if (flagged.sort().join() !== [...toLearn].sort().join()) fails.push(`list toLearn: ${flagged.join(",")}`);
  const unswept = list.filter((w) => !w.card && w.status == null && !w.toLearn);
  if (unswept.some((w) => screen.includes(w.word))) fails.push("a swept word is still offered to the sweep");
  if (unswept.length !== level4.length - 40) fails.push(`unswept ${unswept.length}, want ${level4.length - 40}`);

  const daily = (await hskDailyWords(TG)).words.map((w) => w.word);
  if (daily.slice(0, 4).sort().join() !== [...toLearn].sort().join()) fails.push(`daily doesn't open with the to-learn words: ${daily.join(",")}`);
  if (daily.some((w) => known.includes(w))) fails.push(`a word marked known is in the daily words: ${daily.join(",")}`);

  await deleteAccount(TG);
  if (fails.length) {
    console.error("FAIL\n- " + fails.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log(`PASS — 36 known leave the daily words, the 4 to learn open them (${daily.slice(0, 4).join(" ")}), the list flags them`);
  }
}

main()
  .catch(async (e) => {
    console.error(e);
    await deleteAccount(TG).catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
