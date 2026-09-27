// Proves "load a copy back" restores what the export took (BACKLOG "Backups + one
// rehearsed restore").
//
// The export and the import are two halves that can drift apart without either
// failing: add a column to Word, and the export carries it while the import
// quietly drops it — the file looks complete and restores a poorer account. So
// this round-trips a real export through JSON (dates become strings, as in the
// downloaded file) into a second account and compares the learner model field by
// field, then loads it again to prove the second load adds nothing.
//
// Run against a DEV database — it creates two throwaway users and deletes them:
//   cd backend && npx tsx scripts/check-account-import.ts
import { prisma } from "../src/services/db.js";
import { exportAccount, importAccount, deleteAccount } from "../src/services/accountData.js";

const OLD = `test-import-old-${Date.now()}`;
const NEW = `test-import-new-${Date.now()}`;

function expect(cond: unknown, what: string) {
  if (!cond) throw new Error(what);
}

async function main() {
  const old = await prisma.user.create({
    data: {
      telegramId: OLD,
      firstName: "Old",
      folders: { create: { name: "HSK" } },
      coachMemories: { create: { lang: "zh", goal: "pass HSK 4" } },
      placementAnswers: { create: { word: "你好", sourceLang: "zh", targetLang: "ru", level: "HSK1", known: true } },
      readerTexts: {
        create: [
          { title: "Ready", content: "我喜欢读书。", clickedWords: ["读书"] },
          { title: "Half", content: "", status: "generating" },
        ],
      },
    },
  });
  const folder = await prisma.folder.findFirstOrThrow({ where: { userId: old.id } });
  const deck = await prisma.collection.create({
    data: { userId: old.id, name: "Week 3", folderId: folder.id, visibility: "code", shareCode: `imp${Date.now()}` },
  });
  const reviewed = await prisma.word.create({
    data: {
      userId: old.id,
      word: "经验",
      sourceLang: "zh",
      targetLang: "ru",
      phonetic: "jīng yàn",
      meaningZh: "опыт",
      collocations: ["积累经验"],
      senses: { v: 1, list: [{ pos: "n", meaning: "опыт", phrases: [] }] },
      stability: 12.5,
      difficulty: 5.1,
      state: 2,
      reps: 4,
      lapses: 1,
      due: new Date("2026-10-05T08:00:00Z"),
      nextReviewAt: new Date("2026-10-05T08:00:00Z"),
      lastReview: new Date("2026-09-20T08:00:00Z"),
      produceAttempts: 3,
      produceCorrect: 2,
      produceStreak: 2,
      canUseAt: new Date("2026-09-21T08:00:00Z"),
      createdAt: new Date("2026-09-01T08:00:00Z"),
      examples: { create: { sentenceEn: "У него большой опыт.", sentenceZh: "他很有经验。", sourceName: "Lexa AI", sourceUrl: "", level: "HSK4" } },
      collections: { connect: { id: deck.id } },
    },
  });
  const fresh = await prisma.word.create({
    data: {
      userId: old.id,
      word: "机会",
      sourceLang: "zh",
      targetLang: "ru",
      createdAt: new Date("2026-09-02T08:00:00Z"),
      collections: { create: { userId: old.id, name: "Week 4", folderId: folder.id } },
    },
  });
  await prisma.reviewEvent.createMany({
    data: [
      { userId: old.id, wordId: reviewed.id, grade: 3, createdAt: new Date("2026-09-10T08:00:00Z") },
      { userId: old.id, wordId: reviewed.id, grade: 1, source: "quiz", createdAt: new Date("2026-09-15T08:00:00Z") },
      // A card deleted before the export: the review stays, with no card.
      { userId: old.id, wordId: null, grade: 4, createdAt: new Date("2026-09-16T08:00:00Z") },
    ],
  });
  await prisma.productionEvent.create({
    data: { userId: old.id, wordId: reviewed.id, verdict: "correct", createdAt: new Date("2026-09-21T08:00:00Z") },
  });

  // The file as the learner downloads it: dates are strings after this.
  const file = JSON.parse(JSON.stringify(await exportAccount(OLD)));

  const neu = await prisma.user.create({ data: { telegramId: NEW, firstName: "New" } });
  // The new account already has a deck by the same name; the import reuses it.
  await prisma.collection.create({ data: { userId: neu.id, name: "Week 3" } });

  const first = await importAccount(NEW, file);
  expect(first, "import returned null for a user that exists");
  console.log("first load:", first);
  expect(first!.words === 2 && first!.skipped === 0, `expected 2 cards added, got ${first!.words} (skipped ${first!.skipped})`);
  expect(first!.reviews === 3 && first!.uses === 1, "reviews/uses not all loaded");
  expect(first!.texts === 1, "the half-generated reader text should be left out, the ready one kept");
  expect(first!.collections === 1, "expected 'Week 4' created and the existing 'Week 3' reused, not duplicated");

  const got = await prisma.word.findFirstOrThrow({
    where: { userId: neu.id, word: "经验" },
    include: { examples: true, collections: { select: { name: true, userId: true, visibility: true, shareCode: true, folder: true } } },
  });
  expect(got.id !== reviewed.id, "the card kept the old account's id");
  for (const k of [
    "sourceLang", "targetLang", "phonetic", "meaningZh", "stability", "difficulty", "state", "reps", "lapses",
    "produceAttempts", "produceCorrect", "produceStreak",
  ] as const) {
    expect(got[k] === reviewed[k], `${k}: ${String(got[k])} ≠ ${String(reviewed[k])}`);
  }
  for (const k of ["due", "nextReviewAt", "lastReview", "canUseAt", "createdAt"] as const) {
    expect(got[k]?.getTime() === reviewed[k]?.getTime(), `${k} changed on the way through`);
  }
  expect(JSON.stringify(got.senses) === JSON.stringify(reviewed.senses), "senses changed");
  expect(got.collocations.join() === "积累经验", "collocations lost");
  expect(got.examples.length === 1 && got.examples[0].sentenceZh === "他很有经验。", "example lost");
  const inDeck = got.collections[0];
  expect(inDeck?.name === "Week 3" && inDeck.userId === neu.id, "card not back in its deck");
  expect(inDeck.visibility === "private" && inDeck.shareCode === null, "the deck should come back private, without the old share code");
  const week4 = await prisma.collection.findFirstOrThrow({
    where: { userId: neu.id, name: "Week 4" },
    include: { folder: true, words: { select: { word: true } } },
  });
  expect(week4.folder?.name === "HSK" && week4.folder.userId === neu.id, "the new deck's folder wasn't recreated");
  expect(week4.words.map((w) => w.word).join() === "机会", "'Week 4' lost its card");
  const events = await prisma.reviewEvent.findMany({ where: { userId: neu.id }, orderBy: { createdAt: "asc" } });
  expect(events.map((e) => e.grade).join() === "3,1,4", "review grades out of order or lost");
  expect(events[0].wordId === got.id && events[1].wordId === got.id, "reviews point at the old account's card");
  expect(events[1].source === "quiz" && events[2].wordId === null, "review source / orphan review lost");
  const use = await prisma.productionEvent.findFirstOrThrow({ where: { userId: neu.id } });
  expect(use.wordId === got.id && use.verdict === "correct", "'can use' attempt not remapped");
  expect(
    (await prisma.placementAnswer.count({ where: { userId: neu.id, word: "你好", known: true } })) === 1 &&
      (await prisma.coachMemory.count({ where: { userId: neu.id, goal: "pass HSK 4" } })) === 1,
    "placement answer / coach memory lost",
  );
  const text = await prisma.readerText.findFirstOrThrow({ where: { userId: neu.id } });
  expect(text.title === "Ready" && text.clickedWords.join() === "读书", "reader text lost");
  expect((await prisma.word.count({ where: { userId: neu.id, word: fresh.word } })) === 1, "the new card was lost");
  console.log("first load: every field across, ids remapped — ok");

  // Loading the same file again changes nothing.
  const again = await importAccount(NEW, file);
  console.log("second load:", again);
  expect(
    again!.words === 0 && again!.skipped === 2 && again!.reviews === 0 && again!.uses === 0 && again!.texts === 0 && again!.collections === 0,
    "a second load added rows",
  );
  expect((await prisma.example.count({ where: { word: { userId: neu.id } } })) === 1, "a second load duplicated examples");

  // Into the account it came from (it's still there during the grace period): nothing new.
  const self = await importAccount(OLD, file);
  expect(self!.words === 0 && self!.reviews === 0 && self!.uses === 0, "loading into the source account added rows");
  expect((await prisma.collection.findUniqueOrThrow({ where: { id: deck.id } })).shareCode !== null, "the source deck lost its share code");
  console.log("second load and load-into-self: nothing added — ok");

  // A file that is the right shape but full of junk must not throw.
  const junk = await importAccount(NEW, {
    words: [1, null, "x", { word: "" }, { word: 5 }, { word: "垃圾", createdAt: "not a date", state: "2", examples: [{}], collections: [{ name: "nope" }] }],
    reviewEvents: [{ createdAt: "nope" }, { grade: 3 }],
    productionEvents: [{ createdAt: "2026-09-01T00:00:00Z" }],
    collections: "no",
  });
  expect(junk!.words === 1 && junk!.reviews === 0 && junk!.uses === 0, `junk file: ${JSON.stringify(junk)}`);
  const j = await prisma.word.findFirstOrThrow({ where: { userId: neu.id, word: "垃圾" }, include: { examples: true } });
  expect(j.state === 0 && j.examples.length === 0, "junk fields were taken at face value");
  console.log("junk file: the one usable card kept, the rest ignored — ok");
}

main()
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await deleteAccount(NEW).catch(() => {});
    await deleteAccount(OLD).catch(() => {});
    await prisma.$disconnect();
  });
