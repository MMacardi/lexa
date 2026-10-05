// Proves an HSK card reads as the official list does, and that cards made before
// that move to it.
//
// A card's pinyin came from pinyin-pro alone, which read 东西 dōng xī ("east and
// west" in CC-CEDICT), 告诉 gào sù ("to press charges") and 所长 suǒ cháng ("one's
// strong point") — HSK 1 cards wrong under a right Russian meaning, English cards
// wrong outright, while the list views (data/hskWords.ts, hand-checked against the
// official pinyin) had them right. Now the card's pinyin is the list's, spoken (一/不
// sandhi), and the English gloss is the CC-CEDICT reading of the sense the word page
// leads with (2026-10-04).
//
// Parts 1–2 need no database. Part 3 runs against a DEV database — it creates a
// throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-card-readings.ts
const { cedictCard, cedictLookup, mainReading, toneMarked } = await import("../src/services/cedict.js");
const { HSK_WORDS } = await import("../src/data/hskWords.js");
const { hskPage, readsAs } = await import("../src/services/wordPages.js");
const { defaultMeaning, refreshDefaultMeanings } = await import("../src/services/lookup.js");
const { refreshCardReadings } = await import("../src/services/capture.js");
const { prisma } = await import("../src/services/db.js");
const { deleteAccount } = await import("../src/services/accountData.js");

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// 1. The words from the report, and how a card writes a reading.
const PINNED: [word: string, pinyin: string, gloss?: RegExp][] = [
  ["东西", "dōng xi", /\bthing\b/],
  ["告诉", "gào su", /to tell/],
  ["所长", "suǒ zhǎng", /director|head/],
  ["多少", "duō shao", /how much/],
  ["故事", "gù shi", /story/],
  ["地方", "dì fang", /place/],
  ["生意", "shēng yi", /business/],
  ["教", "jiāo", /to teach/],
  ["数", "shǔ", /to count/],
  ["切", "qiē", /to cut/],
  // A tone alone parts two CC-CEDICT entries: the gloss is the page's lead sense's.
  ["说法", "shuō fǎ", /wording/],
  ["口音", "kǒu yīn", /accent/],
  ["佛", "fó", /Buddha/], // a capitalised reading, which the proper-noun filter used to skip
  // A neutral tone the official list writes and CC-CEDICT doesn't; a full tone it writes
  // where upstream took CC-CEDICT's neutral one; a reading CC-CEDICT doesn't write at all.
  ["早晨", "zǎo chen", /morning/],
  ["回来", "huí lái", /to come back/],
  ["血", "xiě", /blood/],
  // The exam's reading over the card's old one (the list's reading pass, 2026-10-04).
  ["盛", "chéng", /to ladle/],
  ["咳", "ké", /cough/],
  ["觉", "jiào", /sleep|nap/],
  ["划", "huá", /to row/],
  // Spoken: 一/不 sandhi by the dictionary's next syllable, erhua joined.
  ["一应俱全", "yì yīng jù quán"],
  ["一会儿", "yí huìr"],
  ["一下儿", "yí xiàr"],
  ["不客气", "bú kè qi"],
  ["看不起", "kàn bu qǐ"],
  ["女", "nǚ"],
  ["策略", "cè lüè"],
  ["了", "le"],
  ["只", "zhǐ"],
  ["长", "cháng"],
  ["着", "zhe"],
  // Off the lists: pinyin-pro's spoken reading, as before.
  ["一下", "yí xià"],
  ["算法", "suàn fǎ"],
];
for (const [word, pinyin, gloss] of PINNED) {
  const card = await cedictCard(word, { count: false });
  check(card?.phonetic === pinyin && (!gloss || gloss.test(card.gloss)), `${word} → ${card?.phonetic} «${card?.gloss}»`);
}

// 2. Over the whole list: the card reads as the list (sandhi and the erhua r aside),
// the word page's lead sense — the card meaning's — is under that reading, and an
// English card glosses that sense's reading. Where CC-CEDICT doesn't write the list's
// reading at all (下载 xià zài, 血 xiě), the lead is under the reading the card glosses.
const flat = (word: string, p: string) => {
  const syl = p.normalize("NFC").toLowerCase().replace(/ r$/, "r").split(" ");
  // A joined erhua r (yí xiàr) leaves 儿 without a syllable of its own.
  const chars = Array.from(word).slice(0, syl.length);
  return syl
    .map((s, i) => (chars.length === syl.length && /[一不]/.test(chars[i]) ? s.normalize("NFD").replace(/[̀-ͯ]/g, "") : s))
    .join("");
};
const offList: string[] = [];
const offPage: string[] = [];
const offGloss: string[] = [];
for (const line of HSK_WORDS.split("\n")) {
  const [word, listed] = line.split("\t");
  if (!word || !listed) continue;
  const card = await cedictCard(word, { count: false });
  if (!card) continue;
  if (flat(word, card.phonetic) !== flat(word, listed)) offList.push(`${word} card ${card.phonetic} list ${listed}`);
  const page = hskPage(word, "ru");
  const lead = page?.s[0];
  // An erhua word's page is its base's (一下儿 → 一下), checked there.
  if (!lead || page.w !== word) continue;
  const entry = cedictLookup(word, { count: false });
  const glossed = entry ? toneMarked((await mainReading(entry)).reading.pinyin) : null;
  const written = entry?.readings.some((r) => readsAs(word, toneMarked(r.pinyin), listed));
  if (!readsAs(word, lead.r, listed) && (written || lead.r !== glossed)) offPage.push(`${word} ${listed}: «${lead.m}» is ${lead.r}`);
  if (glossed && glossed !== lead.r) offGloss.push(`${word}: English from ${glossed}, page leads ${lead.r}`);
}
const show = (xs: string[]) => (xs.length ? `:\n  ${xs.slice(0, 20).join("\n  ")}` : "");
check(offList.length === 0, `every HSK card reads as the list${show(offList)}`);
check(offPage.length === 0, `every word page leads with a sense under the card's reading${show(offPage)}`);
check(offGloss.length === 0, `every English card glosses the page's lead reading${show(offGloss)}`);

// 3. Cards made before move on read; a pinyin the learner typed, or a meaning in the
// old reading's sense, keeps its pinyin.
const TG = `test-readings-${Date.now()}`;
async function cards() {
  const user = await prisma.user.create({ data: { telegramId: TG, firstName: "Readings", nativeLang: "ru" } });
  const make = (word: string, targetLang: string, phonetic: string, meaningZh: string | null) =>
    prisma.word.create({ data: { userId: user.id, word, sourceLang: "zh", targetLang, phonetic, meaningZh } });
  const ru = (w: string) => defaultMeaning(w, "ru");
  const made = {
    thing: await make("东西", "ru", "dōng xī", ru("东西")),
    tell: await make("告诉", "en", "gào sù", "to press charges; to file a complaint"),
    teach: await make("教", "ru", "jiào", "учить"), // a meaning the model wrote, in jiāo's sense
    typed: await make("东西", "ru", "dōngxī", ru("东西")),
    otherSense: await make("觉", "ru", "jué", "чувствовать"), // jué's sense: stays jué
    fresh: await make("东西", "ru", "dōng xi", ru("东西")),
    // The old default, corrected to chéng's sense first, as the routes do.
    oldDefault: await make("盛", "ru", "shèng", "процветающий, бурный"),
  };
  await prisma.word.update({ where: { id: made.oldDefault.id }, data: { partOfSpeech: "прилагательное" } });
  await refreshDefaultMeanings({ userId: user.id });
  const moved = await refreshCardReadings({ userId: user.id });
  const get = async (id: string) =>
    prisma.word.findUniqueOrThrow({ where: { id }, select: { phonetic: true, meaningZh: true, partOfSpeech: true } });
  const thing = await get(made.thing.id);
  check(thing.phonetic === "dōng xi", `东西 dōng xī → ${thing.phonetic}`);
  const tell = await get(made.tell.id);
  check(tell.phonetic === "gào su" && /to tell/.test(tell.meaningZh ?? ""), `an English 告诉 card → ${tell.phonetic} «${tell.meaningZh}»`);
  const teach = await get(made.teach.id);
  check(teach.phonetic === "jiāo" && teach.meaningZh === "учить", `教 jiào «учить» → ${teach.phonetic} «${teach.meaningZh}»`);
  check((await get(made.typed.id)).phonetic === "dōngxī", "a pinyin the learner typed stays");
  const other = await get(made.otherSense.id);
  check(other.phonetic === "jué", `觉 «чувствовать» keeps jué (${other.phonetic})`);
  check((await get(made.fresh.id)).phonetic === "dōng xi", "a card already right is left alone");
  const ladle = await get(made.oldDefault.id);
  check(
    ladle.phonetic === "chéng" && ladle.meaningZh === ru("盛") && ladle.partOfSpeech === "глагол",
    `盛 shèng «процветающий, бурный» (прилагательное) → ${ladle.phonetic} «${ladle.meaningZh}» (${ladle.partOfSpeech})`,
  );
  check((await get(made.teach.id)).partOfSpeech === null, "a card with no part of speech isn't given one");
  check(moved === 4, `4 cards moved (${moved})`);
  check((await refreshCardReadings({ userId: user.id })) === 0, "a second read moves nothing");
}

try {
  await cards();
} finally {
  await deleteAccount(TG);
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
