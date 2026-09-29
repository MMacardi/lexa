// Samples every AI chat a learner reads — Mika, a card's Explain and its follow-up
// chat, the coach's free chat and practice drill — on typical HSK 4 questions from a
// Russian speaker, prints the replies, and flags what makes them hard to read:
//   - a literal "\n" (the model escaped a line break twice),
//   - markdown in the coach's plain-text bubbles (they print ** and # as is),
//   - in the Mika/card answers: a Chinese example line with no pinyin next to it,
//     and one unbroken block of text where a list or short paragraphs belonged.
// Model output varies, so read the printout too; the flags are the floor.
//
// Seven qwen-plus calls, about ¥0.01 a run (2026-09-29). Run against a DEV database
// — it creates a throwaway user and deletes it:
//   cd backend && npx tsx scripts/check-chat-format.ts
import { prisma } from "../src/services/db.js";
import { deleteAccount } from "../src/services/accountData.js";
import { explainWord, askAboutWord } from "../src/services/vocab.js";
import { tutorChat } from "../src/services/tutorChat.js";
import { coachChat } from "../src/services/coachChat.js";
import { coachDrill } from "../src/services/coachDrill.js";

const TG = `test-format-${Date.now()}`;
const HAN = /[㐀-鿿]/;
const PINYIN = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;
let flags = 0;

function flag(where: string, why: string) {
  flags++;
  console.log(`  ✗ ${where}: ${why}`);
}

// Markdown-rendered answers (RichText): Mika, Explain, the card chat.
function checkRich(where: string, text: string) {
  if (/\\n/.test(text)) flag(where, 'literal "\\n"');
  const lines = text.split("\n");
  // A line that is mostly Chinese (an example sentence) wants pinyin on it or on the next line.
  lines.forEach((l, i) => {
    const han = (l.match(new RegExp(HAN, "g")) ?? []).length;
    if (han >= 6 && han / l.replace(/\s/g, "").length > 0.5 && !PINYIN.test(l) && !PINYIN.test(lines[i + 1] ?? ""))
      flag(where, `Chinese line without pinyin: ${l.trim().slice(0, 40)}`);
  });
  // A pinyin line hangs under the Chinese sentence it reads — not under a Russian one.
  lines.forEach((l, i) => {
    if (i > 0 && /^\s{2,}\S/.test(l) && PINYIN.test(l) && !HAN.test(lines[i - 1]))
      flag(where, `pinyin under a line with no Chinese: ${lines[i - 1].trim().slice(0, 40)}`);
  });
  const longest = Math.max(...lines.map((l) => l.length));
  if (text.length > 320 && longest > 300) flag(where, `a ${longest}-character block with no break`);
}

// One surface failing is a finding, not the end of the run.
async function attempt(where: string, run: () => Promise<void>) {
  try {
    await run();
  } catch (e) {
    flag(where, `failed: ${(e as Error).message.slice(0, 160)}`);
  }
}

// Plain-text bubbles (the coach): no markdown, no escapes.
function checkPlain(where: string, text: string) {
  if (/\\n/.test(text)) flag(where, 'literal "\\n"');
  if (/\*\*|^#{1,4}\s|`/m.test(text)) flag(where, "markdown the bubble shows as symbols");
}

function show(title: string, text: string) {
  console.log(`\n=== ${title} (${text.length} chars)\n${text}\n`);
}

async function main() {
  const user = await prisma.user.create({ data: { telegramId: TG, firstName: "Format", nativeLang: "ru" } });
  const card = await prisma.word.create({
    data: { userId: user.id, word: "由于", sourceLang: "zh", targetLang: "ru", meaningZh: "из-за, вследствие", partOfSpeech: "союз" },
  });

  let explanation = "";
  await attempt("explain", async () => {
    explanation = await explainWord(card.id);
    show("Explain 由于", explanation);
    checkRich("explain", explanation);
    // Meaning, four bullets and an example don't fit in a couple of lines.
    if (explanation.split("\n").filter((l) => l.trim()).length < 4) flag("explain", "fewer than 4 lines — part of it went missing");
  });

  await attempt("card chat", async () => {
    const follow = await askAboutWord(card.id, [
      { role: "user", content: "Объясни «由于»" },
      { role: "assistant", content: explanation || "由于 — из-за." },
      { role: "user", content: "а в чём разница между 由于 и 因为? когда что говорить?" },
    ]);
    show("Card chat: 由于 vs 因为", follow.answer);
    checkRich("card chat", follow.answer);
  });

  const asks = [
    "Чем отличается 了 после глагола от 了 в конце предложения?",
    "Дай 5 полезных слов HSK 4 про путешествия",
    "Исправь, пожалуйста: 我昨天去了商店买东西了很多。",
  ];
  for (const q of asks) {
    await attempt(`mika "${q.slice(0, 24)}"`, async () => {
      // Streamed, as the app asks Mika.
      const r = await tutorChat({ messages: [{ role: "user", content: q }], sourceLang: "zh", targetLang: "ru", level: "B1", onDelta: () => {} });
      show(`Mika: ${q}`, r.answer);
      checkRich(`mika "${q.slice(0, 24)}"`, r.answer);
    });
  }

  const words = [
    { word: "坚持", meaning: "упорно продолжать" },
    { word: "由于", meaning: "из-за" },
    { word: "旅行", meaning: "путешествие" },
  ];
  await attempt("coach chat", async () => {
    const chat = await coachChat({
      messages: [{ role: "user", content: "我今天很累，工作太多了。" }],
      words,
      sourceLang: "zh",
      targetLang: "ru",
      level: "B1",
    });
    show("Coach chat", chat.say);
    checkPlain("coach chat", chat.say);
  });

  await attempt("coach drill", async () => {
    const drill = await coachDrill({ messages: [], words, sourceLang: "zh", targetLang: "ru", level: "B1" });
    show("Coach drill (opening)", drill.say);
    checkPlain("coach drill", drill.say);
  });

  console.log(flags ? `\n${flags} formatting flag(s) — see above.` : "\nNo formatting flags.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await deleteAccount(TG).catch(() => {});
    await prisma.$disconnect();
  });
