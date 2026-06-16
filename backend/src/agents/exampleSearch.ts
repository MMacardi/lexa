import { prisma } from "../services/db.js";
import { searchNews } from "../services/search.js";
import { chatJson } from "../services/llm.js";
import { sentenceSelectionSchema, translationSchema } from "../lib/schemas.js";

export interface ExampleSearchResult {
  wordId: string;
  sentenceEn: string;
  sentenceZh: string;
  sourceName: string;
  sourceUrl: string;
}

// Map a domain to a human-friendly publication name for display/attribution.
const SOURCE_NAMES: Record<string, string> = {
  "reuters.com": "Reuters",
  "bbc.com": "BBC",
  "theguardian.com": "The Guardian",
  "npr.org": "NPR",
  "apnews.com": "AP News",
};

function sourceNameFromUrl(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, "");
  const key = Object.keys(SOURCE_NAMES).find((d) => host.endsWith(d));
  return key ? SOURCE_NAMES[key] : host;
}

/**
 * Example Search Agent.
 * Tool-using pipeline: news search (Tavily) -> LLM picks the most natural
 * sentence -> LLM translates it to Chinese -> persist word + example.
 */
export async function runExampleSearch(params: {
  userId: string;
  word: string;
}): Promise<ExampleSearchResult> {
  const word = params.word.trim().toLowerCase();

  // 1. External tool call — the part that makes this a real agent, not a chat loop.
  const articles = await searchNews(word);
  if (articles.length === 0) {
    throw new Error(`No news articles found containing "${word}"`);
  }

  // 2. LLM step 1: choose one natural sentence and which excerpt it came from.
  const numbered = articles.map((a, i) => `[${i}] ${a.content}`).join("\n\n");
  const selection = await chatJson({
    system:
      "You are an English teacher selecting an example sentence for a learner. " +
      "From the numbered news excerpts, choose ONE complete, natural sentence " +
      "that contains the target word and reads clearly on its own. " +
      'Respond as JSON: {"sentence": string, "sourceIndex": number}, where ' +
      "sourceIndex is the [n] of the excerpt the sentence came from.",
    user: `Target word: ${word}\n\nExcerpts:\n${numbered}`,
    schema: sentenceSelectionSchema,
  });

  // Guard against an out-of-range index from the model.
  const source = articles[selection.sourceIndex] ?? articles[0];

  // 3. LLM step 2: translate the chosen sentence to Chinese.
  const translation = await chatJson({
    system:
      "Translate the English sentence into natural Simplified Chinese. " +
      'Respond as JSON: {"translation": string}.',
    user: selection.sentence,
    schema: translationSchema,
  });

  // 4. Persist. Upsert the word (one row per user+word), then add the example.
  const wordRecord = await prisma.word.upsert({
    where: { userId_word: { userId: params.userId, word } },
    create: { userId: params.userId, word },
    update: {},
  });

  const example = await prisma.example.create({
    data: {
      wordId: wordRecord.id,
      sentenceEn: selection.sentence,
      sentenceZh: translation.translation,
      sourceName: sourceNameFromUrl(source.url),
      sourceUrl: source.url,
    },
  });

  return {
    wordId: wordRecord.id,
    sentenceEn: example.sentenceEn,
    sentenceZh: example.sentenceZh,
    sourceName: example.sourceName,
    sourceUrl: example.sourceUrl,
  };
}
