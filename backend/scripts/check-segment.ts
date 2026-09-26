// Proves the Reader's Chinese word boundaries (BACKLOG "The Reader cuts Chinese
// into wrong words"): ICU's split, repaired with CC-CEDICT, offers 了 and 三 as
// separate taps and keeps real words whole. No database, no model.
//   cd backend && npx tsx scripts/check-segment.ts
import { segmentChinese } from "../src/services/segment.js";

let failures = 0;
function check(text: string, want: string[]) {
  const got = segmentChinese(text);
  const words = got.filter((t) => t.wordLike).map((t) => t.text);
  const ok = want.every((w, i) => words[i] === w) && words.length === want.length && got.map((t) => t.text).join("") === text;
  console.log(`${ok ? "ok  " : "FAIL"} ${text} → ${words.join(" | ")}`);
  if (!ok) failures++;
}

// ICU alone: 他 | 打 | 了三 | 个 | …, 我想 | 了解 …, 她在 | 北京 …
check("他打了三个小时篮球。", ["他", "打", "了", "三", "个", "小时", "篮球"]);
check("你打电话给我吧。", ["你", "打电话", "给", "我", "吧"]);
check("我想了解一下中国的历史。", ["我", "想", "了解", "一下", "中国", "的", "历史"]);
check("她在北京大学学习汉语。", ["她", "在", "北京", "大学", "学习", "汉语"]);
// Field words the HSK subset doesn't list stay whole where ICU had them (BACKLOG
// "The Reader cuts field words the HSK dictionary doesn't know"): the split step
// used to ask the subset alone and cut 算法 → 算 法, 延迟 → 延 迟.
check("我们用新的算法降低了推理的延迟，参数也少了。", ["我们", "用", "新", "的", "算法", "降低", "了", "推理", "的", "延迟", "参数", "也", "少", "了"]);
// A name of common characters no longer comes apart (蒙古 was 蒙 古).
check("他去过蒙古。", ["他", "去", "过", "蒙古"]);
// Mixed text passes through: only Chinese tokens are touched.
check("我们一起去看电影吧！Hello 123", ["我们", "一起", "去", "看", "电影", "吧", "Hello", "123"]);

console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
