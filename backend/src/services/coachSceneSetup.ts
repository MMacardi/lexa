import { chatJson } from "./llm.js";
import { coachSceneSetupSchema, type CoachSceneSetup } from "../lib/schemas.js";
import { langName, scriptNote } from "../lib/langs.js";
import { levelGuide } from "./levelGuide.js";

/**
 * Generate a scene premise: a short roleplay built from the learner's coach memory
 * (goal / interests / notes, passed in as `profileNote`) and a CANDIDATE pool of the
 * words they are reviewing. ONE structured call. The model keeps only the candidates
 * that plausibly belong in the situation it designed — possibly none — and the result
 * is post-filtered against the input pool so it can never invent a word the learner
 * isn't studying.
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
  const level = `\n\n${levelGuide(params.level, source)}`;
  const pool = params.words.slice(0, 24);
  const wordList = pool.length
    ? pool.map((w) => `- ${w.word}${w.meaning ? ` (${w.meaning})` : ""}`).join("\n")
    : "(none — the learner has no cards yet, so build the scene entirely around new words)";
  const idea = params.idea?.trim();
  const avoid = (params.avoid ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 12);
  const avoidNote = avoid.length
    ? ` Do NOT reuse these recent scene themes/settings — pick something clearly different: ${avoid.join("; ")}.`
    : "";

  const result = await chatJson({
    system:
      (params.profileNote ?? "") +
      `You design short, engaging roleplay SCENES for a ${source} learner whose own language is ${target}.${level}\n\n` +
      `These are words the learner happens to be reviewing — a CANDIDATE pool, not a checklist:\n${wordList}\n\n` +
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
      `3) Uses ONLY the candidate words that plausibly belong in THIS situation. Return that subset as\n` +
      `   "missionWords" (verbatim from the list above, each with its meaning). A few is normal; an EMPTY array is\n` +
      `   a perfectly good answer when nothing fits — shoehorning an unrelated word into the scene (a bakery chat\n` +
      `   that must use "camouflage") is exactly the failure to avoid. Never bend the situation to fit a word.\n` +
      `4) Introduces 1-2 genuinely useful NEW words the learner most likely does NOT know yet — words that arise\n` +
      `   naturally in THIS scene and sit at or just above their LEVEL block. They must NOT appear in the candidate\n` +
      `   list above. Return them as "newWords", each as {word (in ${source}), meaning (a short gloss in ${target})}.\n\n` +
      `Write "title", "setting", "character", "characterName", "learnerRole", "goal" and "briefing" in ${target}\n` +
      `(the learner's language) so the premise is instantly clear. "character" is a short description of who you play;\n` +
      `"characterName" is just that character's name. "briefing" is ONE short line on why this scene helps THIS learner\n` +
      `(tie it to their goal or a known weak point); use "" if nothing is known yet.\n` +
      `Write "opening" — the character's FIRST spoken line — in ${source}, obeying the LEVEL block above, in character,\n` +
      `and end it with something that invites a reply (and, when there ARE mission words, creates a natural slot for one).\n` +
      scriptNote(params.sourceLang ?? "en") +
      ` Respond as JSON: {"title": string, "setting": string, "character": string, "characterName": string, ` +
      `"learnerRole": string, "goal": string, "briefing": string, ` +
      `"missionWords": [{"word": string, "meaning": string}], ` +
      `"newWords": [{"word": string, "meaning": string}], "opening": string}.`,
    user: `Candidate words:\n${wordList}`,
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
  // No fallback: an empty list means nothing in the pool fit the scene, which is the
  // correct answer. Backfilling the whole pool here is what used to drag unrelated
  // words into the dialogue. Cap at 8.
  const missionWords = filtered.slice(0, 8);

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
