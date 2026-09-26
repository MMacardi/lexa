// Proves the add form's dictionary (services/lookup.ts) and the shared Russian
// defaults behind it: every HSK word has one, the lookup works both ways with no
// model call, and it answers fast enough to run on every keystroke.
//
// No database and no model — the lookup is local data only. The model key is
// blanked so a call sneaking into the path would throw here.
//   cd backend && npx tsx scripts/check-lookup.ts
process.env.BAILIAN_API_KEY = "";

const { lookup, defaultMeaning, defaultIsSettled, isDefaultMeaning } = await import("../src/services/lookup.js");
const { cedictEntries } = await import("../src/services/cedict.js");

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// 1. Coverage: every headword in the subset has a Russian default, in Russian.
let total = 0;
const without: string[] = [];
for (const e of cedictEntries()) {
  total++;
  const m = defaultMeaning(e.word, "ru");
  if (!m || !/[а-яё]/i.test(m) || /\p{Script=Han}/u.test(m)) without.push(e.word);
}
check(without.length === 0, `${total - without.length}/${total} headwords have a Russian default${without.length ? ` (missing: ${without.slice(0, 10).join(" ")})` : ""}`);
check(defaultMeaning("一块儿", "ru") !== null && defaultMeaning("访问", "de") === null, "erhua forms resolve; other languages get none");
check(
  isDefaultMeaning({ word: "访问", sourceLang: "zh", targetLang: "ru", meaningZh: defaultMeaning("访问", "ru") }) &&
    !isDefaultMeaning({ word: "访问", sourceLang: "zh", targetLang: "ru", meaningZh: "навещать учителя" }),
  "a learner's own meaning is never taken for the default",
);

// A Reader tap skips the model only when no sentence can change the answer.
check(defaultIsSettled("认识", "ru"), `认识 (${defaultMeaning("认识", "ru")}) is settled: no model call on tap`);
check(!defaultIsSettled("打", "ru"), `打 (${defaultMeaning("打", "ru")}) is not: two senses, the sentence picks`);
check(!defaultIsSettled("地", "ru"), "地 is not: two readings (dì / de)");
check(!defaultIsSettled("认识", "de"), "no default, nothing settled");
let settled = 0;
for (const e of cedictEntries()) if (defaultIsSettled(e.word, "ru")) settled++;
console.log(`     ${settled}/${total} taps need no model call`);

// 2. Both directions. `top` = the hit must be first; otherwise anywhere in the list.
async function expect(q: string, word: string, top = false) {
  const t0 = performance.now();
  const r = await lookup(q, "ru");
  const ms = Math.round(performance.now() - t0);
  const at = r.hits.findIndex((h) => h.word === word);
  const ok = top ? at === 0 : at >= 0;
  check(ok, `${q} → ${word}${top ? " first" : ""} [${r.kind}, ${ms} ms]: ${r.hits.map((h) => `${h.word} ${h.meaning}`).join(" · ") || "nothing"}`);
  return ms;
}
await lookup("warm-up", "ru"); // the first calls build the indexes
await lookup("算法", "ru"); // and the first word off the list loads the rest of CC-CEDICT
const times = [
  await expect("访问", "访问", true),
  await expect("访", "访问"), // a character drawn on the pad already offers the word
  await expect("拜访老师", "老师"), // a whole phrase: the words inside it
  await expect("посещать", "访问"),
  await expect("навещать", "看望"),
  await expect("Посещать", "访问"), // case and ё don't matter
  await expect("учитель", "老师"),
  await expect("visit", "访问"),
  await expect("to visit", "访问"),
  await expect("fangwen", "访问", true),
  await expect("fǎngwèn", "访问", true),
  await expect("fang3 wen4", "访问", true),
  await expect("lüse", "绿色", true),
];
// A syllable goes on into the words it starts; nothing turns up by a reading the row doesn't show.
times.push(
  await expect("hao", "好"),
  await expect("hao", "好吃"),
  await expect("haoc", "好处"),
  await expect("haochu", "好处", true),
  await expect("hanyu", "汉语", true), // the only reading is capitalised in CC-CEDICT
  await expect("zhongguo", "中国", true),
  await expect("算法", "算法", true), // off the list, still the word typed — not 算 and 法
  await expect("访", "访问", true), // 访 itself is off the list: after the words it starts
);
const without_ = async (q: string, word: string, why: string) => {
  const r = await lookup(q, "ru");
  check(!r.hits.some((h) => h.word === word), `${q} ↛ ${word} (${why}): ${r.hits.map((h) => `${h.word} ${h.pinyin}`).join(" · ")}`);
};
await without_("ha", "虾", "ha2 is only 'used in 虾蟆'");
await without_("xian", "见", "the row would say jiàn");
const { cedictCard } = await import("../src/services/cedict.js");
const haochu = await cedictCard("好处", { count: false });
check(Boolean(haochu?.gloss.startsWith("benefit") && haochu.phonetic === "hǎo chu"), `好处 is the benefit, not 'easy to get along with': ${JSON.stringify(haochu)}`);
const nothing = await lookup("qqqzzz", "ru");
check(nothing.hits.length === 0, "nonsense finds nothing (the form then offers the AI)");
const hit = (await lookup("访问", "ru")).hits[0];
check(Boolean(hit?.pinyin && hit.meaning && !hit.english && hit.hsk), `a hit carries pinyin, Russian and a level: ${JSON.stringify(hit)}`);
const de = (await lookup("访问", "de")).hits[0];
check(de?.english === true, "without a default the hit says its meaning is the dictionary's English");

// 3. Fast enough for every keystroke (debounced 200 ms in the form).
const worst = Math.max(...times);
check(worst < 150, `slowest lookup ${worst} ms`);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
