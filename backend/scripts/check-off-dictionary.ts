// Proves a Chinese word CC-CEDICT doesn't have is caught at the door, and a real
// one's example is read before it is saved.
//
// 今使 went through the spell check as "spelled right", got the meaning 今 + 使
// "сейчас заставить" and a sentence no native says, and the editor's read deleted
// that sentence on the card's first open — a card with a made-up meaning and no
// example, and nothing to say why (the author, 2026-09-29). Live model calls
// (~12, well under ¥0.05).
//
// Run against a DEV database — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-off-dictionary.ts
const { prisma } = await import("../src/services/db.js");
const { suggestWord } = await import("../src/services/suggest.js");
const { addWordForUser, getWord } = await import("../src/services/vocab.js");
const { checkOldExamples } = await import("../src/services/sentences.js");
const { cedictKnows } = await import("../src/services/cedict.js");
const { deleteAccount } = await import("../src/services/accountData.js");

const TG = `test-offdict-${Date.now()}`;
let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

async function main() {
  // 1. Off the dictionary and not a word: "did you mean", with dictionary words only.
  for (const w of ["今使", "电恼", "已使"]) {
    const r = await suggestWord(w, "zh");
    check(r.corrected !== w, `${w}: not added as typed (→ ${r.suggestions.join(" ")})`);
    check(r.suggestions.length > 0 && r.suggestions.every((s) => s !== w && cedictKnows(s)), `${w}: every suggestion is in CC-CEDICT`);
  }
  // 2. Off the dictionary and real: a phrase goes straight through.
  for (const w of ["喝咖啡", "有点儿累"]) {
    const r = await suggestWord(w, "zh");
    check(r.corrected === w, `${w}: added as typed`);
  }
  // 3. Anywhere in CC-CEDICT, not only the HSK subset: no model call.
  const t0 = Date.now();
  const r = await suggestWord("算法", "zh");
  check(r.corrected === "算法" && Date.now() - t0 < 500, `算法 (off the HSK lists): passed by the dictionary in ${Date.now() - t0} ms`);

  // 4. A real phrase off the dictionary gets its example read at add, so the first
  // open has nothing left to delete.
  await prisma.user.create({ data: { telegramId: TG, firstName: "OffDict", nativeLang: "ru" } });
  const card = await addWordForUser({ telegramId: TG, word: "喝咖啡", sourceLang: "zh", targetLang: "ru" });
  const ex = card.examples[0];
  check(Boolean(ex), `喝咖啡: has an example (${ex?.sentenceEn})`);
  check(Boolean(ex?.checkedAt), `喝咖啡: its example is stamped as read`);
  check((await checkOldExamples(card.id)) === 0, `喝咖啡: opening the card changes nothing`);
  const opened = await getWord(card.id);
  check(opened?.examples.length === card.examples.length, `喝咖啡: the example is still there after the open`);
}

try {
  await main();
} finally {
  const u = await prisma.user.findUnique({ where: { telegramId: TG }, select: { id: true } });
  if (u) await deleteAccount(u.id);
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
