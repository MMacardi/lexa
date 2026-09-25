// Proves Stop on a batch of new cards is an undo (BACKLOG: "I stopped but it
// still created"): the batch's cards go, except one the learner has reviewed.
// With `--live`, also that one model call turns a batch's dictionary English
// into Russian meanings before any per-card upgrade runs.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-import-stop.ts [--live]
const LIVE = process.argv.includes("--live");
if (!LIVE) process.env.BAILIAN_API_KEY = "";

const { prisma } = await import("../src/services/db.js");
const { importWordsForUser } = await import("../src/services/importWords.js");
const { cancelImportJobForUser } = await import("../src/services/importWorker.js");
const { translateDictMeanings, hasDictMeaning } = await import("../src/services/capture.js");
const { deleteAccount } = await import("../src/services/accountData.js");

const TG = `test-import-stop-${Date.now()}`;
let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}
const item = (word: string) => ({ word, meaning: "", example: "", exampleTranslation: "", synonyms: [] });

async function main() {
  await prisma.user.create({ data: { telegramId: TG, firstName: "Stop", nativeLang: "ru" } });
  const r = await importWordsForUser({
    telegramId: TG,
    sourceLang: "zh",
    targetLang: "ru",
    items: ["请假", "理发", "因此", "经济"].map(item),
    generateDetails: true,
  });
  check(r.created === 4 && Boolean(r.job), `4 cards made at once, job ${r.job?.id}`);
  // One of them the learner has already reviewed: it has a schedule now.
  await prisma.word.updateMany({ where: { user: { telegramId: TG }, word: "经济" }, data: { reps: 1, reviewCount: 1 } });

  const stopped = await cancelImportJobForUser(r.job!.id, TG);
  const left = await prisma.word.findMany({ where: { user: { telegramId: TG } }, select: { word: true } });
  check(stopped?.status === "cancelled", `job ${stopped?.status}`);
  check(stopped?.removed === 3, `Stop removed ${stopped?.removed} of 4`);
  check(left.length === 1 && left[0].word === "经济", `left: ${left.map((w) => w.word).join(", ")} (the reviewed one)`);

  if (LIVE) {
    const b = await importWordsForUser({ telegramId: TG, sourceLang: "zh", targetLang: "ru", items: ["骄傲", "购物", "整齐"].map(item) });
    const ids = (await prisma.word.findMany({ where: { user: { telegramId: TG }, word: { in: ["骄傲", "购物", "整齐"] } }, select: { id: true } })).map((w) => w.id);
    check(b.created === 3, "3 more cards, still the dictionary's English");
    const t0 = Date.now();
    await translateDictMeanings(ids);
    const ms = Date.now() - t0;
    const cards = await prisma.word.findMany({ where: { id: { in: ids } } });
    for (const c of cards) check(!hasDictMeaning(c) && /[а-яё]/i.test(c.meaningZh ?? ""), `${c.word}: "${c.meaningZh}"`);
    check(ms < 20_000, `one call for the batch: ${ms} ms`);
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
