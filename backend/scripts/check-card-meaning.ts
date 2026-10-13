// A fresh HSK card says what its word page says it tests (the author, 2026-10-13: a
// new 进行 card read «проводить, осуществлять» while its page offered "Update the
// card" to «проводить, осуществлять, идти (о процессе)», and looked added half-done).
//
// The card is made from the one-line default (data/hsk-ru.jsonl), the page from the
// word pages (data/hsk-pages.jsonl), and the page composes its offer client-side
// (components/WordSenses.tsx) — three places that only agree if checked together.
// This ports the page's offer, counts it over the whole list, and runs the add, the
// read and the move of an old card against the database.
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-card-meaning.ts
import { prisma } from "../src/services/db.js";
import { cardMeaning, defaultMeaning, isDefaultMeaning, refreshDefaultMeanings } from "../src/services/lookup.js";
import { headGloss, hskPage } from "../src/services/wordPages.js";
import { importWordsForUser } from "../src/services/importWords.js";
import { getWord } from "../src/services/vocab.js";
import { deleteAccount } from "../src/services/accountData.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

let failed = 0;
function check(what: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failed++;
}

// components/WordSenses.tsx, as the page runs it (a Russian card).
const bare = (s: string) => s.replace(/\s*[(（][^)）]*[)）]/g, "").trim();
const hint = (s: string) => s.match(/[(（][^)）]*[)）]/)?.[0] ?? "";
const terms = (s: string) =>
  bare(s)
    .split(/[;；,，、/]/)
    .map((x) => x.trim())
    .filter(Boolean);
function composeMeaning(picked: string[]): string {
  const said = new Set<string>();
  return picked
    .map((m) => {
      const all = terms(m);
      const kept = all.filter((x) => {
        const k = x.toLowerCase();
        if (said.has(k)) return false;
        said.add(k);
        return true;
      });
      if (!kept.length || kept.length === all.length) return m.trim();
      const h = hint(m);
      return kept.join(", ") + (h ? " " : "") + h;
    })
    .join("; ");
}
// The ticks the server sends with a fresh card (services/vocab.ts, flagByMeaning),
// then the page's "Update the card" test on them.
function offersUpdate(word: string, card: string): boolean {
  const page = hskPage(word, "ru");
  if (!page) return false;
  const heads = new Set(card.split(/[;；]/).map(headGloss).filter(Boolean));
  const picked = page.s.filter((s) => heads.has(headGloss(s.m))).map((s) => s.m);
  if (!picked.length) return false;
  const preview = composeMeaning(picked);
  const cardTerms = terms(card).map((x) => x.toLowerCase());
  const previewTerms = new Set(terms(preview).map((x) => x.toLowerCase()));
  return preview !== card && cardTerms.length > 0 && cardTerms.every((x) => previewTerms.has(x));
}

// --- The whole list ---
const rows = readFileSync(fileURLToPath(new URL("../data/hsk-ru.jsonl", import.meta.url)), "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter(Boolean)
  .map((l) => JSON.parse(l) as { s?: string });
let withPage = 0;
let before = 0;
let after = 0;
let moved = 0;
const left: string[] = [];
for (const { s: word } of rows) {
  if (!word || !hskPage(word, "ru")) continue;
  const was = defaultMeaning(word, "ru")!;
  const now = cardMeaning(word, "ru")!;
  withPage++;
  if (offersUpdate(word, was)) before++;
  if (now !== was) moved++;
  if (offersUpdate(word, now)) {
    after++;
    if (left.length < 8) left.push(`${word} «${now}»`);
  }
  // Never says less than the default did.
  const has = new Set(terms(now).map((x) => x.toLowerCase()));
  if (!terms(was).every((x) => has.has(x.toLowerCase()))) check(`${word}: the card keeps every term of «${was}»`, false, now);
}
console.log(`${withPage} words with a page: "Update the card" on a fresh card ${before} → ${after}; ${moved} cards take the page's wording`);
check("a fresh HSK card is no longer offered an update by its own page", after < before / 20, left.join(", "));
check("进行 is made with its page's wording", cardMeaning("进行", "ru") === "проводить, осуществлять, идти (о процессе)", cardMeaning("进行", "ru") ?? "");
check("a word off the lists keeps the table's meaning", cardMeaning("有钱", "ru") === defaultMeaning("有钱", "ru"));

// --- Against the database ---
const TG = `test-card-meaning-${Date.now()}`;
const user = await prisma.user.create({ data: { telegramId: TG, firstName: "Meaning", nativeLang: "ru" } });
try {
  await importWordsForUser({
    telegramId: TG,
    sourceLang: "zh",
    targetLang: "ru",
    items: [{ word: "进行", meaning: "", example: "", exampleTranslation: "", synonyms: [] }],
    generateDetails: false,
    generateExamples: false,
  });
  const made = await prisma.word.findFirstOrThrow({ where: { userId: user.id, word: "进行" } });
  check("Today's add writes 进行 in its page's wording", made.meaningZh === "проводить, осуществлять, идти (о процессе)", made.meaningZh ?? "");
  check("…which still counts as the default (the upgrade leaves it and writes only the example)", isDefaultMeaning(made));
  const read = await getWord(made.id);
  const ticks = read?.sensesNow?.senses.filter((s) => s.onCard).map((s) => s.meaning) ?? [];
  check("its page ticks the sense the card tests", ticks.length === 1, ticks.join(" | "));
  check("…and the card already says what the page would write", composeMeaning(ticks) === made.meaningZh && !offersUpdate("进行", made.meaningZh!));
  check("…labelled as the dictionary's while the rest fills in", read?.dictDefault === true);

  // A card made before, on the one-line default, moves on its next read; one the
  // learner wrote stays.
  const old = await prisma.word.create({
    data: { userId: user.id, word: "增长", phonetic: "zēng zhǎng", sourceLang: "zh", targetLang: "ru", meaningZh: defaultMeaning("增长", "ru") },
  });
  const own = await prisma.word.create({
    data: { userId: user.id, word: "原因", phonetic: "yuán yīn", sourceLang: "zh", targetLang: "ru", meaningZh: "причина (моё)" },
  });
  await refreshDefaultMeanings({ user: { telegramId: TG } });
  const oldNow = await prisma.word.findUniqueOrThrow({ where: { id: old.id } });
  const ownNow = await prisma.word.findUniqueOrThrow({ where: { id: own.id } });
  check(
    "a card still on the one-line default takes the page's wording on read",
    oldNow.meaningZh === cardMeaning("增长", "ru") && cardMeaning("增长", "ru") !== defaultMeaning("增长", "ru"),
    `«${defaultMeaning("增长", "ru")}» → «${oldNow.meaningZh}»`,
  );
  check("a meaning the learner wrote stays", ownNow.meaningZh === "причина (моё)");
  const again = await refreshDefaultMeanings({ user: { telegramId: TG } });
  check("…and a second read moves nothing", again === 0, String(again));
} finally {
  await deleteAccount(TG);
  await prisma.$disconnect();
}
if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exitCode = 1;
}
