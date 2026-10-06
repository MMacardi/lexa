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
await lookup("warm-up", "ru"); // the first calls build the indexes (the server warms both at boot)
await lookup("мир", "ru");
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

// 3. Russian as a learner types it, and rows that say which sense they answer
// (2026-10-06). купить, устать, выучить found nothing: the dictionary glosses 买
// «покупать», 累 «уставать» — the other aspect (data/ru-aspect.tsv).
times.push(
  await expect("купить", "买", true),
  await expect("устать", "累", true),
  await expect("сделать", "做", true),
  await expect("посмотреть", "看", true), // not 瞅, dialect and HSK 7–9
  await expect("сказать", "说", true), // not 曰, classical
  await expect("покуп", "买", true), // still typing it
);
await expect("быстро", "快"); // the adverb finds the adjective (快 «быстрый»)
await expect("уставший", "累"); // the participle finds the verb, and its other aspect
await expect("машина", "汽车"); // a page sense the one-line default leaves out
check((await lookup("выучить", "ru")).hits.length > 0, "выучить finds something (учить, its other aspect)");
const senseOf = async (q: string, word: string) => (await lookup(q, "ru")).hits.find((h) => h.word === word)?.sense;
const world = await senseOf("мир", "世界");
const peace = await senseOf("мир", "和平");
check(
  world?.phrase?.text === "全世界" && peace?.phrase?.text === "世界和平",
  `мир: the two rows show their own phrase (${world?.phrase?.text} / ${peace?.phrase?.text})`,
);
const carry = await senseOf("таскать", "背");
check(carry?.meaning.startsWith("нести на себе") === true && carry.reading === "bēi", `таскать → 背 in its bēi sense: ${JSON.stringify(carry)}`);
const recite = await senseOf("наизусть", "背");
check(recite?.meaning.startsWith("учить наизусть") === true && !recite.reading, `наизусть → 背 «учить наизусть», the card's own bèi: ${JSON.stringify(recite)}`);
check(!(await lookup("visit", "ru")).hits.some((h) => h.sense), "only a Russian query carries a page sense");

// The audit's everyday queries (.review/ux-dictionary/score.mts): is the word a native
// speaker would accept the first row? 89/111 first and 94 in the top 3 before; 95 and
// 106 now. The rest wait for the register table (BACKLOG 8c: 有钱, 难过, 打电话).
const GOLD: Record<string, string[]> = {
  богатый: ["有钱"], мир: ["世界"], учить: ["教", "学", "学习"], лёгкий: ["轻", "容易", "简单"], ключ: ["钥匙"],
  жить: ["住", "生活"], брать: ["拿"], идти: ["去", "走"], хороший: ["好"], большой: ["大"], время: ["时间"],
  дело: ["事", "事情"], вопрос: ["问题"], работа: ["工作"], деньги: ["钱"], играть: ["玩", "玩儿"],
  звонить: ["打电话"], говорить: ["说", "说话"], сказать: ["说"], видеть: ["看见", "看到"], знать: ["知道"],
  думать: ["想", "觉得"], хотеть: ["想", "要"], любить: ["爱", "喜欢"], есть: ["吃"], пить: ["喝"],
  спать: ["睡觉", "睡"], покупать: ["买"], дом: ["家", "房子"], семья: ["家", "家庭"], друг: ["朋友"],
  город: ["城市"], страна: ["国家", "国"], учитель: ["老师"], язык: ["语言"], еда: ["饭", "食物", "吃的"],
  машина: ["车", "汽车"], дорога: ["路"], день: ["天"], сегодня: ["今天"], сейчас: ["现在"], новый: ["新"],
  старый: ["老", "旧"], маленький: ["小"], красивый: ["漂亮", "好看", "美"], трудный: ["难"], дорогой: ["贵"],
  дешёвый: ["便宜"], быстро: ["快"], быстрый: ["快"], понимать: ["懂", "明白", "理解"],
  помогать: ["帮", "帮助", "帮忙"], ждать: ["等"], открывать: ["开", "打开"], смотреть: ["看"], слушать: ["听"],
  писать: ["写"], спрашивать: ["问"], отвечать: ["回答"], начинать: ["开始"],
  встречать: ["见面", "遇到", "遇见", "接", "碰到"], искать: ["找"], найти: ["找到"], болеть: ["生病", "病", "疼"],
  устать: ["累"], интересный: ["有意思", "有趣"], важный: ["重要"], холодный: ["冷"], погода: ["天气"],
  телефон: ["电话", "手机"], магазин: ["商店", "店"], больница: ["医院"], врач: ["医生"], вещь: ["东西"],
  жизнь: ["生活", "生命", "人生"], человек: ["人"], ребёнок: ["孩子"], место: ["地方"], делать: ["做", "干"],
  сделать: ["做"], купить: ["买"], посмотреть: ["看"], понять: ["懂", "明白", "理解"], мочь: ["能", "可以", "会"],
  нужно: ["要", "需要", "得", "应该"], нравиться: ["喜欢"], работать: ["工作"], отдыхать: ["休息"],
  вкусный: ["好吃"], очень: ["很", "非常"], уже: ["已经"], тоже: ["也"], почему: ["为什么"], сколько: ["多少", "几"],
  где: ["哪儿", "哪里"], можно: ["可以"], утро: ["早上"], неделя: ["星期", "周"], гулять: ["散步", "逛"],
  путешествовать: ["旅游", "旅行"], вода: ["水"], чай: ["茶"], брат: ["哥哥", "弟弟", "兄弟"],
  уставший: ["累"], грустный: ["难过", "伤心"], весёлый: ["开心", "高兴", "快乐"], ехать: ["去", "坐"],
  учиться: ["学习", "学", "上学"], выучить: ["学会", "背"], помнить: ["记得"], забыть: ["忘", "忘记"],
};
let first = 0;
let top3 = 0;
for (const [q, ok] of Object.entries(GOLD)) {
  const at = (await lookup(q, "ru")).hits.findIndex((h) => ok.includes(h.word));
  if (at === 0) first++;
  if (at >= 0 && at < 3) top3++;
}
const n = Object.keys(GOLD).length;
check(first >= 95 && top3 >= 106, `everyday queries: the natural word first in ${first}/${n}, in the top 3 in ${top3}/${n}`);

// The card for a picked sense (the add path, services/capture.ts).
const { pickedSense } = await import("../src/services/capture.js");
const bei = await cedictCard("背", { count: false });
const picked = bei && pickedSense("背", "ru", carry?.index ?? -1, { phonetic: bei.phonetic, meaningZh: defaultMeaning("背", "ru")! });
check(
  picked?.phonetic === "bēi" && picked.meaningZh.startsWith("нести на себе") && picked.sense === "нести на себе",
  `背 picked as «таскать»: ${JSON.stringify(picked)}`,
);
const buy = await cedictCard("买", { count: false });
check(
  buy !== null && pickedSense("买", "ru", 0, { phonetic: buy.phonetic, meaningZh: defaultMeaning("买", "ru")! }) === null,
  "买 picked as «купить» keeps the default: it already leads with that sense",
);

// 4. Fast enough for every keystroke (debounced 200 ms in the form).
const worst = Math.max(...times);
check(worst < 150, `slowest lookup ${worst} ms`);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
