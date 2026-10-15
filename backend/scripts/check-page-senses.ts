// A word added with the app's own meaning ends up in one of its word page's senses
// (services/capture.ts fitMeaningsToPages).
//
// 响应 came in from a Reader tap as «ответ»; its page lists «откликаться (на призыв)»
// and «реагировать, отвечать на запрос (о системе, службе)», and ticked neither —
// the card tested a sense the page didn't show (the author, 2026-10-14). Adds the
// words as the Reader does (/words/batch: a meaning and the sentence) and waits for
// the background pick. One model call per run.
//   cd backend && npx tsx scripts/check-page-senses.ts
import { prisma } from "../src/services/db.js";
import { importWordsForUser } from "../src/services/importWords.js";
import { hskPage } from "../src/services/wordPages.js";

const TG = `test-senses-${Date.now()}`;

const cases = [
  // A server answering a request: the second sense.
  { word: "响应", meaning: "ответ", sentence: "服务器一直没有响应我的请求。", want: 1 },
  // Everyone answering the call: the first.
  { word: "响应", meaning: "отвечать", sentence: "大家都积极响应学校的号召。", want: 0, as: "响应 (призыв)" },
  // Already the page's own head word: left as it came.
  { word: "味道", meaning: "вкус", sentence: "这个菜的味道很好。", want: -1 },
];

async function main() {
  const user = await prisma.user.create({ data: { telegramId: TG, firstName: "Senses", nativeLang: "ru" } });
  try {
    const bad: string[] = [];
    for (const c of cases) {
      await prisma.word.deleteMany({ where: { userId: user.id } });
      await importWordsForUser({
        telegramId: TG,
        sourceLang: "zh",
        targetLang: "ru",
        items: [{ word: c.word, meaning: c.meaning, example: c.sentence, exampleTranslation: "", synonyms: [] }],
        keepProvidedExtras: true,
        fitMeanings: true,
      });
      const page = hskPage(c.word, "ru")!;
      const want = c.want < 0 ? c.meaning : page.s[c.want].m;
      let got = "";
      for (let t = 0; t < 60; t++) {
        got = (await prisma.word.findFirst({ where: { userId: user.id, word: c.word }, select: { meaningZh: true } }))?.meaningZh ?? "";
        if (got !== c.meaning || c.want < 0) break;
        await new Promise((r) => setTimeout(r, 500));
      }
      if (c.want < 0) await new Promise((r) => setTimeout(r, 3000)); // nothing should come
      got = (await prisma.word.findFirst({ where: { userId: user.id, word: c.word }, select: { meaningZh: true } }))?.meaningZh ?? "";
      const ok = got === want;
      console.log(`${c.as ?? c.word} «${c.meaning}» in ${c.sentence} -> «${got}» ${ok ? "ok" : `WRONG, want «${want}»`}`);
      if (!ok) bad.push(c.as ?? c.word);
    }
    if (bad.length) throw new Error(`wrong sense for: ${bad.join(", ")}`);
  } finally {
    await prisma.word.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

main()
  .catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
