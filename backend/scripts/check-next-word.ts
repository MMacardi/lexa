// Proves the first half of "The next word: frequent, built from what you know"
// (BACKLOG 1d): inside a level the daily words come most useful first — frequent,
// and made of characters the learner has met — instead of a shuffle that gave a
// rare word the odds of a common one. And the order holds still for the day: taking a
// word must not re-rank the rest under the learner's thumb.
//
// Also prints old order vs new on two numbers that need no learner: how much of
// the level's usage the first words cover, and how many new characters each one
// brings. The real proof (words kept after 7 days per 10 minutes) needs a week of
// reviews; this is the part that can be checked today.
//
// Run against a DEV database — it creates throwaway users and deletes them:
//   cd backend && npx tsx scripts/check-next-word.ts
import { prisma } from "../src/services/db.js";
import { hskDailyWords, hskFrequency, hskGapWords, hskGuestDeck, hskLevelWords, nextWordValue } from "../src/services/hsk.js";
import { savePlacementAnswers } from "../src/services/learnerPrefs.js";
import { deleteAccount } from "../src/services/accountData.js";

const TG = `test-next-${Date.now()}`;
const TG2 = `${TG}-b`;
let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const DAY = 86_400_000;
const card = (userId: string, word: string, createdAt?: Date) => ({
  userId,
  word,
  sourceLang: "zh",
  targetLang: "ru",
  collocations: [],
  synonyms: [],
  antonyms: [],
  ...(createdAt ? { createdAt } : {}),
});

const level4 = hskLevelWords("3.0", 4);
const lowerChars = new Set<string>();
for (let n = 1; n < 4; n++) for (const e of hskLevelWords("3.0", n)) for (const ch of e.word) lowerChars.add(ch);
const newChars = (w: string) => Array.from(w).filter((ch) => !lowerChars.has(ch)).length;

// --- Old order vs new, on the list alone ---
function summary() {
  const total = level4.reduce((a, w) => a + hskFrequency(w.word), 0);
  const stats = (words: string[]) => ({
    usage: words.reduce((a, w) => a + hskFrequency(w), 0) / total,
    newChars: words.reduce((a, w) => a + newChars(w), 0) / words.length,
  });
  const fresh = hskGuestDeck("3.0", 4, [], [], 100).map((w) => w.word);
  // The old order: the level shuffled. Averaged over draws so one lucky shuffle doesn't flatter it.
  let usage = 0;
  let chars = 0;
  const RUNS = 200;
  for (let r = 0; r < RUNS; r++) {
    const s = [...level4].sort(() => Math.random() - 0.5).slice(0, 100).map((w) => w.word);
    const st = stats(s);
    usage += st.usage;
    chars += st.newChars;
  }
  const now = stats(fresh);
  console.log(`\nHSK 3.0 level 4 (${level4.length} words), the first 100 a new learner meets:`);
  console.log(`  share of the level's usage   old ${((usage / RUNS) * 100).toFixed(1)}%   new ${(now.usage * 100).toFixed(1)}%`);
  console.log(`  new characters per word      old ${(chars / RUNS).toFixed(2)}    new ${now.newChars.toFixed(2)}`);
  console.log(`  first 10: ${fresh.slice(0, 10).join(" ")}\n`);
  check(now.usage > (usage / RUNS) * 3, "the first 100 cover over three times the usage a shuffle does");
  check(now.newChars < chars / RUNS, "and bring fewer new characters per word");
}

async function main() {
  summary();

  // 1. The value: frequency, discounted by characters the learner hasn't met.
  const metAll = () => true;
  const metNone = () => false;
  check(nextWordValue("地图", metAll) > nextWordValue("地图", metNone), "地图 is worth more to someone who has 地 and 图");
  check(nextWordValue("需要", metNone) > nextWordValue("入乡随俗", metAll), "a common word with new characters still beats a rare one without");

  // 2. The deck for a fresh HSK 4 account: HSK 4, in value order, no rare tail at the top.
  const user = await prisma.user.create({
    data: { telegramId: TG, firstName: "Next", hskVersion: "3.0", hskTarget: 4, dailyGoal: 5, invited: true },
  });
  const deck = await hskGapWords(TG, "3.0", 4, 30);
  check(deck.length === 30 && deck.every((d) => d.level === 4), `deck is 30 HSK 4 words (${deck.slice(0, 8).map((d) => d.word).join(" ")} …)`);
  const counts = level4.map((w) => hskFrequency(w.word)).sort((a, b) => a - b);
  const median = counts[Math.floor(counts.length / 2)];
  check(deck.every((d) => hskFrequency(d.word) >= median), `every word in it is in the level's more frequent half (median count ${median})`);

  // 3. Characters you know make a word cheaper: a word with a character new at
  // HSK 4 moves up once a card from before today has that character.
  const full = await hskGapWords(TG, "3.0", 4, 1000);
  const donorFor = (w: string) => {
    const ch = Array.from(w).find((c) => !lowerChars.has(c))!;
    return { ch, donor: level4.find((d) => d.word !== w && d.word.includes(ch)) };
  };
  const target = full.slice(10).find((d) => newChars(d.word) === 1 && d.word.length === 2 && donorFor(d.word).donor)!;
  const { ch, donor } = donorFor(target.word) as { ch: string; donor: (typeof level4)[number] };
  const rankOf = (list: { word: string }[]) => list.findIndex((d) => d.word === target.word);
  const before = rankOf(full);
  await prisma.word.create({ data: card(user.id, donor.word, new Date(Date.now() - 2 * DAY)) });
  const after = rankOf(await hskGapWords(TG, "3.0", 4, 1000));
  check(after >= 0 && after < before, `${target.word} moves up (${before} → ${after}) once ${donor.word} (with ${ch}) is a card from before today`);

  // 4. The day holds still: taking today's words doesn't re-rank the rest, even
  // when they share characters with what is left.
  const day1 = await hskDailyWords(TG);
  const taken = day1.words.slice(0, 3);
  await prisma.word.createMany({ data: taken.map((w) => card(user.id, w.word)) });
  const day1b = await hskDailyWords(TG);
  check(
    day1b.words.map((w) => w.word).join() === day1.words.map((w) => w.word).join(),
    `after taking 3, today's offer is the same 5 (${day1.words.map((w) => w.word).join(" ")})`,
  );
  const gapToday = (await hskGapWords(TG, "3.0", 4, 200)).map((w) => w.word);
  // An "I know it" today skips that word but counts its characters only tomorrow.
  const rejected = day1b.words.find((w) => !w.added)!.word;
  await savePlacementAnswers(TG, { sourceLang: "zh", targetLang: "ru", known: [rejected], unknown: [] });
  const gapAfter = (await hskGapWords(TG, "3.0", 4, 200)).map((w) => w.word);
  check(
    gapAfter.slice(0, 199).join() === gapToday.filter((w) => w !== rejected).join(),
    `rejecting ${rejected} only removes it — the rest keeps its order`,
  );

  // 5. Tomorrow the day's cards count: words sharing their characters can move up.
  await prisma.word.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - DAY - 1000) } });
  await prisma.placementAnswer.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - DAY - 1000) } });
  const day2 = await hskDailyWords(TG);
  check(
    day2.words.length === 5 && day2.words.every((w) => !w.added && !taken.some((t) => t.word === w.word) && w.word !== rejected),
    `the next day brings 5 new words (${day2.words.map((w) => w.word).join(" ")})`,
  );

  // 6. A guest's deck is the deck the account gets on day one: the same answers,
  // the same words in the same order (it becomes the cards on sign-in).
  const known = level4.slice(0, 6).map((w) => w.word);
  const unknown = [hskLevelWords("3.0", 3)[5].word, level4[40].word];
  const guest = hskGuestDeck("3.0", 4, known, unknown, 20).map((w) => w.word);
  await prisma.user.create({ data: { telegramId: TG2, hskVersion: "3.0", hskTarget: 4, dailyGoal: 5 } });
  await savePlacementAnswers(TG2, { sourceLang: "zh", targetLang: "ru", known, unknown });
  const account = (await hskGapWords(TG2, "3.0", 4, 20)).map((w) => w.word);
  check(guest.join() === account.join(), `guest deck = account deck on day one (${guest.slice(0, 5).join(" ")} …)`);
  check(unknown.every((w) => guest.slice(0, 2).includes(w)), "the words tapped as unknown still lead it");
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
