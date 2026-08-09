import { prisma } from "./db.js";
import { chatJson } from "./llm.js";
import { importPreviewSchema, type ImportedCard } from "../lib/schemas.js";
import { langName } from "../lib/langs.js";

const MAX_CARDS = 100;

async function ensureUser(telegramId: string) {
  return prisma.user.upsert({
    where: { telegramId },
    create: { telegramId },
    update: {},
  });
}

/** Turn pasted vocabulary notes into clean, editable card candidates. */
export async function previewImportedWords(params: {
  text: string;
  sourceLang: string;
  targetLang: string;
}) {
  const text = params.text.trim();
  if (!text) throw new Error("Paste a word list or choose a .txt file first.");
  if (text.length > 20_000) throw new Error("Please import at most 20,000 characters at a time.");

  const sourceName = langName(params.sourceLang);
  const targetName = langName(params.targetLang);
  const parsed = await chatJson({
    system:
      `You turn ${sourceName} input into flashcards for a learner of ${targetName}. The input can be in ` +
      `ANY of these forms — handle all:\n` +
      `1) "word — meaning" / "word: meaning" / "word, meaning" lines → keep the given ${targetName} meaning ` +
      `(fix it only if clearly wrong), preserve any example/translation/synonyms.\n` +
      `2) a plain list of ${sourceName} words/phrases (no translations) → make one card per item and ` +
      `generate a concise, natural ${targetName} meaning yourself.\n` +
      `3) free-form ${sourceName} text / a sentence with no translations → split it into its distinct ` +
      `words (and obvious phrases) and make one card per word, generating each ${targetName} meaning. ` +
      `Keep the words the user actually wrote; only skip pure punctuation/numbers.\n` +
      `Normalize obvious ${sourceName} spelling mistakes and de-duplicate. Return at most ${MAX_CARDS} items, ` +
      `no commentary. If the input is empty or has no usable words, return an empty items array. ` +
      'JSON shape: {"items":[{"word":string,"meaning":string,"example":string,"exampleTranslation":string,"synonyms":string[]}]}.',
    user: text,
    schema: importPreviewSchema,
    timeoutMs: 90_000, // a large paste yields many cards — allow extra time
  });

  // A repeated word is not useful as two cards in the same import preview.
  const seen = new Set<string>();
  const items = (parsed.items ?? []).filter((item) => {
    const key = item.word.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (items.length === 0) {
    throw new Error("Couldn't find any words here. Paste words (one per line) or 'word — meaning' pairs.");
  }
  return items;
}

/**
 * Save selected parsed cards. Plain cards are written immediately; optional
 * enrichment is queued afterwards, outside the DB write, so a Tavily/Qwen
 * delay never holds the HTTP request open or loses a valid import.
 */
export async function importWordsForUser(params: {
  telegramId: string;
  sourceLang: string;
  targetLang: string;
  items: ImportedCard[];
  collectionIds?: string[];
  keepProvidedExtras?: boolean;
  generateDetails?: boolean;
  generateExamples?: boolean;
  level?: string;
  exampleStyle?: string;
  // Attribution for a provided example (e.g. the Reader's text source).
  exampleSourceName?: string;
}) {
  if (params.items.length === 0) throw new Error("Select at least one card to import.");
  if (params.items.length > MAX_CARDS) throw new Error(`You can import up to ${MAX_CARDS} cards at once.`);
  const user = await ensureUser(params.telegramId);
  const collectionIds = [...new Set(params.collectionIds ?? [])];
  if (collectionIds.length) {
    const owned = await prisma.collection.count({
      where: { id: { in: collectionIds }, userId: user.id },
    });
    if (owned !== collectionIds.length) throw new Error("One of the selected collections is unavailable.");
  }

  const normalized = params.items.map((item) => ({
    ...item,
    word: item.word.trim().toLowerCase(),
    meaning: item.meaning.trim(),
    example: item.example.trim(),
    exampleTranslation: item.exampleTranslation.trim(),
    synonyms: item.synonyms.map((s) => s.trim()).filter(Boolean),
  }));
  const existing = await prisma.word.findMany({
    where: { userId: user.id, word: { in: normalized.map((item) => item.word) } },
    select: { word: true },
  });
  const existingWords = new Set(existing.map((word) => word.word));
  const created: { id: string; word: string }[] = [];

  for (const item of normalized) {
    if (existingWords.has(item.word)) continue;
    try {
      const record = await prisma.word.create({
        data: {
          userId: user.id,
          word: item.word,
          sourceLang: params.sourceLang,
          targetLang: params.targetLang,
          meaningZh: item.meaning,
          synonyms: params.keepProvidedExtras ? item.synonyms : [],
          collocations: [],
          antonyms: [],
          collections: collectionIds.length ? { connect: collectionIds.map((id) => ({ id })) } : undefined,
          examples:
            params.keepProvidedExtras && item.example
              ? {
                  create: {
                    sentenceEn: item.example,
                    sentenceZh: item.exampleTranslation,
                    sourceName: params.exampleSourceName?.trim() || "Imported list",
                    sourceUrl: "",
                  },
                }
              : undefined,
        },
      });
      created.push({ id: record.id, word: record.word });
    } catch (error) {
      if (error && typeof error === "object" && (error as { code?: string }).code === "P2002") continue;
      throw error;
    }
  }

  const job =
    created.length && (params.generateDetails || params.generateExamples)
      ? await prisma.importJob.create({
          data: {
            userId: user.id,
            total: created.length,
            generateDetails: Boolean(params.generateDetails),
            generateExamples: Boolean(params.generateExamples),
            level: params.level ?? null,
            exampleStyle: params.exampleStyle ?? null,
            cards: created,
            errors: [],
          },
          select: { id: true, status: true, total: true, processed: true },
        })
      : null;

  return {
    created: created.length,
    skipped: params.items.length - created.length,
    job,
  };
}
