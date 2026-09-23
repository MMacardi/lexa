// Proves "delete my account" really empties the account (BACKLOG H3).
//
// Worth a script rather than a one-off test because the failure is silent: half
// this schema owns a user through a foreign key and half just carries the id as
// a plain string (ReviewEvent.userId, AnalyticsEvent.telegramId, UsageCounter.key).
// Add a table of the second kind, forget to list it in services/accountData.ts,
// and the account is "deleted" with its learner model still sitting in Postgres.
// Nothing else in the app would ever notice.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-account-delete.ts
import { prisma } from "../src/services/db.js";
import { exportAccount, deleteAccount } from "../src/services/accountData.js";

const TG = `test-delete-${Date.now()}`;

async function main() {
  // A user with a row in every table the delete has to reach.
  const user = await prisma.user.create({
    data: {
      telegramId: TG,
      firstName: "Delete",
      email: `${TG}@example.test`,
      nativeLang: "ru",
      hskVersion: "2.0",
      hskTarget: 4,
      identities: { create: { provider: "email", subject: `${TG}@example.test` } },
      collections: { create: { name: "H3 test deck" } },
      folders: { create: { name: "H3 test folder" } },
      readerTexts: { create: { title: "t", content: "c" } },
      coachMemories: { create: { lang: "zh" } },
      placementAnswers: { create: { word: "你好", sourceLang: "zh", targetLang: "ru", known: true } },
      sceneSessions: { create: { title: "s", bible: {} } },
    },
  });
  const word = await prisma.word.create({
    data: {
      userId: user.id,
      word: "测试",
      sourceLang: "zh",
      targetLang: "ru",
      meaningZh: "тест",
      examples: { create: { sentenceEn: "e", sentenceZh: "例", sourceName: "n", sourceUrl: "u" } },
    },
  });
  await prisma.reviewEvent.create({ data: { userId: user.id, wordId: word.id, grade: 3 } });
  await prisma.productionEvent.create({ data: { userId: user.id, wordId: word.id, verdict: "correct" } });
  await prisma.analyticsEvent.create({ data: { name: "review", telegramId: TG } });
  await prisma.tokenUsage.create({ data: { feature: "gloss", model: "qwen-plus", telegramId: TG, totalTokens: 42 } });
  await prisma.usageCounter.createMany({
    data: [
      { key: `d:${TG}:20000`, count: 3, resetAt: new Date(Date.now() + 86_400_000) },
      { key: `m:${TG}:24300:ocr`, count: 1, resetAt: new Date(Date.now() + 86_400_000) },
    ],
  });

  // Export first — it has to see the data before the delete removes it.
  const dump = await exportAccount(TG);
  if (!dump) throw new Error("export returned null for a user that exists");
  const has = (k: string) => Array.isArray((dump as Record<string, unknown[]>)[k]) && (dump as Record<string, unknown[]>)[k].length > 0;
  const missing = [
    "words",
    "collections",
    "folders",
    "readerTexts",
    "sceneSessions",
    "coachMemories",
    "placementAnswers",
    "reviewEvents",
    "productionEvents",
    "analyticsEvents",
    "aiUsage",
  ].filter((k) => !has(k));
  if (missing.length) throw new Error(`export is missing rows for: ${missing.join(", ")}`);
  if (!JSON.stringify(dump).includes("测试")) throw new Error("export doesn't contain the learner's own card");
  console.log(`export: ${Object.keys(dump).length} sections, ${JSON.stringify(dump).length} bytes — ok`);

  // The delete itself. This is the call that fails on a foreign key if Word ever
  // stops being deleted by hand.
  const ok = await deleteAccount(TG);
  if (!ok) throw new Error("deleteAccount returned false for a user that exists");

  // Nothing bearing either id may survive.
  const left: string[] = [];
  const count = async (label: string, n: Promise<number>) => {
    if ((await n) > 0) left.push(label);
  };
  await Promise.all([
    count("user", prisma.user.count({ where: { telegramId: TG } })),
    count("words", prisma.word.count({ where: { userId: user.id } })),
    count("examples", prisma.example.count({ where: { wordId: word.id } })),
    count("collections", prisma.collection.count({ where: { userId: user.id } })),
    count("folders", prisma.folder.count({ where: { userId: user.id } })),
    count("readerTexts", prisma.readerText.count({ where: { userId: user.id } })),
    count("sceneSessions", prisma.sceneSession.count({ where: { userId: user.id } })),
    count("coachMemories", prisma.coachMemory.count({ where: { userId: user.id } })),
    count("placementAnswers", prisma.placementAnswer.count({ where: { userId: user.id } })),
    count("identities", prisma.authIdentity.count({ where: { userId: user.id } })),
    count("reviewEvents", prisma.reviewEvent.count({ where: { userId: user.id } })),
    count("productionEvents", prisma.productionEvent.count({ where: { userId: user.id } })),
    count("analyticsEvents", prisma.analyticsEvent.count({ where: { telegramId: TG } })),
    count("usageCounters", prisma.usageCounter.count({ where: { key: { contains: TG } } })),
    // TokenUsage is kept on purpose, but must no longer name anybody.
    count("tokenUsage(named)", prisma.tokenUsage.count({ where: { telegramId: TG } })),
  ]);
  if (left.length) throw new Error(`rows left behind after delete: ${left.join(", ")}`);

  const keptCost = await prisma.tokenUsage.count({ where: { feature: "gloss", totalTokens: 42, telegramId: null } });
  if (keptCost === 0) throw new Error("the anonymised cost row was deleted instead of kept");
  console.log("delete: nothing left behind, cost row kept and anonymised — ok");
}

main()
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
