// Proves photos in Mika chat: a turn with a photo goes to the vision model, which
// actually reads it (the words on the page come back, and are offered as cards); a
// text follow-up still sees the photo; a chat with no photo stays on qwen-plus.
//
// Live only — the assertion is that the model saw the picture, which needs the key.
// The fixture is a printed lesson list (第三课 生词: 复习, 词典, 虽然……但是……, and
// 我昨天去图书馆借了一本词典。). Reads token_usage rows, writes nothing else:
//   cd backend && npx tsx scripts/check-tutor-photo.ts
import { readFileSync } from "node:fs";

const { prisma } = await import("../src/services/db.js");
const { tutorChat } = await import("../src/services/tutorChat.js");
const { CHAT_VISION_MODEL } = await import("../src/services/llm.js");

const photo = `data:image/jpeg;base64,${readFileSync(new URL("./fixtures/lesson-page.jpg", import.meta.url)).toString("base64")}`;
const pair = { sourceLang: "zh", targetLang: "ru", level: "A2" };

let failures = 0;
function check(ok: boolean, what: string) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures++;
}

// Which model a tutorChat call was billed under: the usage row is written fire-and-
// forget (and stamped by the DB clock), so count rows per model before and after.
const usageCount = (model: string) => prisma.tokenUsage.count({ where: { feature: "tutorChat", model } });
async function billedTo(model: string, before: number): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    if ((await usageCount(model)) > before) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

async function main() {
  // 1. A photo with no question, streamed like the app does.
  let visionBefore = await usageCount(CHAT_VISION_MODEL);
  let deltas = 0;
  const first = await tutorChat({
    messages: [{ role: "user", content: "", images: [photo] }],
    ...pair,
    onDelta: () => deltas++,
  });
  const seen = ["复习", "词典", "图书馆"].filter((w) => first.answer.includes(w) || first.addWords.includes(w));
  check(seen.length >= 2, `photo read: ${seen.join(", ") || "none of the page's words"} in the answer`);
  check(deltas > 3, `answer streamed (${deltas} deltas)`);
  check(first.addWords.some((w) => ["复习", "词典", "图书馆", "借"].includes(w)), `words offered: ${first.addWords.join(", ")}`);
  check(first.addCards.length > 0 && first.addCards.every((c) => c.meaning), `cards carry meanings (${first.addCards.length})`);
  check(await billedTo(CHAT_VISION_MODEL, visionBefore), `billed under ${CHAT_VISION_MODEL}`);

  // 2. A text follow-up: the photo is still in the window, so the model can still see it.
  const follow = await tutorChat({
    messages: [
      { role: "user", content: "", images: [photo] },
      { role: "assistant", content: first.answer },
      { role: "user", content: "Перепиши последнюю строку с картинки иероглифами и переведи её." },
    ],
    ...pair,
  });
  check(/图书馆/.test(follow.answer), `follow-up still sees the photo: ${follow.answer.slice(0, 80).replace(/\n/g, " ")}…`);

  // 3. No photo anywhere: the ordinary text model.
  await billedTo(CHAT_VISION_MODEL, visionBefore + 1); // let the follow-up's row land first
  visionBefore = await usageCount(CHAT_VISION_MODEL);
  const plainBefore = await usageCount("qwen-plus");
  const plain = await tutorChat({ messages: [{ role: "user", content: "Как сказать «словарь» по-китайски?" }], ...pair });
  check(/[词字]典/.test(plain.answer), "text chat answers");
  check(await billedTo("qwen-plus", plainBefore), "text chat billed under qwen-plus");
  check((await usageCount(CHAT_VISION_MODEL)) === visionBefore, `…and not under ${CHAT_VISION_MODEL}`);
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
console.log(failures ? `\n${failures} check(s) failed` : "\nall good");
process.exit(failures ? 1 : 0);
