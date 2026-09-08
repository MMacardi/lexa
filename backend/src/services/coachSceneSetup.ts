import { chatJson } from "./llm.js";
import { coachSceneSetupSchema, type CoachSceneSetup } from "../lib/schemas.js";
import { langName, scriptNote } from "../lib/langs.js";

/**
 * Generate a scene premise: a short roleplay built from the learner's coach memory
 * (goal / interests / notes, passed in as `profileNote`) and their weak/due "mission
 * words". ONE structured call. The mission words are post-filtered against the input
 * pool so the model can never invent a word the learner isn't studying.
 *
 * Language contract: the fields the learner READS (title/setting/character/learnerRole/
 * goal/briefing) are written in the learner's own language (target); the character's
 * spoken `opening` line is in the SOURCE (studied) language.
 */
export async function coachSceneSetup(params: {
  words: { word: string; meaning: string }[];
  sourceLang?: string;
  targetLang?: string;
  level?: string;
  profileNote?: string;
  idea?: string;
  avoid?: string[]; // recent scene themes/settings to steer clear of (variety)
}): Promise<CoachSceneSetup> {
  const source = langName(params.sourceLang ?? "en");
  const target = langName(params.targetLang ?? "zh");
  const level = params.level
    ? ` The learner's level is about ${params.level} (CEFR) — pitch the situation and the language to it.`
    : "";
  const pool = params.words.slice(0, 12);
  const wordList = pool
    .map((w) => `- ${w.word}${w.meaning ? ` (${w.meaning})` : ""}`)
    .join("\n");
  const idea = params.idea?.trim();
  const avoid = (params.avoid ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 12);
  const avoidNote = avoid.length
    ? ` Do NOT reuse these recent scene themes/settings — pick something clearly different: ${avoid.join("; ")}.`
    : "";

  const result = await chatJson({
    system:
      (params.profileNote ?? "") +
      `You design short, engaging roleplay SCENES for a ${source} learner whose own language is ${target}.${level}\n\n` +
      `These are the learner's "mission words" — words they are weak on or due to review:\n${wordList}\n\n` +
      `Create ONE scene that:\n` +
      `1) Is a concrete, plausible situation` +
      (idea ? ` steered by what the learner asked for: "${idea}".` : ` drawn from their goal/interests above when known, so it feels personal.`) +
      ` It should be resolvable in about 6-10 short exchanges.\n` +
      `   VARIETY IS ESSENTIAL: do NOT default to the same everyday "ordering food / bakery / café / restaurant /\n` +
      `   shopping" scene. Reach for a genuinely different situation each time — e.g. asking a neighbour for help,\n` +
      `   a job or visa interview, calling about a delayed delivery, checking into a hotel, a doctor's appointment,\n` +
      `   making plans with a friend, a problem at work or school, asking for directions, returning a purchase,\n` +
      `   small talk at a gym or bus stop, resolving a mix-up, giving or asking for a recommendation.${avoidNote}\n` +
      `2) Casts a specific CHARACTER for you to play (a name + a role) and gives the learner a clear role and a\n` +
      `   concrete objective.\n` +
      `3) Can naturally be carried out using as many of the mission words as genuinely fit. Do NOT force all of\n` +
      `   them — pick the subset that belongs in this situation and return it as "missionWords" (verbatim from the\n` +
      `   list above, each with its meaning).\n` +
      `4) Introduces 1-2 genuinely useful NEW words the learner most likely does NOT know yet — words that arise\n` +
      `   naturally in THIS scene and suit their level. They must NOT appear in the mission-words list above. Return\n` +
      `   them as "newWords", each as {word (in ${source}), meaning (a short gloss in ${target})}.\n\n` +
      `Write "title", "setting", "character", "characterName", "learnerRole", "goal" and "briefing" in ${target}\n` +
      `(the learner's language) so the premise is instantly clear. "character" is a short description of who you play;\n` +
      `"characterName" is just that character's name. "briefing" is ONE short line on why this scene helps THIS learner\n` +
      `(tie it to their goal or a known weak point); use "" if nothing is known yet.\n` +
      `Write "opening" — the character's FIRST spoken line — in ${source}, at the learner's level, in character, and end\n` +
      `it with something that invites a reply and creates a natural slot for a mission word.\n` +
      scriptNote(params.sourceLang ?? "en") +
      ` Respond as JSON: {"title": string, "setting": string, "character": string, "characterName": string, ` +
      `"learnerRole": string, "goal": string, "briefing": string, ` +
      `"missionWords": [{"word": string, "meaning": string}], ` +
      `"newWords": [{"word": string, "meaning": string}], "opening": string}.`,
    user: `Mission words available:\n${wordList}`,
    schema: coachSceneSetupSchema,
    label: "coachSceneSetup",
    timeoutMs: 45000,
  });

  // Post-filter: keep only mission words genuinely in the pool (models sometimes invent),
  // and prefer the pool's stored meaning so the chip/translation stays consistent.
  const allowed = new Map(pool.map((w) => [w.word.trim().toLowerCase(), w.meaning]));
  const filtered = (result.missionWords ?? [])
    .map((m) => m.word.trim())
    .filter((w) => w && allowed.has(w.toLowerCase()))
    .map((w) => ({ word: w, meaning: allowed.get(w.toLowerCase()) ?? "" }));
  // Safety: if filtering emptied the list, fall back to the input pool. Cap at 8.
  const missionWords = (filtered.length ? filtered : pool.map((w) => ({ word: w.word, meaning: w.meaning }))).slice(0, 8);

  // New words must be genuinely new: not in the learner's pool and not a mission word.
  const missionSet = new Set(missionWords.map((w) => w.word.trim().toLowerCase()));
  const seenNew = new Set<string>();
  const newWords = (result.newWords ?? [])
    .map((n) => ({ word: (n.word ?? "").trim(), meaning: (n.meaning ?? "").trim() }))
    .filter((n) => {
      const k = n.word.toLowerCase();
      if (!n.word || allowed.has(k) || missionSet.has(k) || seenNew.has(k)) return false;
      seenNew.add(k);
      return true;
    })
    .slice(0, 2);

  return {
    title: (result.title ?? "").trim(),
    setting: (result.setting ?? "").trim(),
    character: (result.character ?? "").trim(),
    characterName: (result.characterName ?? "").trim() || (result.character ?? "").trim(),
    learnerRole: (result.learnerRole ?? "").trim(),
    goal: (result.goal ?? "").trim(),
    briefing: (result.briefing ?? "").trim(),
    missionWords,
    newWords,
    opening: (result.opening ?? "").trim(),
  };
}
