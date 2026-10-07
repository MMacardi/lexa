// Proves "Examples at the learner's level" (BACKLOG, PLAN-examples.md Part 1): the
// sentence around a word is at the HSK level the learner chose, whatever the
// word's own level — an HSK 4 learner's examples no longer all read "HSK 1–2".
//
//   1. The words of a sentence as the check reads them (桌上 is 桌 + 上; 晚上 is
//      not 上; 看一下 has 一下 in it). An 儿 word takes its base's sentences only when
//      the 儿 is the erhua r (一下儿 → 一下; 婴儿 yīng ér is not 婴's 女婴).
//   2. The level: the target, else the add form's CEFR level; a pool sentence's level
//      on the learner's list. Every HSK 3.0 level-4 word gets the hardest sentence
//      not above the level — HSK 2 and HSK 5 learners get different ones.
//   3. The add path, with the model unreachable: an HSK 4 learner on the 2.0 list
//      adds 却 通过 教育 各 记者 朋友 — each carries the pool's sentence at HSK 4, or
//      the closest under it, labelled by how it reads, the moment it returns.
//   4. On open, a pool sentence below the level moves up to it, and back down when
//      the learner lowers their target; one labelled by its old ceiling is relabelled.
//   5. One the naturalness pass took out (他以笔写字) gives way on open, and a formal
//      word's sentence says it is formal.
//   6. A card still carrying a corrected default meaning gets the new one; an old
//      example that holds the word only inside a longer word is removed on open.
//   7. A pool sentence whose Russian was corrected takes the new translation on open;
//      the same sentence met elsewhere keeps its own.
//   `--live`: the learner's own sentence — written at HSK 4, not under it — lands
//   first where the pool's best is HSK 1–2 or there are interests to set it in; a
//   card whose pool sentence is already at HSK 4 gets none on top; "Add example"
//   is labelled HSK 1–4 too.
//
// Needs data/hsk-sentences.jsonl (scripts/build-hsk-sentences.ts). Run against a
// DEV database — it creates throwaway users and deletes them:
//   cd backend && npx tsx scripts/check-sentences.ts [--live]
const LIVE = process.argv.includes("--live");
// Before anything reads env: dotenv leaves a variable that is already set alone.
if (!LIVE) process.env.BAILIAN_API_KEY = "";

const { prisma } = await import("../src/services/db.js");
const { hskLevelWords } = await import("../src/services/hsk.js");
const { addExampleToWord, addWordForUser, countAiExamples, getWord } = await import("../src/services/vocab.js");
const { importWordsForUser } = await import("../src/services/importWords.js");
const { upgradeCard } = await import("../src/services/capture.js");
const { deleteAccount } = await import("../src/services/accountData.js");
const S = await import("../src/services/sentences.js");
const { defaultMeaning, refreshDefaultMeanings } = await import("../src/services/lookup.js");

const STAMP = Date.now();
const TG4 = `test-sent4-${STAMP}`;
const TGC = `test-sentc-${STAMP}`;
const FRESH = `test-sentf-${STAMP}`;
let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

type Version = "2.0" | "3.0";
const at = (level: number | null, version: Version) => ({ level, version });
/** The level the pick should land on: the highest not above L the pool has, else its lowest. */
function want(word: string, L: number, version: Version): number {
  const levels = S.poolSentences(word).map((s) => S.poolLevel(s, version));
  const under = levels.filter((n) => n <= L);
  return under.length ? Math.max(...under) : Math.min(...levels);
}
/** How a sentence the model wrote reads on a list, the way a pool sentence's level is read. */
const writtenLevel = (zh: string, word: string, version: Version) =>
  S.poolLevel({ c: 3, zh, ru: "", t: S.sentenceWords(zh, word).words.join(" ") }, version);

async function main() {
  // --- 1. The words of a sentence ---
  const zhuo = S.sentenceWords("请把杯子放在桌上。", "上");
  check(zhuo.own, `桌上: 上 counts as its own word (${zhuo.words.join(" ")})`);
  check(!S.sentenceWords("我每天晚上看书。", "上").own, "晚上: 上 is inside a list word, not its own");
  check(S.sentenceWords("我想看一下菜单。", "一下").own, "看一下: 一下 (the list's 一下儿) is its own word");
  const xia = S.poolSentences("一下儿");
  check(xia.length > 0 && xia === S.poolSentences("一下"), `一下儿 has 一下's sentences (${xia.length})`);
  for (const w of ["婴儿", "孤儿"]) {
    const own = S.poolSentences(w);
    check(own.length > 0 && own.every((s) => s.zh.includes(w)), `${w} has its own sentences, not ${w[0]}'s: ${own.map((s) => s.zh).join(" / ")}`);
  }
  const da = S.sentenceWords("他打篮球。", "打").words;
  check(da.join(" ") === "他 篮球", `打篮球 → 打 + 篮球 (${da.join(" ")})`);
  check(S.overCeiling(["我", "喝", "咖啡"], 1, "杯").length === 0, "我 喝 咖啡 is under the HSK 1–2 ceiling");
  check(S.overCeiling(["导航", "软件"], 2, "地图").length === 2, "导航 软件 break 地图's own-level ceiling");

  // --- 2. The level, and a pool sentence's ---
  const u4 = await prisma.user.create({ data: { telegramId: TG4, firstName: "Sentences", nativeLang: "ru", hskVersion: "2.0", hskTarget: 4 } });
  const uc = await prisma.user.create({ data: { telegramId: TGC, firstName: "Cefr", nativeLang: "ru", hskVersion: "3.0", levels: { zh: "B2" } } });
  const fresh = await prisma.user.create({ data: { telegramId: FRESH, firstName: "Fresh", nativeLang: "ru", hskVersion: "3.0" } });
  const l4 = await S.exampleLevel(u4.id);
  check(l4.level === 4 && l4.version === "2.0", `the target is the level: HSK ${l4.level} on ${l4.version}`);
  check((await S.exampleLevel(uc.id)).level === 4, "no target: the add form's B2 is HSK 4");
  check((await S.exampleLevel(fresh.id)).level === null, "neither: no level to aim at");
  check((await S.exampleBrief(u4.id, "en")).level === null, "an English card's brief has no HSK level");
  const t = (words: string) => ({ c: 3 as const, zh: "", ru: "", t: words });
  check(S.poolLevel(t("我 喜欢 款"), "3.0") === 1, "a one-character piece off the lists (款) doesn't raise a sentence's level");
  check(S.poolLevel(t("我 喜欢 敦煌"), "3.0") === 2, "a whole word off them (敦煌) is one level above the rest");
  check(S.poolLevel(t("重视"), "2.0") > S.poolLevel(t("重视"), "3.0"), "a sentence reads on the learner's list (重视: HSK 4 on 2.0, lower on 3.0)");

  const level4 = hskLevelWords("3.0", 4).map((w) => w.word).filter((w) => S.poolSentences(w).length >= 2);
  check(level4.length > 800, `${level4.length} HSK 4 words have two or more pool sentences`);
  let differ = 0;
  let wrong = 0;
  const byCeiling = { 2: [0, 0, 0, 0, 0], 5: [0, 0, 0, 0, 0] };
  let shown = 0;
  for (const w of level4) {
    const p2 = S.pickPoolSentence(w, at(2, "3.0"))!;
    const p5 = S.pickPoolSentence(w, at(5, "3.0"))!;
    if (p2.level !== want(w, 2, "3.0") || p5.level !== want(w, 5, "3.0")) wrong++;
    byCeiling[2][p2.s.c]++;
    byCeiling[5][p5.s.c]++;
    if (p2.s.zh !== p5.s.zh) {
      differ++;
      if (shown++ < 3) console.log(`     ${w}: HSK 2 → ${p2.s.zh} (L${p2.level}) | HSK 5 → ${p5.s.zh} (L${p5.level})`);
    }
  }
  check(wrong === 0, `every pick is the hardest sentence not above the level, else the easiest (${wrong} off)`);
  const pct = (n: number) => `${Math.round((n / level4.length) * 100)}%`;
  check(differ / level4.length > 0.4, `different sentences at HSK 2 and HSK 5 for ${differ} of ${level4.length} HSK 4 words (${pct(differ)})`);
  console.log(
    `     ceilings picked, HSK 2: c1 ${byCeiling[2][1]} c2 ${byCeiling[2][2]} c3 ${byCeiling[2][3]} band ${byCeiling[2][4]}; ` +
      `HSK 5: c1 ${byCeiling[5][1]} c2 ${byCeiling[5][2]} c3 ${byCeiling[5][3]} band ${byCeiling[5][4]}`,
  );
  check(byCeiling[5][3] + byCeiling[5][2] + byCeiling[5][4] > 3 * byCeiling[5][1], "HSK 5 mostly gets the richer ones");
  // The band sentences (PLAN-examples Part 4): 通过's three read HSK 2 at best on 2.0;
  // its band sentence reads HSK 3–4 on both lists, so an HSK 4 learner on 2.0 gets it
  // (on 3.0 a natural one already read HSK 4, and stays the pick).
  const t20 = S.pickPoolSentence("通过", at(4, "2.0"))!;
  check(t20.s.c === 4 && t20.level >= 3, `通过, HSK 4 on 2.0: the band sentence — ${t20.s.zh} (HSK ${t20.level})`);
  const t30 = S.pickPoolSentence("通过", at(4, "3.0"))!;
  check(t30.level >= 3 && t30.level <= 4, `通过, HSK 4 on 3.0: a sentence at HSK 3–4 — ${t30.s.zh} (HSK ${t30.level})`);
  // All 1,919 words that lacked one: an HSK 4 learner gets an HSK 3–4 sentence on either list.
  const banded = [
    ...new Set((["2.0", "3.0"] as const).flatMap((v) => [1, 2, 3, 4].flatMap((n) => hskLevelWords(v, n).map((w) => w.word)))),
  ].filter((w) => S.poolSentences(w).some((s) => s.c === 4));
  const below = banded.filter((w) => (["2.0", "3.0"] as const).some((v) => S.pickPoolSentence(w, at(4, v))!.level < 3));
  check(banded.length >= 1919, `${banded.length} words at HSK 4 and under carry a band sentence`);
  check(!below.length, `each is served at HSK 3–4 to an HSK 4 learner on both lists (${below.length} not: ${below.slice(0, 8).join(" ")})`);

  // --- 3. The add path, the model unreachable ---
  const drip = ["却", "通过", "教育", "各", "记者", "朋友"];
  await importWordsForUser({
    telegramId: TG4,
    sourceLang: "zh",
    targetLang: "ru",
    items: drip.map((w) => ({ word: w, meaning: "", example: "", exampleTranslation: "", synonyms: [] })),
    generateDetails: true,
    generateExamples: true,
  });
  const cards4 = await prisma.word.findMany({ where: { userId: u4.id }, include: { examples: true } });
  for (const w of drip) {
    const card = cards4.find((c) => c.word === w);
    const ex = card?.examples[0];
    const s = S.poolSentences(w).find((p) => p.zh === ex?.sentenceEn);
    const n = s ? S.poolLevel(s, "2.0") : null;
    const top = want(w, 4, "2.0");
    check(
      card?.examples.length === 1 && n === top && ex?.level === S.levelLabel(top),
      `HSK 4 adds ${w}: ${ex?.sentenceEn} (c${s?.c}, «${ex?.level}»; the pool: ${S.poolSentences(w).map((p) => `c${p.c} L${S.poolLevel(p, "2.0")}`).join(", ")})`,
    );
    if (top > 2) check(ex?.level !== "HSK 1–2", `  ${w} isn't labelled HSK 1–2 where the pool has an HSK ${top} one`);
  }
  for (const w of ["通过", "记者"]) {
    const s = S.poolSentences(w).find((p) => p.zh === cards4.find((c) => c.word === w)?.examples[0]?.sentenceEn);
    check(s !== undefined && s.c !== 1, `${w} gets the c${s?.c} sentence, not the HSK 1–2 one`);
  }
  check(want("朋友", 4, "2.0") > 2, "an HSK 1 word (朋友) gets a sentence above HSK 2 when its pool has one");

  const single = await addWordForUser({ telegramId: TG4, word: "经济", sourceLang: "zh", targetLang: "ru" });
  const pickJ = S.pickPoolSentence("经济", l4)!;
  check(single.examples[0]?.sentenceEn === pickJ.s.zh, `a single add carries it at once: 经济 — ${single.examples[0]?.sentenceEn} («${single.examples[0]?.level}»)`);
  check((await countAiExamples(single.id)) === 0, "the pool's sentence doesn't use up the examples a learner asks for");
  const cardF = await addWordForUser({ telegramId: FRESH, word: "经济", sourceLang: "zh", targetLang: "ru" });
  const easiest = Math.min(...S.poolSentences("经济").map((s) => S.poolLevel(s, "3.0")));
  check(
    cardF.examples.length === 1 && cardF.examples[0].level === S.levelLabel(easiest),
    `a learner with no level gets the easiest one: ${cardF.examples[0]?.sentenceEn} («${cardF.examples[0]?.level}»)`,
  );
  const styled = await addWordForUser({ telegramId: TG4, word: "市场", sourceLang: "zh", targetLang: "ru", exampleStyle: "internet" });
  check(styled.examples.length === 0, "a learner who picked internet slang gets theirs written, not the everyday pool");

  // --- 4. On open, the pool sentence follows the level ---
  const jizhe = cards4.find((c) => c.word === "记者")!;
  const c1 = S.poolSentences("记者").find((s) => s.c === 1)!;
  await prisma.example.updateMany({ where: { wordId: jizhe.id }, data: { sentenceEn: c1.zh, sentenceZh: c1.ru, level: "HSK 1–2" } });
  const moved = await S.refreshPoolExample(jizhe.id);
  const up = (await getWord(jizhe.id))?.examples[0];
  check(moved && up?.sentenceEn !== c1.zh && up?.level === S.levelLabel(want("记者", 4, "2.0")), `记者 placed at HSK 1–2 moves up on open: ${c1.zh} → ${up?.sentenceEn} («${up?.level}»)`);
  check(!(await S.refreshPoolExample(jizhe.id)), "and stays put on the next open");
  const que = cards4.find((c) => c.word === "却")!;
  await prisma.example.updateMany({ where: { wordId: que.id }, data: { level: "HSK 1–2" } });
  await S.refreshPoolExample(que.id);
  const relabelled = (await getWord(que.id))?.examples[0];
  check(relabelled?.level === S.levelLabel(want("却", 4, "2.0")), `却's sentence, labelled by its ceiling, now reads «${relabelled?.level}»: ${relabelled?.sentenceEn}`);
  await prisma.user.update({ where: { id: u4.id }, data: { hskTarget: 2 } });
  await S.refreshPoolExample(jizhe.id);
  const down = (await getWord(jizhe.id))?.examples[0];
  check(down?.level === S.levelLabel(want("记者", 2, "2.0")), `the target lowered to HSK 2: 记者 moves down — ${down?.sentenceEn} («${down?.level}»)`);
  await prisma.user.update({ where: { id: u4.id }, data: { hskTarget: 4 } });
  await S.refreshPoolExample(jizhe.id);

  // --- 5. The naturalness pass: a sentence it took out gives way on open ---
  check(S.levelLabel(7) === "HSK 1–9", `the HSK 7–9 band reads "${S.levelLabel(7)}", not "HSK 1–7"`);
  const bent = "他以笔写字。";
  check(S.isFormalWord("以"), "以 is marked formal");
  check(!S.poolSentences("以").some((s) => s.zh === bent), `${bent} is out of the pool: ${S.poolSentences("以").map((s) => s.zh).join(" / ")}`);
  check(S.isPoolSentence("以", "ru", bent), "…yet still known as the pool's, so a card carrying it is found");
  const yi = await prisma.word.create({
    data: {
      userId: u4.id,
      word: "以",
      phonetic: "yǐ",
      sourceLang: "zh",
      targetLang: "ru",
      examples: { create: { sentenceEn: bent, sentenceZh: "Он пишет ручкой.", sourceName: "Onomika AI", sourceUrl: "" } },
    },
  });
  await S.refreshPoolExample(yi.id);
  const yiEx = (await getWord(yi.id))?.examples ?? [];
  check(
    !yiEx.some((e) => e.sentenceEn === bent) && yiEx.every((e) => e.register === "news"),
    `on open it gives way, labelled formal: ${yiEx.map((e) => `${e.sentenceEn} (${e.register}, ${e.level ?? "natural"})`).join(" | ") || "none left"}`,
  );

  // --- 6. Old defaults and old examples, fixed on open ---
  const was = "нагревать; горячий; жар";
  const re = await prisma.word.create({ data: { userId: u4.id, word: "热", phonetic: "rè", sourceLang: "zh", targetLang: "ru", meaningZh: was } });
  const own = await prisma.word.create({ data: { userId: u4.id, word: "休息", phonetic: "xiū xi", sourceLang: "zh", targetLang: "ru", meaningZh: "отдых (моё)" } });
  await refreshDefaultMeanings({ user: { telegramId: TG4 } });
  const reNow = (await prisma.word.findUniqueOrThrow({ where: { id: re.id } })).meaningZh;
  check(reNow === defaultMeaning("热", "ru") && reNow !== was, `热's old default «${was}» becomes «${reNow}»`);
  check((await prisma.word.findUniqueOrThrow({ where: { id: own.id } })).meaningZh === "отдых (моё)", "a meaning the learner wrote stays");
  const zhi = await prisma.word.create({
    data: {
      userId: u4.id,
      word: "之",
      phonetic: "zhī",
      sourceLang: "zh",
      targetLang: "ru",
      examples: { create: { sentenceEn: "出发之前，我们要检查手机和电脑。", sentenceZh: "Перед выездом проверим телефон и компьютер.", sourceName: "Onomika AI", sourceUrl: "" } },
    },
  });
  await S.checkOldExamples(zhi.id);
  check((await prisma.example.count({ where: { wordId: zhi.id } })) === 0, "an old example with 之 only inside 之前 is gone on open, without a model call");

  // --- 7. A pool sentence whose Russian was corrected (the review, 2026-09-29) ---
  const easy = S.poolSentences("容易", "ru")[0];
  const oldRu = "Перевод до ревью.";
  const card = (sourceName: string) =>
    prisma.word.create({
      data: {
        userId: uc.id,
        word: "容易",
        phonetic: "róng yì",
        sourceLang: "zh",
        targetLang: "ru",
        examples: { create: { sentenceEn: easy.zh, sentenceZh: oldRu, sourceName, sourceUrl: "" } },
      },
    });
  const fromPool = await card("Onomika AI");
  await S.refreshPoolExample(fromPool.id);
  const took = await prisma.example.findFirst({ where: { wordId: fromPool.id, sentenceEn: easy.zh } });
  check(took?.sentenceZh === easy.ru, `the card keeps ${easy.zh} and takes «${took?.sentenceZh}»`);
  const theirs = await card("Reader");
  await S.refreshPoolExample(theirs.id);
  const kept = await prisma.example.findFirst({ where: { wordId: theirs.id, sentenceEn: easy.zh } });
  check(kept?.sentenceZh === oldRu, "the same sentence met elsewhere keeps its own translation");

  if (LIVE) {
    // The batch add queues its upgrade for the worker (not running here), so the
    // upgrade below is the only one: a single add fires its own in the background.
    const liveCard = async (w: string) => {
      await importWordsForUser({
        telegramId: TG4,
        sourceLang: "zh",
        targetLang: "ru",
        items: [{ word: w, meaning: "", example: "", exampleTranslation: "", synonyms: [] }],
        generateDetails: true,
        generateExamples: true,
      });
      const c = await prisma.word.findFirstOrThrow({ where: { userId: u4.id, word: w } });
      await upgradeCard(c.id, {});
      return (await getWord(c.id))?.examples ?? [];
    };

    // --- The pool's best is HSK 1–2: theirs at HSK 4 on top ---
    check(want("成为", 4, "2.0") <= 2, `成为's pool has nothing past HSK ${want("成为", 4, "2.0")} on 2.0`);
    const cw = await liveCard("成为");
    const mine = cw[0];
    check(
      cw.length === 2 && !S.isPoolSentence("成为", "ru", mine?.sentenceEn ?? "") && S.isPoolSentence("成为", "ru", cw[1]?.sentenceEn ?? ""),
      `成为, no interests: their own first — ${mine?.sentenceEn} — then the pool's — ${cw[1]?.sentenceEn}`,
    );
    check(mine?.level === "HSK 1–4", `their own is labelled «${mine?.level}»`);
    const n = writtenLevel(mine?.sentenceEn ?? "", "成为", "2.0");
    check(n >= 3, `and reads above HSK 2 (HSK ${n} on 2.0)`);

    // --- The pool's is at HSK 4 already, no interests: none on top ---
    const jw = await liveCard("发展");
    check(jw.length === 1 && S.isPoolSentence("发展", "ru", jw[0]?.sentenceEn ?? ""), `发展 (pool at HSK ${want("发展", 4, "2.0")}): the pool's alone — ${jw[0]?.sentenceEn}`);

    // --- Off the pool: theirs only, at HSK 4 ---
    const dw = await liveCard("敦煌");
    check(dw.length === 1 && dw[0].level === "HSK 1–4", `敦煌 (no pool): ${dw[0]?.sentenceEn} — ${dw[0]?.sentenceZh} («${dw[0]?.level}»)`);

    // --- With interests: theirs on top of a pool sentence at the level ---
    await prisma.coachMemory.create({ data: { userId: u4.id, lang: "zh", interests: "Технологии и IT" } });
    const sw = await liveCard("使用");
    check(sw.length === 2 && sw[0].level === "HSK 1–4" && S.isPoolSentence("使用", "ru", sw[1]?.sentenceEn ?? ""), `使用 + IT: ${sw[0]?.sentenceEn} («${sw[0]?.level}») then ${sw[1]?.sentenceEn}`);
    check((await countAiExamples((await prisma.word.findFirstOrThrow({ where: { userId: u4.id, word: "使用" } })).id)) === 1, "only their own counts toward the examples cap");

    // --- "Add example": at HSK 4 too ---
    const after = await addExampleToWord(cards4.find((c) => c.word === "却")!.id, { exampleStyle: "casual" });
    const added = after.examples[0];
    check(added?.level === "HSK 1–4", `"Add example" for 却: ${added?.sentenceEn} («${added?.level}», HSK ${writtenLevel(added?.sentenceEn ?? "", "却", "2.0")} on 2.0)`);
  }
}

try {
  await main();
} catch (err) {
  console.error(err);
  failures++;
} finally {
  for (const tg of [TG4, TGC, FRESH]) await deleteAccount(tg).catch(() => {});
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
