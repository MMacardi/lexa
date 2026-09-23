import { chatJson } from "../services/llm.js";
import { enrichEntrySchema } from "../lib/schemas.js";
import { langName, scriptNote } from "../lib/langs.js";
import { localPhonetic } from "../lib/transcribe.js";
import { cedictInventory, isChinese } from "../services/cedict.js";

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
// One sense, not the word's whole range: the word page lists the others for the
// learner to add. But one sense written out the way that list writes it — a bare
// "goal" or "to save" is a translation, not a meaning. Also used by the tutor and
// the importer, so a card reads the same whichever way it was made.
export const DEFAULT_MEANING_INSTRUCTION =
  "the word's MOST COMMON sense only (the one a learner's dictionary lists first), written the way a learner's dictionary glosses it. " +
  'Give the main equivalent plus 1-2 near-synonyms that pin the sense down, separated by ", " (目标 → "goal, objective, target", never just "goal"). ' +
  "Then, for a verb, an adjective, an abstract noun or anything a bare translation leaves vague, add in parentheses what it typically applies to — " +
  '1-3 typical objects or contexts, not a definition (救 → "to save, to rescue (a person, a life)"; 打开 → "открыть, раскрыть (дверь, книгу)"; 认真 → "serious, conscientious (about work, study)"). ' +
  "Only a concrete thing with one plain equivalent, a pronoun, a name or a number gets just that word, without a category label " +
  '(table → "стол", not "стол (мебель)"; she → "她"; a country → its name). ' +
  "Do NOT list the word's other senses and do NOT write a full dictionary-style definition.";

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
  sense?: string; // target-language word the learner typed to reach this one (add-by-translation)
  context?: string; // the sentence the learner met the word in (Reader): the meaning is that sentence's sense
  knownWords?: string[]; // the learner's own words: the example is built from these
  ground?: boolean; // default true; scripts/eval-senses.ts turns it off for its control arm
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

  // Add-by-translation: they typed e.g. "включить" and got 打开, so the card must
  // show THAT sense first — not just the word's default one ("открывать").
  const sense = params.sense?.trim();
  const senseLine = sense
    ? `The learner reached this word by translating the ${targetName} word "${sense}" — that is the sense they want. ` +
      `"meaningZh" MUST start with "${sense}" (in dictionary form), then (unlike a normal card) add the word's other main sense(s) if it has any, ` +
      `separated by "; " (e.g. "turn on; open"). The first collocation should use that sense too. `
    : "";

  const inSense = sense ? ` in the sense "${sense}" (the translation must say "${sense}" or a form of it)` : "";

  // Captured from a text: the card is for the sense the word has THERE, which is
  // the one thing a dictionary lookup can't tell. A typed sense still wins.
  const context = sense ? "" : params.context?.trim().slice(0, 300) ?? "";
  const contextLine = context
    ? `The learner met this word in the sentence "${context}". "meaningZh" MUST give the sense "${word}" has in that sentence, ` +
      `even when it is not the word's most common one. `
    : "";

  // An example made of words the learner already has is one they can read
  // without looking anything else up — the new word is the only unknown in it.
  const known = (params.knownWords ?? []).map((w) => w.trim()).filter((w) => w && w !== word).slice(0, 40);
  const knownLine = known.length
    ? `Build the example mostly from words the learner already knows: ${known.join(", ")}. ` +
      `Any other word in it must be simpler and more common than "${word}". `
    : "";

  // Chinese headwords are grounded in CC-CEDICT: the dictionary states which
  // senses exist and the model picks one of them. This is the add-by-translation
  // bug's home — «включить» returned 打开 glossed only as "открыть", while the
  // dictionary lists "to turn on" as sense 3. See services/cedict.ts.
  const inventory = params.ground !== false && isChinese(sourceLang) ? cedictInventory(word) : null;
  const groundingLine = inventory
    ? `The senses of this ${sourceName} word are fixed by CC-CEDICT, a ${sourceName}–English dictionary:\n${inventory}\n` +
      `"meaningZh" MUST render one of those senses (or, where they overlap, a group of them) into ${targetName}. ` +
      `Never gloss the word with a sense that is not in that list, however plausible it sounds. ` +
      // The inventory is in English, and a gloss that half-copies it comes out as
      // "бог, божество, deity" — the dictionary decides WHICH sense, never the words.
      `That list is in English only because CC-CEDICT is a ${sourceName}–English dictionary. It fixes WHICH sense you may use, never the wording: ` +
      `translate the sense into ${targetName} as a ${targetName} learner's dictionary would, following the instruction above, ` +
      (targetLang === "en" ? "" : `and never leave an English word in the gloss. `) +
      (sense
        ? `Pick the listed sense that "${sense}" corresponds to; if none of them does, use the first listed sense instead of inventing one. `
        : context
          ? `Pick the listed sense the word has in the learner's sentence. `
          : `Pick the first listed sense that is not a classifier, a surname or a cross-reference. `) +
      `"collocations" must use the word in the sense you picked. `
    : "";

  const examplePart = !params.withExample
    ? `Leave "example" and "exampleTranslation" as empty strings "". `
    : style === "dialogue"
      ? `"example": a short natural ${sourceName} DIALOGUE of 2-3 turns using "${word}"${inSense}, EACH turn on its own ` +
        `line prefixed with "— ", making the word's meaning clear from the situation; ` +
        `"exampleTranslation": that dialogue translated to ${targetName} (keep the line breaks). ` +
        avoidLine +
        levelLine +
        knownLine
      : `"example": ONE natural, correct ${sourceName} sentence (about 8-14 words, a ${register} tone) that ` +
        `uses "${word}"${inSense} in a concrete context so its meaning is clear on its own — never a bare "It's small."; ` +
        `"exampleTranslation": that sentence translated to ${targetName}. ` +
        avoidLine +
        levelLine +
        knownLine;

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
      groundingLine +
      senseLine +
      contextLine +
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
