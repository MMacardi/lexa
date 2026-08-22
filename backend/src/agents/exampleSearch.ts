import { prisma } from "../services/db.js";
import { searchNews } from "../services/search.js";
import { chatJson } from "../services/llm.js";
import { sentenceSelectionSchema, translationSchema, exampleSentenceSchema } from "../lib/schemas.js";
import { langName, scriptNote } from "../lib/langs.js";

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
    case "zh-Hant":
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
  dialogue: { query: "dialogue conversation spoken", register: "a short spoken dialogue (2-3 turns)" },
  literary: { query: "novel book literature", register: "literary (fiction or non-fiction prose)" },
};

// Applied to every example: forbids bare, context-free one-liners so the learner
// can always infer meaning from the situation.
const RICHNESS_RULE =
  `The example must give enough context to make the word's meaning clear on its own: ` +
  `a concrete, complete situation of at least about 8-14 words. ` +
  `NEVER output a bare, context-free line such as "It's small." or "Is it big or small?". `;

export async function runExampleSearch(params: {
  userId: string;
  word: string;
  sourceLang?: string;
  targetLang?: string;
  level?: string; // learner CEFR level, e.g. "B1"
  exampleStyle?: string; // news | casual | dialogue | literary
  // Where examples come from: "ai" (default) composes a fresh sentence with the
  // model — cheaper, always on-level, no third-party text; "web" mines a real
  // sentence from news/articles (attributed) for authenticity.
  exampleSource?: string; // ai | web
  // Existing example sentences to avoid duplicating (when adding another example).
  avoid?: string[];
  // When set, attach the example to this existing card (import enrichment).
  // When absent, create a new card (single-word add — duplicates allowed).
  wordId?: string;
}): Promise<ExampleSearchResult> {
  const word = params.word.trim().toLowerCase();
  const sourceLang = params.sourceLang ?? "en";
  const targetLang = params.targetLang ?? "zh";
  const sourceName = langName(sourceLang);
  const targetName = langName(targetLang);

  // "none" → create the card but generate NO example (no model call, no search).
  if (params.exampleStyle === "none") {
    const wordId =
      params.wordId ?? (await prisma.word.create({ data: { userId: params.userId, word, sourceLang, targetLang } })).id;
    return { wordId, sentenceEn: "", sentenceZh: "", sourceName: "", sourceUrl: "" };
  }

  const style = STYLE_HINTS[params.exampleStyle ?? "news"] ? (params.exampleStyle ?? "news") : "news";
  const styleInfo = STYLE_HINTS[style];

  const levelLine = params.level
    ? `The learner's CEFR level is ${params.level}. Choose a sentence a ${params.level} learner can actually understand: prefer common, high-frequency vocabulary and avoid rare, technical, archaic, or foreign loan-words beyond their level. If every candidate is too hard, pick the simplest and clearest one. `
    : "";
  // When the card already has examples, compose a fresh, DIFFERENT one instead of
  // searching (the web search returns the same top article/sentence every time).
  const avoidList = (params.avoid ?? []).map((s) => s.trim()).filter(Boolean);
  const avoidLine = avoidList.length
    ? `Write a DIFFERENT example from the ones the learner already has — a new situation and wording, not similar to any of these: ${avoidList
        .map((s) => `"${s}"`)
        .join("; ")}. `
    : "";

  // Default to AI-composed examples: cheaper, always on the learner's level, and
  // free of any third-party copyright question. Web mining is an explicit opt-in.
  const preferAi = (params.exampleSource ?? "ai") !== "web";

  let sentence = "";
  let composed = avoidList.length > 0 || preferAi; // AI mode / "add another" → compose fresh
  let source: { url: string } | null = null;

  if (avoidList.length === 0 && !preferAi) {
    // 1. External tool call — the part that makes this a real agent, not a chat loop.
    const articles = await searchNews(word, {
      restrictNews: style === "news" && sourceLang === "en",
      queryHint: sourceLang === "en" ? styleInfo.query || undefined : undefined,
    });
    if (articles.length === 0) {
      throw new Error(`No sources found containing "${word}"`);
    }

    // 2. LLM step 1: choose one natural sentence and which excerpt it came from.
    const numbered = articles.map((a, i) => `[${i}] ${a.content}`).join("\n\n");
    const selection = await chatJson({
      system:
        `You are a ${sourceName} language teacher creating one example sentence for a learner. ` +
        `Pick the best COMPLETE, natural sentence written in ${sourceName} from the numbered ` +
        `excerpts that uses the target word in meaningful context — a real sentence with a subject ` +
        `and a verb that shows what the word means. NEVER pick a title, headline, company or brand ` +
        `name, URL, menu/navigation label, or a bare fragment. The sentence MUST be written in ` +
        `${sourceName} and actually contain the target word. ` +
        `Prefer a ${styleInfo.register} tone. ` +
        RICHNESS_RULE +
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

    sentence = selection.sentence.trim();
    composed = selection.composed || selection.sourceIndex < 0 || selection.sourceIndex >= articles.length;
    // Safety net: if the picked sentence isn't even in the source language's script
    // (e.g. an English blurb for a Chinese word), compose a proper one.
    if (!composed && !matchesSourceScript(sentence, sourceLang)) composed = true;
    // Dialogue can't be lifted from a news excerpt — always compose an exchange.
    if (style === "dialogue") composed = true;
    source = composed ? null : articles[selection.sourceIndex];
  }

  if (composed) {
    const composedSystem =
      style === "dialogue"
        ? `Write a short, natural ${sourceName} DIALOGUE of 2-3 turns between two people that uses ` +
          `the word "${word}" naturally. Put EACH turn on its own line, prefixed with "— ". ` +
          `The exchange must make the meaning of "${word}" clear from the situation (not a bare ` +
          `question-and-answer). ` +
          avoidLine +
          (levelLine || "") +
          `It MUST be written in ${sourceName} and contain "${word}".` +
          scriptNote(sourceLang) +
          'Respond as JSON: {"sentence": string} where sentence is the whole dialogue with line breaks (\\n).'
        : `Write ONE natural, correct ${sourceName} sentence that uses the word "${word}" in clear, ` +
          `interesting everyday context. Prefer a ${styleInfo.register} tone. ` +
          RICHNESS_RULE +
          avoidLine +
          (levelLine || "") +
          `The sentence MUST be written in ${sourceName} and contain "${word}".` +
          scriptNote(sourceLang) +
          'Respond as JSON: {"sentence": string}.';
    const written = await chatJson({
      system: composedSystem,
      user: word,
      schema: exampleSentenceSchema,
    });
    sentence = written.sentence.trim();
    source = null;
  }

  // 3. LLM step 2: translate the chosen sentence to the target language.
  const translation = await chatJson({
    system:
      `Translate the ${sourceName} text into natural ${targetName}. Keep any line breaks ` +
      `(dialogue turns stay on separate lines).` +
      scriptNote(targetLang) +
      ` Respond as JSON: {"translation": string}.`,
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
      // A composed sentence has no web source — attribute it to the AI instead.
      sourceName: source ? sourceNameFromUrl(source.url) : "Lexa AI",
      sourceUrl: source ? source.url : "",
      // Record the register + level only for AI-composed examples (a web-mined
      // one carries its publication as the source, not a chosen register).
      register: source ? null : style,
      level: source ? null : params.level ?? null,
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
