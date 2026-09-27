// Proves "Sentences one step above you (i+1)" (BACKLOG): an example uses the new
// word and, besides it, words the learner has — so the same HSK 4 word gets a
// different sentence at HSK 2 than at HSK 5.
//
//   1. The words of a sentence as the check reads them (桌上 is 桌 + 上; 晚上 is
//      not 上; 看一下 has 一下 in it).
//   2. Two accounts that took the check — one at HSK 2, one at HSK 5 — are handed
//      the pool sentence each reads best, for every HSK 3.0 level-4 word.
//   3. The add path, with the model unreachable: the card carries that sentence
//      the moment it returns, the day's batch too. A fresh learner with nothing
//      to go on gets none — the per-card call writes theirs.
//   4. On open, a pool sentence the learner has outgrown moves up.
//   `--live`: the learner's own sentence — on their interests, at their level —
//   lands first with the pool's second; one over the line is rewritten to fewer
//   unknowns; a card the pool can't serve gets one from the learner's words.
//
// Needs data/hsk-sentences.jsonl (scripts/build-hsk-sentences.ts). Run against a
// DEV database — it creates throwaway users and deletes them:
//   cd backend && npx tsx scripts/check-sentences.ts [--live]
const LIVE = process.argv.includes("--live");
// Before anything reads env: dotenv leaves a variable that is already set alone.
if (!LIVE) process.env.BAILIAN_API_KEY = "";

const { prisma } = await import("../src/services/db.js");
const { hskLevelWords } = await import("../src/services/hsk.js");
const { addWordForUser, countAiExamples, getWord } = await import("../src/services/vocab.js");
const { importWordsForUser } = await import("../src/services/importWords.js");
const { upgradeCard } = await import("../src/services/capture.js");
const { deleteAccount } = await import("../src/services/accountData.js");
const S = await import("../src/services/sentences.js");

const STAMP = Date.now();
const TG2 = `test-sent2-${STAMP}`;
const TG5 = `test-sent5-${STAMP}`;
const FRESH = `test-sentf-${STAMP}`;
let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

/**
 * An account as a check leaves it: 12 answers a level, `known[n]` of them "I know
 * it", on HSK 3.0 — the rates, not a card for every word, are what price the rest.
 */
async function learner(telegramId: string, known: Record<number, number>) {
  const user = await prisma.user.create({ data: { telegramId, firstName: "Sentences", nativeLang: "ru", hskVersion: "3.0" } });
  const rows = [];
  for (const [level, k] of Object.entries(known)) {
    const sample = hskLevelWords("3.0", Number(level)).slice(40, 52); // not the words picked below
    rows.push(...sample.map((w, i) => ({ userId: user.id, word: w.word, sourceLang: "zh", targetLang: "ru", known: i < k })));
  }
  await prisma.placementAnswer.createMany({ data: rows });
  return user;
}

async function main() {
  // --- 1. The words of a sentence ---
  const zhuo = S.sentenceWords("请把杯子放在桌上。", "上");
  check(zhuo.own, `桌上: 上 counts as its own word (${zhuo.words.join(" ")})`);
  check(!S.sentenceWords("我每天晚上看书。", "上").own, "晚上: 上 is inside a list word, not its own");
  check(S.sentenceWords("我想看一下菜单。", "一下").own, "看一下: 一下 (the list's 一下儿) is its own word");
  const da = S.sentenceWords("他打篮球。", "打").words;
  check(da.join(" ") === "他 篮球", `打篮球 → 打 + 篮球 (${da.join(" ")})`);
  check(S.overCeiling(["我", "喝", "咖啡"], 1, "杯").length === 0, "我 喝 咖啡 is under the HSK 1–2 ceiling");
  check(S.overCeiling(["导航", "软件"], 2, "地图").length === 2, "导航 软件 break 地图's own-level ceiling");

  // --- 2. HSK 2 vs HSK 5, the same HSK 4 words ---
  const u2 = await learner(TG2, { 1: 12, 2: 11, 3: 3, 4: 1 });
  const u5 = await learner(TG5, { 1: 12, 2: 12, 3: 12, 4: 12, 5: 11, 6: 4 });
  const r2 = await S.learnerReading(u2.id);
  const r5 = await S.learnerReading(u5.id);
  check(r2.level === 2 && r5.level === 5, `reading level from the check: ${r2.level} and ${r5.level}`);

  const level4 = hskLevelWords("3.0", 4).map((w) => w.word).filter((w) => S.poolSentences(w).length >= 2);
  check(level4.length > 800, `${level4.length} HSK 4 words have two or more pool sentences`);
  let differ = 0;
  let fits2 = 0;
  let fits5 = 0;
  const byCeiling = { 2: [0, 0, 0, 0], 5: [0, 0, 0, 0] };
  let shown = 0;
  for (const w of level4) {
    const p2 = S.pickPoolSentence(w, r2.knows)!;
    const p5 = S.pickPoolSentence(w, r5.knows)!;
    byCeiling[2][p2.s.c]++;
    byCeiling[5][p5.s.c]++;
    if (p2.unknown <= S.MAX_UNKNOWN) fits2++;
    if (p5.unknown <= S.MAX_UNKNOWN) fits5++;
    if (p2.s.zh !== p5.s.zh) {
      differ++;
      if (shown++ < 3) console.log(`     ${w}: HSK 2 → ${p2.s.zh} (${p2.unknown.toFixed(1)}) | HSK 5 → ${p5.s.zh} (${p5.unknown.toFixed(1)})`);
    }
  }
  const pct = (n: number) => `${Math.round((n / level4.length) * 100)}%`;
  // Where they match, the middle one reads at HSK 2 and the natural one is past HSK 5 too.
  check(differ / level4.length > 0.5, `different sentences for ${differ} of ${level4.length} HSK 4 words (${pct(differ)})`);
  console.log(`     ceilings picked, HSK 2: c1 ${byCeiling[2][1]} c2 ${byCeiling[2][2]} c3 ${byCeiling[2][3]}; HSK 5: c1 ${byCeiling[5][1]} c2 ${byCeiling[5][2]} c3 ${byCeiling[5][3]}`);
  check(byCeiling[2][1] > byCeiling[2][3] && byCeiling[5][3] + byCeiling[5][2] > byCeiling[5][1], "HSK 2 mostly gets the simple one, HSK 5 the richer ones");
  console.log(`     within one unknown: HSK 2 ${fits2} (${pct(fits2)}), HSK 5 ${fits5} (${pct(fits5)}) — the rest go to the per-card call`);
  check(fits5 / level4.length > 0.9, "an HSK 5 learner reads nearly every HSK 4 word's best sentence");

  // --- 3. The add path, the model unreachable ---
  const word = level4.find((w) => S.pickPoolSentence(w, r5.knows)!.unknown <= S.MAX_UNKNOWN && S.pickPoolSentence(w, r2.knows)!.unknown <= S.MAX_UNKNOWN && S.pickPoolSentence(w, r2.knows)!.s.zh !== S.pickPoolSentence(w, r5.knows)!.s.zh)!;
  const card5 = await addWordForUser({ telegramId: TG5, word, sourceLang: "zh", targetLang: "ru" });
  const want5 = S.pickPoolSentence(word, r5.knows)!.s;
  check(card5.examples[0]?.sentenceEn === want5.zh, `HSK 5 adds ${word}: the example is there at once — ${card5.examples[0]?.sentenceEn}`);
  check(card5.examples[0]?.level === S.ceilingLabel(want5.c, word), `labelled with its ceiling (${card5.examples[0]?.level ?? "natural"})`);
  check((await countAiExamples(card5.id)) === 0, "the pool's sentence doesn't use up the examples a learner asks for");

  const batch = level4.filter((w) => w !== word).slice(0, 10);
  const want2 = batch.filter((w) => S.pickPoolSentence(w, r2.knows)!.unknown <= S.MAX_UNKNOWN).length;
  await importWordsForUser({
    telegramId: TG2,
    sourceLang: "zh",
    targetLang: "ru",
    items: [word, ...batch].map((w) => ({ word: w, meaning: "", example: "", exampleTranslation: "", synonyms: [] })),
    generateDetails: true,
    generateExamples: true,
  });
  const cards2 = await prisma.word.findMany({ where: { userId: u2.id }, include: { examples: true } });
  const withEx = cards2.filter((c) => c.examples.length).length;
  check(withEx === want2 + 1, `HSK 2's batch of ${cards2.length}: ${withEx} arrive with a sentence they can read, the rest wait for their own`);
  const card2 = cards2.find((c) => c.word === word)!;
  check(card2.examples[0]?.sentenceEn !== card5.examples[0]?.sentenceEn, `${word} at HSK 2: ${card2.examples[0]?.sentenceEn}`);

  const fresh = await prisma.user.create({ data: { telegramId: FRESH, firstName: "Fresh", nativeLang: "ru", hskVersion: "3.0" } });
  const rf = await S.learnerReading(fresh.id);
  const pf = S.pickPoolSentence(word, rf.knows)!;
  const cardF = await addWordForUser({ telegramId: FRESH, word, sourceLang: "zh", targetLang: "ru" });
  check(pf.unknown > S.MAX_UNKNOWN && cardF.examples.length === 0, `a fresh learner (${pf.unknown.toFixed(1)} unknowns at best) gets no pool sentence`);
  const styled = await addWordForUser({ telegramId: TG5, word: batch[0], sourceLang: "zh", targetLang: "ru", exampleStyle: "internet" });
  check(styled.examples.length === 0, "a learner who picked internet slang gets theirs written, not the everyday pool");

  // --- 4. On open, the sentence moves up ---
  await prisma.placementAnswer.updateMany({ where: { userId: u2.id }, data: { known: true } });
  await prisma.placementAnswer.createMany({
    data: [5, 6].flatMap((n) =>
      hskLevelWords("3.0", n).slice(40, 52).map((w) => ({ userId: u2.id, word: w.word, sourceLang: "zh", targetLang: "ru", known: true })),
    ),
  });
  const before = card2.examples[0]?.sentenceEn;
  const moved = await S.refreshPoolExample(card2.id);
  const after = (await getWord(card2.id))?.examples[0]?.sentenceEn;
  check(moved && after !== before, `after a check at HSK 6, ${word} moves up: ${before} → ${after}`);
  check(!(await S.refreshPoolExample(card2.id)), "and stays put on the next open");

  if (LIVE) {
    // The batch add queues its upgrade for the worker (not running here), so the
    // upgrade below is the only one: a single add fires its own in the background.
    const liveCard = async (telegramId: string, w: string) => {
      await importWordsForUser({
        telegramId,
        sourceLang: "zh",
        targetLang: "ru",
        items: [{ word: w, meaning: "", example: "", exampleTranslation: "", synonyms: [] }],
        generateDetails: true,
        generateExamples: true,
      });
      const u = await prisma.user.findUniqueOrThrow({ where: { telegramId } });
      return prisma.word.findFirstOrThrow({ where: { userId: u.id, word: w } });
    };
    for (const u of [u5, fresh]) await prisma.coachMemory.create({ data: { userId: u.id, lang: "zh", interests: "Технологии и IT" } });

    // --- Their own first, the pool's second ---
    const w5 = batch[1];
    const c5 = await liveCard(TG5, w5);
    await upgradeCard(c5.id, {});
    const both = (await getWord(c5.id))?.examples ?? [];
    check(
      both.length === 2 && !S.isPoolSentence(w5, "ru", both[0].sentenceEn) && S.isPoolSentence(w5, "ru", both[1].sentenceEn),
      `HSK 5 + IT, ${w5}: their own first — ${both[0]?.sentenceEn} — then the pool's — ${both[1]?.sentenceEn}`,
    );
    const ownUnknown = S.unknownIn(S.sentenceWords(both[0]?.sentenceEn ?? "", w5).words, r5.knows);
    check(ownUnknown <= S.MAX_UNKNOWN, `their own is held to one unknown (${ownUnknown.toFixed(1)})`);
    check((await countAiExamples(c5.id)) === 1, "and only their own counts toward the examples cap");

    // --- Over the line: rewritten ---
    const brief = await S.exampleBrief(u2.id, "zh");
    const hard = "导航软件显示的地图比纸质地图更准确，也更新得更及时。";
    const held = await S.holdToLevel({ word: "地图", sentence: hard, translation: "", targetLang: "ru", brief: { ...brief, reading: r2 } });
    const was = S.unknownIn(S.sentenceWords(hard, "地图").words, r2.knows);
    check(held.unknown < was, `over the line at HSK 2 (${was.toFixed(1)}) → rewritten: ${held.sentence} (${held.unknown.toFixed(1)})`);

    // --- No pool sentence to read: their own only ---
    const wf = batch[2];
    const cf = await liveCard(FRESH, wf);
    await upgradeCard(cf.id, {});
    const own = (await getWord(cf.id))?.examples ?? [];
    check(own.length === 1 && !S.isPoolSentence(wf, "ru", own[0].sentenceEn), `the fresh learner's ${wf} (themes: IT): ${own[0]?.sentenceEn} — ${own[0]?.sentenceZh}`);
  }
}

try {
  await main();
} catch (err) {
  console.error(err);
  failures++;
} finally {
  for (const tg of [TG2, TG5, FRESH]) await deleteAccount(tg).catch(() => {});
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
