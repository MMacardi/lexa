// Proves part 1 of "New words that learn well together, straight from the dictionary"
// (BACKLOG 1e, PLAN-word-groups.md): a day's new words are one group — most of them
// from one situation, the words that belong to none a couple at a time, never two
// near-synonyms side by side — chosen from the top of the frontier, so the day costs
// little of the usage the frequency order alone would have covered. And the day holds
// still: a word said known today is replaced, the rest stay.
//
// An HSK 3.0 level 4 learner who knows HSK 1–3, simulated day by day: each day's
// words become theirs, and their characters count from the next day, as in the app.
// Prints the first days of both orders so a person can read them.
//
// Needs no database:  cd backend && npx tsx scripts/check-word-groups.ts
import { frontierOrder, hskFrequency, hskLevelWords, type HskWord } from "../src/services/hsk.js";
import { nearSynonyms, nextGroup, type GroupWord } from "../src/services/wordGroups.js";
import { hskSituations } from "../src/services/wordPages.js";
import { defaultMeaning } from "../src/services/lookup.js";
import { likedSituations } from "../src/lib/interests.js";

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

const below = new Set<string>();
for (let n = 1; n < 4; n++) for (const e of hskLevelWords("3.0", n)) below.add(e.word);
const level4 = hskLevelWords("3.0", 4);
const total = level4.reduce((a, w) => a + hskFrequency(w.word), 0);
const usage = (words: string[]) => words.reduce((a, w) => a + hskFrequency(w), 0) / total;
const abstract = (w: string) => hskSituations(w).length === 0;

/** `days` days of `size` words each, as `pick` chooses them from that day's frontier. */
function simulate(size: number, days: number, pick: (order: HskWord[]) => HskWord[]) {
  const learned: string[] = [];
  const out: { order: HskWord[]; words: HskWord[] }[] = [];
  for (let d = 0; d < days; d++) {
    const have = new Set(learned);
    const order = frontierOrder("3.0", 4, (w) => below.has(w) || have.has(w), new Set(), learned);
    const words = pick(order);
    out.push({ order, words });
    learned.push(...words.map((w) => w.word));
  }
  return out;
}

const show = (words: HskWord[]) => words.map((w) => `${w.word}${abstract(w.word) ? "" : "·"}`).join(" ");
const pairsIn = (words: string[]) => words.flatMap((a, i) => words.slice(i + 1).filter((b) => nearSynonyms(a, b)).map((b) => `${a}/${b}`));

// --- A day of 5 (the default goal), 30 days ---
const flat = simulate(5, 30, (order) => order.slice(0, 5));
const themes: (string | null)[] = [];
const grouped = simulate(5, 30, (order) => {
  const g = nextGroup(order, 5);
  themes.push(g.theme);
  return g.words;
});

console.log("HSK 3.0 level 4, a learner who knows HSK 1–3, 5 words a day (· = has a situation)\n");
console.log("frequency alone:");
flat.slice(0, 4).forEach((d, i) => console.log(`  day ${i + 1}  ${show(d.words)}`));
console.log("as groups:");
grouped.slice(0, 10).forEach((d, i) =>
  console.log(`  day ${i + 1}  ${(themes[i] ?? "—").padEnd(12)} ${show(d.words)}   ${d.words.map((w) => defaultMeaning(w.word, "ru")?.split(/[;,]/)[0]).join(" · ")}`),
);
console.log("");

check(grouped.every((d) => d.words.length === 5), "every day has 5 words");
const themed = grouped.filter((d, i) => themes[i] && d.words.filter((w) => hskSituations(w.word).includes(themes[i] as never)).length >= 3);
check(themed.length >= 27, `most of a day's words share one situation on ${themed.length} of 30 days`);
const flatPairs = flat.flatMap((d) => pairsIn(d.words.map((w) => w.word)));
const groupPairs = grouped.flatMap((d) => pairsIn(d.words.map((w) => w.word)));
check(groupPairs.length === 0, `no two near-synonyms in one day (frequency alone had ${flatPairs.length}: ${flatPairs.slice(0, 6).join(" ")})`);
const abstractPerDay = grouped.map((d) => d.words.filter((w) => abstract(w.word)).length);
check(abstractPerDay.every((n) => n <= 2), `at most 2 abstract words a day (frequency alone: ${flat.map((d) => d.words.filter((w) => abstract(w.word)).length).slice(0, 10).join(" ")} …)`);
const abstractShare = abstractPerDay.reduce((a, n) => a + n, 0) / 150;
check(abstractShare >= 0.3, `but they keep coming: ${(abstractShare * 100).toFixed(0)}% of 30 days' words, none left to pile up`);
const first100 = (days: typeof flat) => days.flatMap((d) => d.words.map((w) => w.word)).slice(0, 100);
const cover = usage(first100(grouped)) / usage(first100(flat));
check(
  cover >= 0.9,
  `the first 100 words cover ${(usage(first100(grouped)) * 100).toFixed(1)}% of the level's usage vs ${(usage(first100(flat)) * 100).toFixed(1)}% by frequency alone (${(cover * 100).toFixed(0)}%)`,
);
const level4Words = new Set(level4.map((w) => w.word));
check(grouped.every((d) => d.words.every((w) => level4Words.has(w.word))), "every word is a level 4 word the learner doesn't have");
check(new Set(grouped.flatMap((d) => d.words.map((w) => w.word))).size === 150, "no word comes twice");

// --- The day holds still ---
const day1 = grouped[0];
const g1 = nextGroup(day1.order, 5);
check(JSON.stringify(nextGroup(day1.order, 5)) === JSON.stringify(g1), "the same frontier gives the same day");
let still = true;
const notes: string[] = [];
for (const w of g1.words) {
  const after = nextGroup(day1.order, 5, new Set([w.word]));
  const stayed = g1.words.filter((x) => x.word !== w.word);
  const ok =
    after.words.length === 5 &&
    stayed.every((x) => after.words.some((y) => y.word === x.word)) &&
    !after.words.some((y) => y.word === w.word);
  if (!ok) still = false;
  const added = after.words.find((y) => !g1.words.some((x) => x.word === y.word));
  notes.push(`${w.word}→${added?.word}${w.situation && added?.situation === w.situation ? " (same theme)" : ""}`);
}
check(still, `saying any one word known replaces only that word (${notes.join(", ")})`);
const two = g1.words.slice(0, 2).map((w) => w.word);
const after2 = nextGroup(day1.order, 5, new Set(two));
check(
  after2.theme === g1.theme && after2.words.length === 5 && g1.words.slice(2).every((x) => after2.words.some((y) => y.word === x.word)),
  `two of them known: the other three stay and the day keeps its theme (${show(after2.words)})`,
);
const themeWords = g1.words.filter((w) => w.situation === g1.theme);
const afterTheme = nextGroup(day1.order, 5, new Set(themeWords.map((w) => w.word)));
check(afterTheme.words.length === 5, `all ${themeWords.length} theme words known: still 5 words (${show(afterTheme.words)}, theme ${afterTheme.theme ?? "none"})`);

// --- A big day (20 words, as the author takes), 10 days ---
const bigThemes: (string | null)[] = [];
const big = simulate(20, 10, (order) => {
  const g = nextGroup(order, 20);
  bigThemes.push(g.theme);
  return g.words;
});
console.log("\n20 words a day:");
big.slice(0, 3).forEach((d, i) => {
  const g = d.words as GroupWord[];
  const by = new Map<string, string[]>();
  for (const w of g) by.set(w.situation ?? "—", [...(by.get(w.situation ?? "—") ?? []), w.word]);
  console.log(`  day ${i + 1}  ${[...by].map(([s, ws]) => `${s}: ${ws.join(" ")}`).join(" | ")}`);
});
console.log("");
check(big.every((d) => d.words.length === 20), "every big day has 20 words");
check(big.every((d) => pairsIn(d.words.map((w) => w.word)).length === 0), "no two near-synonyms in a big day either");
check(big.every((d) => d.words.filter((w) => abstract(w.word)).length <= 8), "at most 8 of 20 abstract");
check(bigThemes.every(Boolean), `every big day has a theme (${bigThemes.join(", ")})`);

// --- A learner who came for travel and IT: their situations lead the day ---
const liked = likedSituations("Сдать HSK, Путешествия", "Технологии и IT, своё хобби");
check(
  ["airport", "hotel", "computers", "phone"].every((s) => liked.has(s as never)) && !liked.has("news") && !liked.has("army"),
  `goal and interests read back from Russian labels → ${[...liked].join(" ")} (typed text and the exam add none)`,
);
check(
  likedSituations("Дорамы, музыка, игры", "Games & anime, 美食烹饪").has("arts") && likedSituations("", "Games & anime, 美食烹饪").has("cooking"),
  "a goal whose label holds commas, English and Chinese labels",
);
const likedThemes: (string | null)[] = [];
const fav = simulate(5, 30, (order) => {
  const g = nextGroup(order, 5, new Set(), new Set(), liked);
  likedThemes.push(g.theme);
  return g.words;
});
console.log("\na travel + IT learner, 5 words a day:");
fav.slice(0, 6).forEach((d, i) => console.log(`  day ${i + 1}  ${(likedThemes[i] ?? "—").padEnd(12)} ${show(d.words)}`));
console.log("");
const politics = (ts: (string | null)[]) => ts.slice(0, 10).filter((s) => s === "news" || s === "army").length;
const ledLiked = likedThemes.filter((s) => s && liked.has(s as never)).length;
check(likedThemes[0] != null && liked.has(likedThemes[0] as never), `day 1 is theirs (${likedThemes[0]})`);
check(
  ledLiked >= 10 && politics(likedThemes) < politics(themes),
  `${ledLiked} of 30 days on their situations; news/army in the first 10: ${politics(likedThemes)} (no interests: ${politics(themes)})`,
);
const favCover = usage(first100(fav)) / usage(first100(flat));
check(favCover >= 0.85, `the first 100 words still cover ${(favCover * 100).toFixed(0)}% of what frequency alone does`);
check(fav.every((d) => pairsIn(d.words.map((w) => w.word)).length === 0) && new Set(fav.flatMap((d) => d.words.map((w) => w.word))).size === 150, "no near-synonyms in a day, no word twice");

// --- Small days are just the next words ---
check(nextGroup(day1.order, 1).words.length === 1 && nextGroup(day1.order, 2).words.length === 2, "a goal of 1 or 2 words gets 1 or 2");
check(nextGroup([], 5).words.length === 0, "nothing left: an empty day, no crash");

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
