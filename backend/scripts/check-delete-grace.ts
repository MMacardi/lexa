// Proves the deletion grace period (BACKLOG "A grace period on account deletion").
//
// "Delete" now schedules rather than erases, so four things have to hold at once:
// scheduling keeps every row; "keep my account" cancels it; the purge erases an
// account past its date — completely, via deleteAccount — and nothing before it;
// and an account on its way out gets no review nudges.
//
// Run against a DEV database — it creates throwaway users and deletes them:
//   cd backend && npx tsx scripts/check-delete-grace.ts
import { prisma } from "../src/services/db.js";
import { cancelDeletion, deleteAccount, purgeDueDeletions, scheduleDeletion, DELETE_GRACE_DAYS } from "../src/services/accountData.js";
import { usersToRemindAt } from "../src/services/botTutor.js";

const A = `test-grace-a-${Date.now()}`;
const B = `test-grace-b-${Date.now()}`;
const fails: string[] = [];
const expect = (ok: boolean, what: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) fails.push(what);
};

async function seed(telegramId: string) {
  const user = await prisma.user.create({ data: { telegramId, firstName: "Grace", reminderHour: 9, botChatId: `chat-${telegramId}` } });
  const word = await prisma.word.create({ data: { userId: user.id, word: "保留", sourceLang: "zh", targetLang: "ru", meaningZh: "сохранить" } });
  await prisma.reviewEvent.create({ data: { userId: user.id, wordId: word.id, grade: 3 } });
  return user;
}
const cards = (telegramId: string) => prisma.word.count({ where: { user: { telegramId } } });

async function main() {
  const a = await seed(A);
  await seed(B);

  // 1. Scheduling keeps everything, and says when.
  const when = await scheduleDeletion(A);
  const days = when ? (when.getTime() - Date.now()) / 86_400_000 : 0;
  expect(Math.abs(days - DELETE_GRACE_DAYS) < 0.01, `scheduled ${DELETE_GRACE_DAYS} days out (got ${days.toFixed(2)})`);
  expect((await cards(A)) === 1, "the cards are still there while it waits");
  expect(!(await usersToRemindAt(9)).some((u) => u.telegramId === A), "an account waiting to be erased gets no reminder");
  expect((await usersToRemindAt(9)).some((u) => u.telegramId === B), "…while an ordinary one still does");

  // 2. Keep my account.
  expect(await cancelDeletion(A), "“keep my account” cancels it");
  expect((await prisma.user.findUnique({ where: { telegramId: A } }))?.deleteAfter === null, "…and the date is gone");

  // 3. The purge: past its date → erased, completely; not yet due → untouched.
  await scheduleDeletion(A, new Date(Date.now() - (DELETE_GRACE_DAYS + 1) * 86_400_000));
  await scheduleDeletion(B);
  const n = await purgeDueDeletions();
  expect(n >= 1, `the purge erased the account past its date (${n})`);
  expect(!(await prisma.user.findUnique({ where: { telegramId: A } })), "…the account row is gone");
  const reviews = await prisma.reviewEvent.count({ where: { userId: a.id } });
  expect((await cards(A)) === 0 && reviews === 0, "…and its cards and review log");
  expect((await cards(B)) === 1, "an account still inside its grace period is untouched");
}

main()
  .catch((e) => {
    console.error(e);
    fails.push(String(e));
  })
  .finally(async () => {
    await deleteAccount(A).catch(() => {});
    await deleteAccount(B).catch(() => {});
    console.log(fails.length ? `\n${fails.length} check(s) failed` : "\nall checks passed");
    await prisma.$disconnect();
    process.exit(fails.length ? 1 : 0);
  });
