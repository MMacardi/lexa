// Live check of the Reader's tap gloss for Chinese (BACKLOG "Ground the Reader's
// tap gloss in CC-CEDICT"): the sense a word has in its sentence, picked from the
// dictionary's list. Calls the model, so it matches loose keywords rather than
// exact text — a rephrased right answer passes, a different sense fails.
//
// Before grounding, 3 of the first 6 were wrong (了 → «уже», 只 → «один»,
// 过 → «проходить»); before the per-reading budget, 得 in 跑得很快 → «позволяет».
//
//   cd backend && npx tsx scripts/check-gloss.ts   (needs BAILIAN_API_KEY)
import { glossInContext } from "../src/services/translate.js";

const cases: [word: string, sentence: string, want: RegExp][] = [
  ["了", "他打了三个小时篮球。", /заверш|соверш/i],
  ["打", "他打了三个小时篮球。", /игра/i],
  ["只", "我家有一只猫。", /счёт|счет|животн/i],
  ["只", "我只有十块钱。", /только|лишь/i],
  ["过", "我去过北京。", /пережит|опыт|бывал/i],
  ["过", "我们过马路吧。", /перей|пересе|переход/i],
  ["行", "明天见面，这样行吗？", /можно|подход|годит|хорошо|ладно/i],
  ["行", "他写了一行字。", /строк|ряд/i],
  ["得", "他跑得很快。", /частиц|степен|результ/i],
  ["得", "我得走了。", /долж|надо|нужно/i],
  ["得", "他得了第一名。", /получ|занял|завоев/i],
  ["着", "他笑着说。", /длит|продолж|сопутств|процесс/i],
];

let failures = 0;
for (const [word, sentence, want] of cases) {
  const { gloss } = await glossInContext({ word, sentence, sourceLang: "zh", targetLang: "ru" });
  const ok = want.test(gloss);
  console.log(`${ok ? "ok  " : "FAIL"} ${word} in ${sentence} → ${gloss}`);
  if (!ok) failures++;
}
console.log(failures ? `\n${failures} of ${cases.length} glosses off` : `\nall ${cases.length} glosses right`);
process.exit(failures ? 1 : 0);
