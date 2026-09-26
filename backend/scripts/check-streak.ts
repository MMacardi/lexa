// Proves the streak Today shows is the real one (BACKLOG "The streak and 'today's
// goal done' on Today").
//
// It used to be counted off the 14-day chart series, so the longest streak anyone
// could ever see was 14 — the day the number matters most, it stopped growing.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-streak.ts
import { prisma } from "../src/services/db.js";
import { getStats } from "../src/services/vocab.js";
import { deleteAccount } from "../src/services/accountData.js";

const TG = `test-streak-${Date.now()}`;

async function main() {
  const user = await prisma.user.create({ data: { telegramId: TG, firstName: "Streak" } });
  const noon = (daysAgo: number) => {
    const d = new Date(Date.now() - daysAgo * 86400_000);
    d.setHours(12, 0, 0, 0);
    return d;
  };
  const fails: string[] = [];

  // 20 days in a row, ending yesterday: today still empty must not break it.
  await prisma.reviewEvent.createMany({
    data: Array.from({ length: 20 }, (_, i) => ({ userId: user.id, grade: 3, createdAt: noon(i + 1) })),
  });
  let s = await getStats(TG);
  if (s.streak !== 20) fails.push(`20 days ending yesterday: streak ${s.streak}, want 20`);

  // Review today → 21.
  await prisma.reviewEvent.create({ data: { userId: user.id, grade: 3, createdAt: noon(0) } });
  s = await getStats(TG);
  if (s.streak !== 21) fails.push(`plus today: streak ${s.streak}, want 21`);

  // A gap 3 days ago cuts it back to the last 3 days.
  const d3 = noon(3);
  await prisma.reviewEvent.deleteMany({
    where: { userId: user.id, createdAt: { gte: new Date(d3.getTime() - 43_200_000), lt: new Date(d3.getTime() + 43_200_000) } },
  });
  s = await getStats(TG);
  if (s.streak !== 3) fails.push(`gap 3 days ago: streak ${s.streak}, want 3`);

  await deleteAccount(TG);
  if (fails.length) {
    console.error("FAIL\n- " + fails.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log("PASS — 20 days → 20, +today → 21, a gap 3 days back → 3");
  }
}

main()
  .catch(async (e) => {
    console.error(e);
    await deleteAccount(TG).catch(() => {});
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
