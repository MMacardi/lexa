// The review card's back, sense by sense: a meaning that joins two senses or more
// (当 «быть (кем-л.), работать кем-л.; когда») comes in the word list part by part,
// each part with its sense's first phrase, so the card shows every sense in use and
// not only the one its example sentence happens to show.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-card-senses.ts
import { prisma } from "../src/services/db.js";
import { listWordsForUser } from "../src/services/vocab.js";

const TG = `test-card-senses-${Date.now()}`;
let failed = 0;
const check = (ok: boolean, what: string, got?: unknown) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!ok) failed++;
};

async function main() {
  const user = await prisma.user.create({ data: { telegramId: TG, firstName: "Senses", nativeLang: "ru" } });
  const card = (word: string, phonetic: string, meaningZh: string, sourceLang = "zh", targetLang = "ru") =>
    prisma.word.create({ data: { userId: user.id, word, phonetic, meaningZh, sourceLang, targetLang } });
  await card("当", "dāng", "быть (кем-л.), работать кем-л.; когда");
  await card("还", "hái", "ещё, всё ещё, также; возвращать, отдавать долг");
  await card("富", "fù", "богатый, состоятельный");
  await card("对", "duì", "что-то своё; совсем другое"); // written by hand: no sense of 对
  await card("run", "", "бежать; управлять", "en", "ru"); // no word page, nothing cached

  const words = await listWordsForUser(TG);
  const of = (w: string) => words.find((x) => x.word === w)?.cardSenses;

  const dang = of("当");
  check(dang?.length === 2, "当: two lines, one per sense on the card", dang);
  check(dang?.[0]?.meaning === "быть (кем-л.), работать кем-л." && dang[0].phrase?.text === "当老师", "当 1: the card's wording, 当老师", dang?.[0]);
  check(dang?.[1]?.meaning === "когда" && dang[1].phrase?.text === "当他来的时候", "当 2: «когда» with the preposition's phrase", dang?.[1]);
  check(!dang?.some((l) => l.reading), "当: no reading where the senses read as the card", dang);

  const hai = of("还");
  check(hai?.length === 2 && hai[0].phrase?.text === "还有" && hai[1].phrase?.text === "还钱", "还: 还有 / 还钱", hai);
  check(!hai?.[0]?.reading && hai?.[1]?.reading === "huán", "还 2 says it is read huán", hai);

  check(of("富") === undefined, "富: one sense, the card stays as it is", of("富"));
  check(of("对") === undefined, "对: a hand-written meaning matches no sense, left alone", of("对"));
  check(of("run") === undefined, "run: no senses at hand, left alone", of("run"));
}

main()
  .catch((e) => {
    console.error(e);
    failed++;
  })
  .finally(async () => {
    await prisma.word.deleteMany({ where: { user: { telegramId: TG } } });
    await prisma.user.deleteMany({ where: { telegramId: TG } });
    await prisma.$disconnect();
    console.log(failed ? `\n${failed} failed` : "\nall passed");
    process.exit(failed ? 1 : 0);
  });
