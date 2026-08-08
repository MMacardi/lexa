import { prisma } from "../services/db.js";
import { searchNews } from "../services/search.js";
import { chatJson } from "../services/llm.js";
import { sentenceSelectionSchema, translationSchema, exampleSentenceSchema } from "../lib/schemas.js";
import { langName } from "../lib/langs.js";

// Does the sentence actually use the source language's script? Catches the case
// where the web results (and the model) drift into English for a non-Latin word.
function matchesSourceScript(sentence: string, sourceLang: string): boolean {
  const has = (lo: number, hi: number) => {
    for (const ch of sentence) {
      const c = ch.codePointAt(0) ?? 0;
      if (c >= lo && c <= hi) return true;
    }
    return false;
  };
  switch (sourceLang) {
    case "zh":
      return has(0x4e00, 0x9fff) || has(0x3400, 0x4dbf);
    case "ja":
      return has(0x3040, 0x30ff) || has(0x4e00, 0x9fff);
    case "ko":
      return has(0xac00, 0xd7af);
    case "ru":
      return has(0x0400, 0x04ff);
    default:
      return true; // Latin-script languages: trust the model
  }
}

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
// Register hints per example style: `query` nudges the web search, `register`
// describes the tone the model should prefer when picking a sentence.
const STYLE_HINTS: Record<string, { query: string; register: string }> = {
  news: { query: "", register: "news / journalistic" },
  casual: { query: "everyday conversation", register: "everyday, casual real-life" },
  dialogue: { query: "dialogue conversation spoken", register: "spoken dialogue / conversational" },
  literary: { query: "novel book literature", register: "literary (fiction or non-fiction prose)" },
};

export async function runExampleSearch(params: {
  userId: string;
  word: string;
  sourceLang?: string;
  targetLang?: string;
  level?: string; // learner CEFR level, e.g. "B1"
  exampleStyle?: string; // news | casual | dialogue | literary
  // When set, attach the example to this existing card (import enrichment).
  // When absent, create a new card (single-word add — duplicates allowed).
  wordId?: string;
}): Promise<ExampleSearchResult> {
  const word = params.word.trim().toLowerCase();
  const sourceLang = params.sourceLang ?? "en";
  const targetLang = params.targetLang ?? "zh";
  const sourceName = langName(sourceLang);
  const targetName = langName(targetLang);
  const style = STYLE_HINTS[params.exampleStyle ?? "news"] ? (params.exampleStyle ?? "news") : "news";
  const styleInfo = STYLE_HINTS[style];

  // 1. External tool call — the part that makes this a real agent, not a chat loop.
  // News style + English: restrict to news domains. Otherwise search the open
  // web (with a register hint) so we find authentic sentences in that style.
  const articles = await searchNews(word, {
    restrictNews: style === "news" && sourceLang === "en",
    // The register hint is English, so only use it for English searches —
    // otherwise it drags a non-English query toward English results.
    queryHint: sourceLang === "en" ? styleInfo.query || undefined : undefined,
  });
  if (articles.length === 0) {
    throw new Error(`No sources found containing "${word}"`);
  }

  // 2. LLM step 1: choose one natural sentence and which excerpt it came from.
  const numbered = articles.map((a, i) => `[${i}] ${a.content}`).join("\n\n");
  const levelLine = params.level
    ? `The learner's CEFR level is ${params.level}. Choose a sentence a ${params.level} learner can actually understand: prefer common, high-frequency vocabulary and avoid rare, technical, archaic, or foreign loan-words beyond their level. If every candidate is too hard, pick the simplest and clearest one. `
    : "";
  const selection = await chatJson({
    system:
      `You are a ${sourceName} language teacher creating one example sentence for a learner. ` +
      `Pick the best COMPLETE, natural sentence written in ${sourceName} from the numbered ` +
      `excerpts that uses the target word in meaningful context — a real sentence with a subject ` +
      `and a verb that shows what the word means. NEVER pick a title, headline, company or brand ` +
      `name, URL, menu/navigation label, or a bare fragment. The sentence MUST be written in ` +
      `${sourceName} and actually contain the target word. ` +
      `Prefer a ${styleInfo.register} tone. ` +
      levelLine +
      `If none of the excerpts contain a suitable natural ${sourceName} sentence (for example the ` +
      `word is a brand or proper noun and the results are just names or links), WRITE one yourself: ` +
      `a correct, natural, interesting ${sourceName} sentence that clearly shows the word in use. ` +
      `In that case set "composed" to true and "sourceIndex" to -1. ` +
      'Respond as JSON: {"sentence": string, "sourceIndex": number, "composed": boolean}, where ' +
      "sourceIndex is the [n] of the excerpt the sentence came from (or -1 if you wrote it).",
    user: `Target word: ${word}\n\nExcerpts:\n${numbered}`,
    schema: sentenceSelectionSchema,
  });

  // A composed sentence (or an out-of-range index) has no real source to link to.
  let sentence = selection.sentence.trim();
  let composed = selection.composed || selection.sourceIndex < 0 || selection.sourceIndex >= articles.length;

  // Safety net: if the picked sentence isn't even in the source language's
  // script (e.g. an English blurb for a Chinese word), compose a proper one.
  if (!composed && !matchesSourceScript(sentence, sourceLang)) {
    composed = true;
  }
  if (composed) {
    const written = await chatJson({
      system:
        `Write ONE natural, correct ${sourceName} sentence that uses the word "${word}" in clear, ` +
        `interesting everyday context. Prefer a ${styleInfo.register} tone. ` +
        (levelLine || "") +
        `The sentence MUST be written in ${sourceName} and contain "${word}". ` +
        'Respond as JSON: {"sentence": string}.',
      user: word,
      schema: exampleSentenceSchema,
    });
    sentence = written.sentence.trim();
  }
  const source = composed ? null : articles[selection.sourceIndex];

  // 3. LLM step 2: translate the chosen sentence to the target language.
  const translation = await chatJson({
    system:
      `Translate the ${sourceName} sentence into natural ${targetName}. ` +
      'Respond as JSON: {"translation": string}.',
    user: sentence,
    schema: translationSchema,
  });

  // 4. Persist. Attach to an existing card when a wordId is given (import
  // enrichment); otherwise create a fresh row (single add — duplicates allowed).
  const wordId =
    params.wordId ??
    (await prisma.word.create({ data: { userId: params.userId, word, sourceLang, targetLang } })).id;

  const example = await prisma.example.create({
    data: {
      wordId,
      sentenceEn: sentence,
      sentenceZh: translation.translation,
      sourceName: source ? sourceNameFromUrl(source.url) : "",
      sourceUrl: source ? source.url : "",
    },
  });

  return {
    wordId,
    sentenceEn: example.sentenceEn,
    sentenceZh: example.sentenceZh,
    sourceName: example.sourceName,
    sourceUrl: example.sourceUrl,
  };
}
