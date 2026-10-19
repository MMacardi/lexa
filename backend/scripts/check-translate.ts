// Reader translation regressions: a notice with an attachment, and textbook
// dialogues where the model must translate the exercise rather than answer it.
// Three small live calls, local Docker only:
//   docker compose exec -T backend npx tsx scripts/check-translate.ts
import "dotenv/config";
import assert from "node:assert/strict";
import { translateText } from "../src/services/translate.js";
import { prisma } from "../src/services/db.js";

const TEXT =
  "各位同学：@所有人\n因公寓电视机设备使用年限久远、老化耗电，存在安全隐患，将于2026年10月20日统一搬移公寓剩余房间电视机。相关通知已张贴完毕，请各位同学提前整理周边个人物品，谨防遗失损坏。\n[Фото]";

const DIALOGUE = [
  "男：妈妈，后面这几页书我明天再看行吗？",
  "女：别养成坏习惯，记住，今天能完成的事情一定不要留到明天做。",
  "男：那您快把刚才没吃完的蛋糕拿出来，我现在就把它吃光！",
  "女：你这孩子，就知道吃。",
  "问：妈妈让孩子做什么？",
].join("\n");

const MANAGERS = [
  "王经理：听说这次生意你到现在还没谈成。",
  "马经理：按我以前的经验，早应该谈成了，这次我也不知道哪儿出了问题。",
  "王经理：有句话叫“规定和经验是死的，人是活的”。当“规定”和“经验”不能解决问题时，建议你改变一下自己的态度和想法。",
  "马经理：很多时候，我都习惯根据过去的经验做事，可惜，经验不是全部都是对的。",
  "王经理：遇到不能解决的问题时，我们应该试着走走以前从来没走过的路，也许这样就能找到解决问题的方法了。",
  "马经理：好，我再跟同事商量商量，希望能及时发现问题，并且准确地找到解决问题的方法。",
].join("\n");

async function russian(text: string) {
  const { translation } = await translateText({ text, sourceLang: "zh", targetLang: "ru" });
  assert.ok(/[а-яё]/i.test(translation), "Russian translation is present");
  console.log(translation, "\n");
  return translation;
}

const t0 = Date.now();
try {
  assert.deepEqual(await translateText({ text: "  ", sourceLang: "zh", targetLang: "ru" }), { translation: "" });
  const notice = await russian(TEXT);
  assert.ok(notice.includes("2026"), "The notice's year is preserved");
  assert.ok(notice.includes("20"), "The notice's day is preserved");
  assert.ok(/телевизор/i.test(notice), "The notice is about removing televisions");

  const dialogue = await russian(DIALOGUE);
  assert.ok(/страниц|книг/i.test(dialogue), "The son's request to read tomorrow is translated");
  assert.ok(/торт|пирог|пирожн|кекс/i.test(dialogue), "The cake joke is translated");
  assert.ok(dialogue.split("\n").filter(s => s.trim()).length >= 5, "All four turns and the final question are kept");
  assert.ok(/\?\s*$/.test(dialogue.trim()), "The exercise ends with a translated question, not its answer");

  const managers = await russian(MANAGERS);
  assert.ok(/опыт/i.test(managers) && /сделк|переговор|договор/i.test(managers), "The managers' discussion is translated");
  assert.ok(/коллег/i.test(managers), "The last manager's turn is kept");
  assert.ok(managers.split("\n").filter(s => s.trim()).length >= 6, "All six turns are kept");
  console.log("ok", Date.now() - t0, "ms — all three Reader passages translated in full");
} catch (e) {
  console.error("FAILED", Date.now() - t0, "ms", (e as Error).message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
