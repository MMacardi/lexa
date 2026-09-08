// One-off: compare token cost + output quality of the NEW combined enrichment
// (1 call) vs the OLD separate agents (example.compose + example.translate +
// tutor = 3 calls) for the same word. Run inside the backend container:
//   docker exec onomika-backend node scripts/measure-tokens.mjs
import { enrichWordEntry } from "../dist/agents/enrich.js";
import { runExampleSearch } from "../dist/agents/exampleSearch.js";
import { runTutor } from "../dist/agents/tutor.js";
import { prisma } from "../dist/services/db.js";

const WORD = process.argv[2] || "brave";
const src = "en";
const tgt = "ru";
const user = await prisma.user.findFirst({ where: { telegramId: "865277762" }, select: { id: true } });

console.log(`\n=== NEW (combined, 1 call) — "${WORD}" ===`);
const nw = await enrichWordEntry({ word: WORD, sourceLang: src, targetLang: tgt, exampleStyle: "casual", withExample: true });
console.log("meaning :", nw.meaningZh);
console.log("example :", nw.example, "|", nw.exampleTranslation);
console.log("synonyms:", nw.synonyms.join(", "), "| antonyms:", nw.antonyms.join(", "), "| pos:", nw.partOfSpeech);

console.log(`\n=== OLD (3 calls) — "${WORD}" ===`);
const ex = await runExampleSearch({ userId: user.id, word: WORD, sourceLang: src, targetLang: tgt, exampleStyle: "casual", exampleSource: "ai" });
await runTutor({ wordId: ex.wordId, word: WORD, sourceLang: src, targetLang: tgt });
const old = await prisma.word.findUnique({ where: { id: ex.wordId }, include: { examples: true } });
console.log("meaning :", old?.meaningZh);
console.log("example :", ex.sentenceEn, "|", ex.sentenceZh);
console.log("synonyms:", (old?.synonyms || []).join(", "), "| antonyms:", (old?.antonyms || []).join(", "), "| pos:", old?.partOfSpeech);
await prisma.word.delete({ where: { id: ex.wordId } });
console.log("\n(cleaned up the OLD test word)");
await prisma.$disconnect();
