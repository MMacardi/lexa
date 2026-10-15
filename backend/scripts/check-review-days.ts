// Proves the scheduling on top of FSRS (services/schedule.ts, the author 2026-10-15)
// and Flashcards' whole-level mode:
//  - a review days away is due from 04:00 on its day in the learner's zone (a word
//    graded at 21:00 is due the next morning, not the next evening), across a DST
//    change and before the 04:00 rollover; steps of minutes stay minutes;
//  - the zone comes from the browser on a web grade and is kept, so the bot's grades
//    (no zone sent) land on the same days; writing is placed the same way;
//  - before the exam: a review that would first come on or after the exam day with
//    under 95% recall left moves into the last 5 days before it, spread over them; one
//    with recall to spare, or due before the exam, stays; an exam tomorrow moves
//    nothing; cards scheduled earlier are brought in once, and a second run moves none;
//  - a quiz's right answer on a card not due yet is logged and moves nothing (a choice
//    of four is right by luck one time in four); a miss, or a right answer when due, is graded;
//  - the whole level: every word of it with no card and no "I know it", the words said
//    unknown first, as ready-made cards a few at a time.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-review-days.ts
import { fsrs, generatorParameters, State, type Card } from "ts-fsrs";
import { prisma } from "../src/services/db.js";
import { hskLevelWords } from "../src/services/hsk.js";
import { savePlacementAnswers } from "../src/services/learnerPrefs.js";
import { pullInForExam, recordReview, recordWriting } from "../src/services/vocab.js";
import { hskLevelLeft, learnWord, levelCards } from "../src/services/newWords.js";
import { EXAM_RECALL, placeDue, type Placing } from "../src/services/schedule.js";
import { deleteAccount } from "../src/services/accountData.js";

const TG = `test-review-days-${Date.now()}`;
const DAY = 86_400_000;
let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

/** "18/10/2026, 04:00" — the wall clock in `tz`. */
const clock = (t: Date, tz: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(t);

const f = fsrs(generatorParameters({ request_retention: 0.9, enable_fuzz: false }));
const recall = (c: Card, at: Date) => f.get_retrievability(c, at, false);
/** A card FSRS has just put `days` out with stability `s`. */
const reviewCard = (now: Date, days: number, s = days): Card => ({
  due: new Date(now.getTime() + days * DAY),
  stability: s,
  difficulty: 5,
  elapsed_days: 0,
  scheduled_days: days,
  learning_steps: 0,
  reps: 3,
  lapses: 0,
  state: State.Review,
  last_review: now,
});
const place = (card: Card, now: Date, p: Partial<Placing>) =>
  placeDue(card, now, { tz: "Europe/Moscow", examDate: null, key: "k", recall, ...p });

function byTheDay() {
  const MSK = "Europe/Moscow";
  const evening = new Date("2026-10-15T18:00:00Z"); // 21:00 in Moscow
  const d3 = place(reviewCard(evening, 3), evening, {});
  check(clock(d3, MSK) === "18/10/2026, 04:00", `graded at 21:00, 3 days → ${clock(d3, MSK)} (not 21:00)`);
  const steps = { ...reviewCard(evening, 0), state: State.Learning, due: new Date(evening.getTime() + 10 * 60_000) };
  check(place(steps, evening, {}).getTime() === steps.due.getTime(), "a 10-minute step stays 10 minutes");
  const night = new Date("2026-10-15T23:30:00Z"); // 02:30 on the 16th: still the 15th's study day
  const d1 = place(reviewCard(night, 1), night, {});
  check(clock(d1, MSK) === "16/10/2026, 04:00", `graded at 02:30, 1 day → ${clock(d1, MSK)}`);
  const berlin = new Date("2026-10-24T19:00:00Z"); // 21:00 CEST; clocks go back on the 25th
  const dst = place(reviewCard(berlin, 2), berlin, { tz: "Europe/Berlin" });
  check(dst.toISOString() === "2026-10-26T03:00:00.000Z", `across the DST change: ${clock(dst, "Europe/Berlin")} CET`);
  const sh = new Date("2026-10-15T12:00:00Z"); // 20:00 in Shanghai
  const d = place(reviewCard(sh, 1), sh, { tz: "Asia/Shanghai" });
  check(clock(d, "Asia/Shanghai") === "16/10/2026, 04:00", `Shanghai: ${clock(d, "Asia/Shanghai")}`);
}

function beforeTheExam() {
  const MSK = "Europe/Moscow";
  const now = new Date("2026-10-15T18:00:00Z");
  const examDate = new Date(Date.UTC(2026, 10, 4)); // 20 days on
  const window = ["30/10", "31/10", "01/11", "02/11", "03/11"].map((d) => `${d}/2026, 04:00`);
  const late = reviewCard(now, 25);
  const r = recall(late, new Date("2026-11-04T01:00:00Z"));
  const pulled = place(late, now, { examDate });
  check(r < EXAM_RECALL && window.includes(clock(pulled, MSK)), `due 9 Nov, ${(r * 100).toFixed(1)}% on exam day → ${clock(pulled, MSK)}`);
  const safe = reviewCard(now, 400);
  const kept = place(safe, now, { examDate });
  check(kept.getTime() > examDate.getTime() + 300 * DAY, `due in 400 days, ${(recall(safe, examDate) * 100).toFixed(1)}% on exam day → stays`);
  const early = place(reviewCard(now, 10), now, { examDate });
  check(clock(early, MSK) === "25/10/2026, 04:00", "due before the exam → stays");
  const tomorrow = place(late, now, { examDate: new Date(Date.UTC(2026, 9, 16)) });
  check(tomorrow > new Date("2026-11-01T00:00:00Z"), "exam tomorrow → nothing moved");
  const days = new Set(Array.from({ length: 30 }, (_, i) => clock(place(late, now, { examDate, key: `card-${i}` }), MSK)));
  check(days.size >= 4 && [...days].every((d) => window.includes(d)), `30 cards spread over ${days.size} of the 5 days`);
}

async function onTheAccount() {
  const user = await prisma.user.create({
    data: { telegramId: TG, firstName: "Days", hskVersion: "3.0", hskTarget: 4, dailyGoal: 5, nativeLang: "ru", invited: true },
  });
  const SH = "Asia/Shanghai";
  const card = await prisma.word.create({
    data: { userId: user.id, word: "学习", sourceLang: "zh", targetLang: "ru", collocations: [], synonyms: [], antonyms: [] },
  });
  const first = await recordReview(card.id, 3, undefined, "review", SH);
  const mins = (first!.due!.getTime() - Date.now()) / 60_000;
  check(mins > 5 && mins < 11, `a new card's Good: back in ${mins.toFixed(0)} min`);
  check((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).timeZone === SH, "the browser's zone is kept on the account");
  // The bot sends no zone: the account's is used.
  const second = await recordReview(card.id, 3);
  check(
    clock(second!.due!, SH).endsWith("04:00") && second!.nextReviewAt!.getTime() === second!.due!.getTime(),
    `graduated, graded with no zone → ${clock(second!.due!, SH)} Shanghai`,
  );
  await recordWriting(card.id, 3, undefined, SH);
  const w = await recordWriting(card.id, 3);
  check(clock(w!.writeDue!, SH).endsWith("04:00"), `writing placed the same way → ${clock(w!.writeDue!, SH)}`);

  // Scheduled before there was an exam date: brought in once.
  const now = new Date();
  const exam = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 20));
  await prisma.user.update({ where: { id: user.id }, data: { examDate: exam } });
  const old = await prisma.word.create({
    data: {
      userId: user.id, word: "认真", sourceLang: "zh", targetLang: "ru", collocations: [], synonyms: [], antonyms: [],
      state: 2, stability: 25, difficulty: 5, reps: 3, lastReview: now,
      due: new Date(now.getTime() + 25 * DAY), nextReviewAt: new Date(now.getTime() + 25 * DAY),
      writeState: 2, writeStability: 400, writeDifficulty: 5, writeReps: 3, writeLast: now, writeDue: new Date(now.getTime() + 400 * DAY),
    },
  });
  const moved = await pullInForExam(user.id);
  const after = await prisma.word.findUniqueOrThrow({ where: { id: old.id } });
  const before = (exam.getTime() - after.due!.getTime()) / DAY;
  check(moved === 1 && before > 0 && before <= 6 && clock(after.due!, SH).endsWith("04:00"), `due in 25 days, exam in 20 → ${clock(after.due!, SH)}`);
  check(after.writeDue!.getTime() === old.writeDue!.getTime(), "its writing review, 400 days out with recall to spare, stays");
  check(after.nextReviewAt!.getTime() === after.due!.getTime(), "nextReviewAt moved with it");
  check((await pullInForExam(user.id)) === 0, "a second run moves nothing");
}

// A quiz's right answer moves a card only when it is due: one in four is luck.
async function quizOnlyWhenDue() {
  const user = await prisma.user.findUniqueOrThrow({ where: { telegramId: TG } });
  const now = new Date();
  const later = new Date(now.getTime() + 10 * DAY);
  const made = await prisma.word.create({
    data: {
      userId: user.id, word: "习惯", sourceLang: "zh", targetLang: "ru", collocations: [], synonyms: [], antonyms: [],
      state: 2, stability: 10, difficulty: 5, reps: 3, lastReview: new Date(now.getTime() - DAY), due: later, nextReviewAt: later,
    },
  });
  const logged = () => prisma.reviewEvent.count({ where: { wordId: made.id, source: "quiz" } });
  await recordReview(made.id, 3, undefined, "quiz");
  const right = await prisma.word.findUniqueOrThrow({ where: { id: made.id } });
  check(right.due!.getTime() === later.getTime() && right.reps === 3 && (await logged()) === 1, "right in a quiz before it is due: logged, schedule unchanged");
  await recordReview(made.id, 1, undefined, "quiz");
  const missed = await prisma.word.findUniqueOrThrow({ where: { id: made.id } });
  check(missed.lapses === 1 && missed.due!.getTime() < later.getTime() && (await logged()) === 2, "missed in a quiz before it is due: a lapse, graded");
  const due = new Date(now.getTime() - 60_000);
  await prisma.word.update({ where: { id: made.id }, data: { state: 2, due, nextReviewAt: due, lapses: 0 } });
  await recordReview(made.id, 3, undefined, "quiz");
  const onTime = await prisma.word.findUniqueOrThrow({ where: { id: made.id } });
  check(onTime.due!.getTime() > now.getTime() + DAY / 2 && onTime.reps === 5, "right in a quiz when due: graded Good");
}

async function wholeLevel() {
  const level = hskLevelWords("3.0", 4).map((w) => w.word);
  const start = await hskLevelLeft(TG);
  check(
    start.level === 4 && start.total === level.length && start.words.length === level.length && start.words.every((w) => level.includes(w.word)),
    `all ${start.words.length} HSK 4 words, none of another level (first: ${start.words.slice(0, 5).map((w) => w.word).join(" ")})`,
  );
  const [a, b, c, d] = start.words.map((w) => w.word);
  await learnWord(TG, { word: a, grade: 3, source: "review" });
  await learnWord(TG, { word: b, grade: 4, source: "review" });
  const after = await hskLevelLeft(TG);
  check(after.words.length === level.length - 2 && !after.words.some((w) => w.word === a || w.word === b), `${a} (a card) and ${b} (known) leave it`);
  const last = after.words[after.words.length - 1].word;
  await savePlacementAnswers(TG, { sourceLang: "zh", targetLang: "ru", known: [], unknown: [last] });
  check((await hskLevelLeft(TG)).words[0].word === last, `${last}, said unknown, comes first`);
  const cards = await levelCards(TG, [c, d, "不是词语", c]);
  check(
    cards.length === 2 && cards.every((x) => x.id.startsWith("new:") && /[а-яё]/i.test(x.meaningZh ?? "") && x.phonetic),
    `as cards: ${cards.map((x) => `${x.word} «${x.meaningZh}»`).join(", ")}; off the list and repeats left out`,
  );
}

try {
  byTheDay();
  beforeTheExam();
  await onTheAccount();
  await quizOnlyWhenDue();
  await wholeLevel();
} finally {
  await deleteAccount(TG);
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
