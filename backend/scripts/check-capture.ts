// Proves instant capture (BACKLOG "Instant capture"): a Chinese word the
// dictionary knows is a complete, reviewable card before any model call.
//
// The model is made unreachable for the run (an empty API key, so every LLM call
// throws at once), which is the assertion itself: if a card comes back with its
// pinyin and gloss while the model is down, nothing on the add path waited on it.
// It upgrades a card; it never gates one. `--live` keeps the key and also waits
// for the Russian to replace the English, the other half of the promise.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-capture.ts [--live]
const LIVE = process.argv.includes("--live");
// Before anything reads env: dotenv leaves a variable that is already set alone.
if (!LIVE) process.env.BAILIAN_API_KEY = "";

const { prisma } = await import("../src/services/db.js");
const { addWordForUser, getWord } = await import("../src/services/vocab.js");
const { importWordsForUser } = await import("../src/services/importWords.js");
const { upgradeCard } = await import("../src/services/capture.js");
const { deleteAccount } = await import("../src/services/accountData.js");

const TG = `test-capture-${Date.now()}`;
let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

async function main() {
  await prisma.user.create({ data: { telegramId: TG, firstName: "Capture", nativeLang: "ru" } });

  // 1. The single add (web form, bot): the backlog's three words.
  const ids: string[] = [];
  for (const w of ["一下", "打", "认真"]) {
    const t0 = Date.now();
    const card = await addWordForUser({ telegramId: TG, word: w, sourceLang: "zh", targetLang: "ru" });
    const ms = Date.now() - t0;
    ids.push(card.id);
    check(ms < 1000, `${w}: card back in ${ms} ms`);
    check(Boolean(card.phonetic && card.meaningZh), `${w}: ${card.phonetic} — ${card.meaningZh}`);
    check(card.dictMeaning === true, `${w}: labelled as the dictionary's English`);
  }
  // CC-CEDICT lists 打 [da2] "(loanword) dozen" first; the card is the verb.
  const da = await getWord(ids[1]);
  check(da?.phonetic === "dǎ" && /to hit/.test(da.meaningZh ?? ""), `打 is dǎ "to hit", not dá "dozen"`);

  // 2. The Reader's add: a tapped word with its sentence, made from the
  // dictionary rather than as an empty shell waiting on the worker.
  const r = await importWordsForUser({
    telegramId: TG,
    sourceLang: "zh",
    targetLang: "ru",
    items: [{ word: "环境", meaning: "", example: "这里的环境很好。", exampleTranslation: "", synonyms: [] }],
    keepProvidedExtras: true,
    generateDetails: true,
    generateExamples: false,
    exampleSourceName: "check-capture",
  });
  const reader = await prisma.word.findFirst({ where: { user: { telegramId: TG }, word: "环境" }, include: { examples: true } });
  check(r.created === 1 && Boolean(reader?.phonetic && reader.meaningZh), `Reader add: ${reader?.phonetic} — ${reader?.meaningZh}`);
  check(reader?.examples[0]?.sentenceEn === "这里的环境很好。", "Reader add keeps its sentence as the example");
  // The queued job belongs to the dev server's worker, not to this run.
  if (r.job) await prisma.importJob.update({ where: { id: r.job.id }, data: { status: "cancelled" } });

  if (!LIVE) {
    // 3. A failed upgrade leaves the card as it was: complete, still labelled.
    const failed = await upgradeCard(ids[2]).then(
      () => false,
      () => true,
    );
    const after = await getWord(ids[2]);
    check(failed && Boolean(after?.meaningZh) && after?.dictMeaning === true, "a failed upgrade leaves the dictionary card standing");

    // 4. Outside the dictionary the old path runs (and needs the model): no card is invented.
    const outside = await addWordForUser({ telegramId: TG, word: "扫码支付宝", sourceLang: "zh", targetLang: "ru" }).then(
      () => "made a card",
      () => "went to the model",
    );
    check(outside === "went to the model", `a word CC-CEDICT lacks keeps today's path (${outside})`);
  } else {
    // 5. Live: the Russian replaces the English behind the card.
    const deadline = Date.now() + 45_000;
    let pending = ids;
    while (pending.length && Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 2000));
      const rows = await Promise.all(pending.map((id) => getWord(id)));
      pending = rows.filter((w) => w?.dictMeaning).map((w) => w!.id);
    }
    for (const id of ids) {
      const w = await getWord(id);
      check(!w?.dictMeaning && /[а-яё]/i.test(w?.meaningZh ?? ""), `${w?.word}: upgraded to "${w?.meaningZh}", example: ${w?.examples[0]?.sentenceEn ?? "none"}`);
    }
  }
}

try {
  await main();
} finally {
  // Background upgrades from step 1 may still be writing; let them settle first.
  await new Promise((res) => setTimeout(res, LIVE ? 500 : 1500));
  await deleteAccount(TG);
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
