// One-off: rewrite the stored `phonetic` of existing Chinese/Korean cards with
// deterministic local pinyin/romanization (older cards sometimes hold the model's
// IPA, e.g. 中国 → /tʂʊŋ.kwǒ/). Run inside the backend container:
//   docker exec onomika-backend node scripts/backfill-phonetic.mjs
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function phoneticFor(word, lang) {
  const w = (word ?? "").trim();
  if (!w) return null;
  if (lang === "zh" || lang === "zh-Hant") {
    const { pinyin } = await import("pinyin-pro");
    return pinyin(w, { toneType: "symbol", type: "string" }).trim() || null;
  }
  if (lang === "ko") {
    const { romanize } = await import("es-hangul");
    return romanize(w).trim() || null;
  }
  return null;
}

const words = await prisma.word.findMany({
  where: { sourceLang: { in: ["zh", "zh-Hant", "ko"] } },
  select: { id: true, word: true, sourceLang: true, phonetic: true },
});

let changed = 0;
for (const w of words) {
  const next = await phoneticFor(w.word, w.sourceLang);
  if (next && next !== w.phonetic) {
    await prisma.word.update({ where: { id: w.id }, data: { phonetic: next } });
    changed++;
    console.log(`${w.word}  ${w.phonetic ?? "—"}  ->  ${next}`);
  }
}
console.log(`\nDone. Updated ${changed} of ${words.length} zh/ko cards.`);
await prisma.$disconnect();
