import { chatJson } from "../services/llm.js";
import { enrichEntrySchema } from "../lib/schemas.js";
import { langName, scriptNote } from "../lib/langs.js";
import { localPhonetic } from "../lib/transcribe.js";

// Combined enrichment agent: ONE model call returns the full dictionary entry
// (phonetic, part of speech, meaning, collocations, synonyms, antonyms) AND a
// composed example with its translation. Replaces the old two-agent pair
// (Example Search compose + translate, then Tutor) for AI-composed examples,
// cutting a card from ~3 model calls to 1. Web-mined examples still use the
// separate Example Search agent (the sentence comes from a real search).

const REGISTER: Record<string, string> = {
  news: "news / journalistic",
  casual: "everyday, casual real-life",
  dialogue: "a short spoken dialogue (2-3 turns)",
  literary: "literary prose",
};

// The default guidance for the meaning; the learner can override it (see the
// per-user "meaning style" preference) to get richer or more specialised entries.
export const DEFAULT_MEANING_INSTRUCTION =
  "a CONCISE translation — the direct equivalent, usually 1-4 words (a pronoun → just the pronoun, a country → its name). Add a short parenthetical clarifier ONLY when the word is ambiguous. Do NOT write a long dictionary-style definition.";

export interface EnrichResult {
  phonetic: string;
  partOfSpeech: string;
  meaningZh: string;
  collocations: string[];
  synonyms: string[];
  antonyms: string[];
  example: string;
  exampleTranslation: string;
}

export async function enrichWordEntry(params: {
  word: string;
  sourceLang?: string;
  targetLang?: string;
  level?: string;
  synonymLevel?: string; // tune synonyms to a target CEFR level (exam prep); "" = natural
  exampleStyle?: string; // news | casual | dialogue | literary (ignored when withExample=false)
  withExample: boolean;
  meaningInstruction?: string; // learner override; falls back to the concise default
  avoid?: string[]; // existing examples to differ from (for "add another")
}): Promise<EnrichResult> {
  const word = params.word.trim();
  const sourceLang = params.sourceLang ?? "en";
  const targetLang = params.targetLang ?? "zh";
  const sourceName = langName(sourceLang);
  const targetName = langName(targetLang);
  const style = params.exampleStyle && REGISTER[params.exampleStyle] ? params.exampleStyle : "casual";
  const register = REGISTER[style];
  const meaningInstruction = params.meaningInstruction?.trim() || DEFAULT_MEANING_INSTRUCTION;
  const levelLine = params.level
    ? `The learner's CEFR level is ${params.level}; keep the example's vocabulary and grammar at that level. `
    : "";
  // Optional: aim synonyms at a target CEFR level (e.g. for IELTS prep the learner
  // wants richer, higher-level alternatives rather than the plainest words).
  const synClause = params.synonymLevel
    ? `synonyms (up to 3 genuine ${sourceName} synonyms, chosen at roughly CEFR ${params.synonymLevel} — ` +
      `richer, more advanced alternatives suitable for exam prep like IELTS, but still TRUE synonyms of the word)`
    : `synonyms (up to 3 genuine ${sourceName} synonyms)`;
  const avoid = (params.avoid ?? []).map((s) => s.trim()).filter(Boolean);
  const avoidLine = avoid.length
    ? `The example MUST be different from these existing ones: ${avoid.map((s) => `"${s}"`).join("; ")}. `
    : "";

  const examplePart = !params.withExample
    ? `Leave "example" and "exampleTranslation" as empty strings "". `
    : style === "dialogue"
      ? `"example": a short natural ${sourceName} DIALOGUE of 2-3 turns using "${word}", EACH turn on its own ` +
        `line prefixed with "— ", making the word's meaning clear from the situation; ` +
        `"exampleTranslation": that dialogue translated to ${targetName} (keep the line breaks). ` +
        avoidLine +
        levelLine
      : `"example": ONE natural, correct ${sourceName} sentence (about 8-14 words, a ${register} tone) that ` +
        `uses "${word}" in a concrete context so its meaning is clear on its own — never a bare "It's small."; ` +
        `"exampleTranslation": that sentence translated to ${targetName}. ` +
        avoidLine +
        levelLine;

  const result = await chatJson({
    system:
      `You are a ${sourceName}-to-${targetName} dictionary. For the given ${sourceName} word, respond as JSON ` +
      `with: phonetic (pronunciation), partOfSpeech, meaningZh, collocations (2-3 common ${sourceName} phrases), ` +
      `${synClause}, antonyms (up to 3 genuine ${sourceName} antonyms), ` +
      `example, exampleTranslation. ` +
      `CRITICAL: "meaningZh" is only a field NAME — its value MUST be written in ${targetName}, NOT in ${sourceName} ` +
      `(even though the word itself is ${sourceName}). For "meaningZh" give ${meaningInstruction} ` +
      `synonyms and antonyms MUST be written in ${sourceName} — the SAME language as the word — never in ${targetName}. ` +
      `Only include TRUE synonyms/antonyms; many words have none, in which case return an empty array rather than ` +
      `inventing loose ones. ` +
      examplePart +
      scriptNote(sourceLang) +
      scriptNote(targetLang) +
      'Shape: {"phonetic":string,"partOfSpeech":string,"meaningZh":string,"collocations":string[],' +
      '"synonyms":string[],"antonyms":string[],"example":string,"exampleTranslation":string}.',
    user: word,
    schema: enrichEntrySchema,
    label: params.withExample ? "enrich(+example)" : "enrich",
  });

  // Chinese/Korean: deterministic local pinyin/romanization beats the model's IPA.
  const localPh = await localPhonetic(word, sourceLang);
  return {
    phonetic: localPh ?? result.phonetic ?? "",
    partOfSpeech: result.partOfSpeech ?? "",
    meaningZh: result.meaningZh ?? "",
    collocations: result.collocations ?? [],
    synonyms: result.synonyms ?? [],
    antonyms: result.antonyms ?? [],
    example: (result.example ?? "").trim(),
    exampleTranslation: (result.exampleTranslation ?? "").trim(),
  };
}
