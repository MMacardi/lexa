// Live Reader OCR check using the same printed lesson fixture as Mika's photo check.
// One small vision call; no learner data is changed. Run against local Docker:
//   docker compose exec -T backend npx tsx scripts/check-reader-ocr.ts
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ocrImage } from "../src/services/llm.js";
import { prisma } from "../src/services/db.js";

try {
  const dataUrl = `data:image/jpeg;base64,${readFileSync(new URL("./fixtures/lesson-page.jpg", import.meta.url)).toString("base64")}`;
  const text = await ocrImage({ dataUrl, sourceLang: "zh" });
  for (const word of ["复习", "词典", "图书馆"]) assert.ok(text.includes(word), `OCR reads ${word}`);
  assert.ok(!/[а-яё]/i.test(text), "OCR transcribes Chinese instead of translating it");
  console.log("Reader OCR passed:", text);
} catch (e) {
  console.error("Reader OCR failed:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
