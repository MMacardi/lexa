// Proves the lesson before sign-in (BACKLOG 1h "Learn before the wall"): a guest's first
// five deck words come back with a meaning, their list reading and a pool sentence that
// holds the word, pitched at the guest's target (an HSK 2 and an HSK 5 guest read the
// same word in different sentences); off-list words are dropped; a learner explained in
// English gets CC-CEDICT's meaning and no sentence (the pool is Russian). The five
// meanings are the review's options, so they must differ.
//
// No database: shipped data only, as the route.
//   cd backend && npx tsx scripts/check-lesson.ts
import { guestLesson, pickPoolSentence } from "../src/services/sentences.js";
import { guestDeckOfDays } from "../src/services/wordGroups.js";
import { hskLevelWords } from "../src/services/hsk.js";
import { likedFromIds } from "../src/lib/interests.js";

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

function lessonFor(level: number, unknown: string[], interests: string[]) {
  const days = guestDeckOfDays("3.0", level, { known: [], unknown }, 20, 8, likedFromIds(["exam"], interests));
  const five = days.flatMap((d) => d.words).slice(0, 5).map((w) => w.word);
  return { five, lesson: guestLesson("3.0", level, "ru", five) };
}

// 1. An HSK 4 guest who tapped two HSK 4 words: those lead, and all five are taught.
const l4 = hskLevelWords("3.0", 4);
const tapped = [l4[11].word, l4[40].word];
const { five, lesson } = lessonFor(4, tapped, ["food", "travel"]);
console.log(`HSK 4, food + travel, tapped ${tapped.join(" ")}:`);
for (const w of lesson) console.log(`  ${w.word} ${w.pinyin} — ${w.meaning}\n    ${w.sentence?.zh}  ${w.sentence?.tr}`);
check(lesson.length === 5, `five words taught (${lesson.length})`);
check(tapped.every((w) => five.includes(w)), "the words tapped as unknown are among them");
check(lesson.every((w) => w.pinyin && w.meaning), "each has its reading and a meaning");
check(lesson.every((w) => w.sentence?.zh.includes(w.word) && w.sentence.tr), "each has a sentence holding the word, translated");
const levels = lesson.map((w) => pickPoolSentence(w.word, { level: 4, version: "3.0" })?.level ?? 99);
check(levels.filter((n) => n <= 4).length >= 4, `the sentences read at HSK 4 or under (${levels.join(" ")})`);
check(new Set(lesson.map((w) => w.meaning)).size === lesson.length, "the five meanings differ (the review's options)");

// 2. From zero, HSK 1: the easiest sentences.
const zero = lessonFor(1, [], []).lesson;
const zeroLevels = zero.map((w) => pickPoolSentence(w.word, { level: 1, version: "3.0" })?.level ?? 99);
console.log(`HSK 1 from zero: ${zero.map((w) => `${w.word} «${w.sentence?.zh}»`).join(", ")}`);
check(zero.length === 5 && zero.every((w) => w.sentence), "from zero: five words, each with a sentence");
check(zeroLevels.every((n) => n <= 2), `from zero the sentences read at HSK 1–2 (${zeroLevels.join(" ")})`);
check(new Set(zero.map((w) => w.meaning)).size === zero.length, "from zero the five meanings differ");

// 3. The target sets the sentence: the same HSK 4 words for an HSK 2 and an HSK 5 guest.
const same = l4.slice(100, 140).map((w) => w.word);
const at2 = guestLesson("3.0", 2, "ru", same);
const at5 = guestLesson("3.0", 5, "ru", same);
const differ = at2.filter((w, i) => w.sentence && at5[i].sentence && w.sentence.zh !== at5[i].sentence!.zh).length;
check(differ >= 10, `an HSK 2 and an HSK 5 guest read different sentences for ${differ} of ${same.length} HSK 4 words`);

// 4. Off-list words are dropped; English gets a meaning and no sentence.
check(guestLesson("3.0", 4, "ru", ["电脑", "鲁迅研究会", "abc"]).map((w) => w.word).join() === "电脑", "off-list words are dropped");
const en = guestLesson("3.0", 4, "en", ["电脑", "旅游"]);
check(en.length === 2 && en.every((w) => w.meaning && !w.sentence), `English: CC-CEDICT's meaning, no sentence (${en.map((w) => w.meaning).join(" / ")})`);

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
