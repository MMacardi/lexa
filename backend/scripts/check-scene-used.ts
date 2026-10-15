// Proves a scene turn credits only the learner's own words (BACKLOG 1i: the model listed
// mission words the character had said, so the count read 4/5 after the learner used
// one). `learnerUsed` keeps the model's list to the mission pool and, for a Chinese
// word, to the learner's last line — written in characters or typed as pinyin.
// No model call, no database:
//   cd backend && npx tsx scripts/check-scene-used.ts
import { learnerUsed } from "../src/services/coachSceneTurn.js";

let failures = 0;
function check(got: string[], want: string[], what: string) {
  const ok = got.join() === want.join();
  console.log(`${ok ? "ok  " : "FAIL"} ${what}: ${got.join(" ") || "—"}${ok ? "" : ` (want ${want.join(" ") || "—"})`}`);
  if (!ok) failures++;
}

const mission = ["咖啡", "菜单", "推荐", "打包", "服务员"].map((word) => ({ word }));
// The waiter said 菜单 and 推荐; the model listed them with the learner's 咖啡.
const listed = ["咖啡", "菜单", "推荐"];

check(learnerUsed(listed, mission, "我要一杯咖啡，谢谢。"), ["咖啡"], "characters: only the word the learner wrote");
check(learnerUsed(listed, mission, "wo yao yi bei kafei"), ["咖啡"], "pinyin as one token");
check(learnerUsed(listed, mission, "Wǒ yào kā fēi!"), ["咖啡"], "pinyin with tones, syllables apart");
check(learnerUsed(listed, mission, "wo yao ka1 fei1"), ["咖啡"], "pinyin with tone numbers");
check(learnerUsed(listed, mission, "我要一杯咖啡，你推荐什么菜？"), ["咖啡", "推荐"], "two words in one line");
check(learnerUsed(listed, mission, "好的"), [], "a line with none of them");
check(learnerUsed(["咖啡", "蛋糕"], mission, "咖啡和蛋糕"), ["咖啡"], "a word off the mission list is dropped");
check(learnerUsed(["咖啡", "咖啡"], mission, "咖啡"), ["咖啡"], "listed twice, counted once");
check(learnerUsed(["打包"], mission, "kafei dabao"), ["打包"], "a joined pinyin token");
check(learnerUsed(["打包"], mission, "kafei da"), [], "half a word's pinyin is not the word");
// Another language: an inflected form can't be matched by spelling, so the model decides.
check(learnerUsed(["go", "order"], [{ word: "go" }, { word: "order" }], "I went there"), ["go", "order"], "English stays the model's call");

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
