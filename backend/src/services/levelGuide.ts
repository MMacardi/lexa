// A hard, prescriptive difficulty contract for the Coach. The old one-line
// "the learner's level is about A1" was consistently ignored — the model still wrote
// long, idiomatic replies to a beginner. This spells out sentence length, vocabulary
// budget and what to do with a word above the level, so every coach prompt constrains
// difficulty the same way.

const RULES: Record<string, string> = {
  A1: `A1 (complete beginner): ONE very short sentence per reply, at most ~10 words. Only the most common, ` +
    `everyday words — greetings, food, family, numbers, basic verbs. Present tense only. NO idioms, NO ` +
    `synonyms, NO literary or formal vocabulary, NO subordinate clauses. Repeat the key word rather than ` +
    `varying it.`,
  A2: `A2 (elementary): 1-2 short sentences per reply, ~15 words total. Everyday vocabulary and simple ` +
    `connectors ("and", "but", "because"). No idioms, no abstract or formal register.`,
  B1: `B1 (intermediate): 2-3 sentences per reply, ~30 words. Everyday plus common topic vocabulary; simple ` +
    `idioms allowed only if obvious from context. At most ONE word they may not know, and make its ` +
    `meaning obvious from context.`,
  B2: `B2 (upper-intermediate): 2-4 natural sentences. Ordinary native vocabulary and idioms in moderation; ` +
    `still avoid rare, literary or highly specialised words.`,
  C1: `C1 (advanced): natural, fluent, nuanced — idioms and register shifts are fine.`,
  C2: `C2 (proficient): fully natural, including subtlety, humour and uncommon vocabulary.`,
};

/**
 * The difficulty block to splice into a coach system prompt. `source` is the language
 * being practised, named so the rule can't be misread as applying to the learner's own
 * language. Never returns "" — an undeclared level still gets a conservative A2 cap,
 * which is what made difficulty feel random before.
 */
export function levelGuide(level?: string, source = "the language being practised"): string {
  const key = (level ?? "").trim().toUpperCase();
  const rule = RULES[key];
  const head = rule
    ? `LEVEL — a HARD constraint, not a hint. The learner is at CEFR ${key} in ${source}.\n${rule}`
    : `LEVEL — a HARD constraint, not a hint. The learner has not declared a level, so assume A2 in ${source}: ` +
      `1-2 short sentences, everyday vocabulary, no idioms.`;
  return (
    `${head}\n` +
    `Applies to everything you write in ${source} AND to everything you ask the learner to produce in it.\n` +
    `Never use a ${source} word above this level unless it is the ONE new word you are deliberately teaching ` +
    `this turn — and then make its meaning obvious from how you use it. NEVER insert a translation or gloss in ` +
    `the learner's own language inside ${source} prose (no parentheticals like «word (its translation)»): the app ` +
    `shows the meaning when the learner taps the word.\n` +
    `When two words would both work, take the simpler one. Short and clear always beats rich and impressive.`
  );
}
