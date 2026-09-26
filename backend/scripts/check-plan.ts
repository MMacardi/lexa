// Proves "A plan with a date" (BACKLOG): the exam day turns the words left into
// minutes a day, the check's sample shrinks an HSK 4 learner's gap instead of
// handing them HSK 1–3 again, and a date no pace can reach says so and offers a
// sweep and a closer level rather than "48 words a day".
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-plan.ts
import { prisma } from "../src/services/db.js";
import { hskLevelWords } from "../src/services/hsk.js";
import { savePlacementAnswers } from "../src/services/learnerPrefs.js";
import { deleteAccount } from "../src/services/accountData.js";
import { addDays, buildPlan, guestPlan, planForUser, wordsFor, type LevelEvidence } from "../src/services/studyPlan.js";

const TG = `test-plan-${Date.now()}`;
const TODAY = "2026-09-26";
let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const size = (n: number) => hskLevelWords("3.0", n).length;
const blank = (): LevelEvidence[] =>
  [1, 2, 3, 4, 5, 6, 7].map((level) => ({ level, total: size(level), have: 0, toLearn: 0, saidKnown: 0, saidUnknown: 0 }));

async function main() {
  const upTo4 = [1, 2, 3, 4].reduce((a, n) => a + size(n), 0);

  // 1. Nothing known yet, HSK 4 in 60 days: the whole list, which no pace fits.
  const cold = buildPlan({ version: "3.0", level: 4, levels: blank(), today: TODAY, examDate: addDays(TODAY, 60), daily: 10 });
  check(cold.left === upTo4, `no evidence: every word up to HSK 4 is left (${cold.left} of ${upTo4})`);
  check(cold.status === "tight" && cold.pick === null, `…and no pace fits (${cold.status}, needs ${cold.perDay}/day ≈ ${cold.need} min)`);
  check((cold.need ?? 0) > 30, "…the minutes it would take are said, above the 30-minute ceiling");
  check(cold.sweepLevel === 1, `…a sweep from HSK 1 is offered (${cold.sweepLevel})`);
  check(cold.lower !== null && cold.lower.level < 4, `…and a closer level that fits (${JSON.stringify(cold.lower)})`);
  check(!cold.exact, "…labelled an estimate");

  // 2. The check's sample: HSK 1–3 all known, HSK 4 half. The gap is HSK 4's half.
  const sampled = blank().map((l) =>
    l.level <= 3 ? { ...l, have: 6, saidKnown: 6 } : l.level === 4 ? { ...l, have: 3, toLearn: 3, saidKnown: 3, saidUnknown: 3 } : l,
  );
  const warm = buildPlan({ version: "3.0", level: 4, levels: sampled, today: TODAY, examDate: addDays(TODAY, 60), daily: 10 });
  const half4 = 3 + Math.round((size(4) - 6) * 0.5);
  check(warm.left === half4, `sampled: HSK 1–3 count as known, half of HSK 4 left (${warm.left}, expected ${half4})`);
  check(warm.status === "fits" && warm.pick !== null, `…and the date fits at ${warm.pick} min a day (${warm.perDay} words)`);
  check(wordsFor(warm.pick ?? 0) >= (warm.perDay ?? Infinity), "…the picked pace holds the words the date needs");
  const fitting = warm.paces.filter((p) => p.fits);
  check(fitting.length > 0 && fitting[0].minutes === warm.pick, "…the lightest fitting pace is the pick");
  check(warm.sweepLevel === 4, `…the sweep offered is HSK 4, not a level the check says is known (${warm.sweepLevel})`);
  check(
    warm.paces.every((p) => p.fits === p.finish <= warm.examDate!),
    `…a pace is tagged as fitting exactly when its ready day is by the exam (${warm.paces.map((p) => `${p.minutes}:${p.finish}`).join(" ")})`,
  );

  // HSK 4 sampled as unknown: HSK 5 is no sweep candidate either, however unanswered.
  const lost4 = sampled.map((l) => (l.level === 4 ? { ...l, have: 0, toLearn: 6, saidKnown: 0, saidUnknown: 6 } : l));
  const high = buildPlan({ version: "3.0", level: 6, levels: lost4, today: TODAY, examDate: addDays(TODAY, 60), daily: 10 });
  check(high.status === "tight" && high.sweepLevel === null, `no sweep above a level the check says is unknown (${high.sweepLevel})`);

  // 3. A level with no sample borrows from a harder one: 80% of HSK 4 known → HSK 1–3 at least 80%.
  const onlyTop = blank().map((l) => (l.level === 4 ? { ...l, have: 8, toLearn: 2, saidKnown: 8, saidUnknown: 2 } : l));
  const borrowed = buildPlan({ version: "3.0", level: 4, levels: onlyTop, today: TODAY, examDate: null, daily: 10 });
  check(borrowed.left < upTo4 * 0.3, `lower levels borrow HSK 4's rate (${borrowed.left} left of ${upTo4})`);
  check(borrowed.status === "noDate" && borrowed.perDay === null, "no date: no daily number, just paces");
  check(borrowed.paces.every((p, i) => i === 0 || p.finish <= borrowed.paces[i - 1].finish), "a bigger pace never finishes later");

  // 4. Dates at the edges.
  const passed = buildPlan({ version: "3.0", level: 4, levels: sampled, today: TODAY, examDate: addDays(TODAY, -3), daily: 10 });
  check(passed.status === "passed", `a past date says so (${passed.status})`);
  const close = buildPlan({ version: "3.0", level: 4, levels: sampled, today: TODAY, examDate: addDays(TODAY, 2), daily: 10 });
  check(close.status === "close" && close.perDay === null, `two days out: reviews only, no new words (${close.status})`);

  // 5. Before sign-in: "I know HSK 3" counts HSK 1–3 as known, HSK 4 as all left.
  const guest = guestPlan({ version: "3.0", level: 4, known: 3, today: TODAY, examDate: addDays(TODAY, 90), daily: 10 });
  check(guest.left === size(4) && guest.sweepLevel === null, `guest estimate: HSK 4 only (${guest.left}), no sweep offered`);

  // 6. The account: the saved date round-trips, and a sweep of HSK 1 shrinks the plan.
  await prisma.user.create({
    data: { telegramId: TG, firstName: "Plan", hskVersion: "3.0", hskTarget: 4, dailyGoal: 12, invited: true, examDate: new Date(`${addDays(TODAY, 60)}T00:00:00Z`) },
  });
  const before = await planForUser(TG, TODAY);
  check(before.examDate === addDays(TODAY, 60) && before.daysLeft === 60, `the saved day reads back (${before.examDate}, ${before.daysLeft} days)`);
  check(before.current.words === 12, "the current pace is the account's daily goal");
  const l1 = hskLevelWords("3.0", 1).map((w) => w.word);
  // A sweep answers the whole level: the untapped as known, the few tapped as not.
  await savePlacementAnswers(TG, { sourceLang: "zh", targetLang: "ru", known: l1.slice(10), unknown: l1.slice(0, 10) });
  const after = await planForUser(TG, TODAY);
  check(after.left < before.left, `a sweep of HSK 1 lowers the words left (${before.left} → ${after.left})`);
  check(after.sweepLevel !== 1, `…and HSK 1 isn't offered for a sweep again (${after.sweepLevel})`);
}

main()
  .catch((e) => {
    console.error(e);
    failures++;
  })
  .finally(async () => {
    await deleteAccount(TG).catch(() => {});
    await prisma.$disconnect();
    console.log(failures ? `\n${failures} failed` : "\nall passed");
    process.exit(failures ? 1 : 0);
  });
