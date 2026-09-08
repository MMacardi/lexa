import { chatJsonConversation, type ChatMessage } from "./llm.js";
import { coachSceneTurnSchema, type CoachSceneTurn } from "../lib/schemas.js";
import { langName, scriptNote } from "../lib/langs.js";

// The scene "bible", echoed by the client every turn so the engine is stateless and
// never drifts out of character (chatJsonConversation only sees the clipped history).
export interface SceneBible {
  title?: string;
  setting?: string;
  character?: string;
  characterName?: string;
  learnerRole?: string;
  goal?: string;
  missionWords: { word: string; meaning: string }[];
}

/**
 * Run ONE turn of a scene roleplay. The AI plays a character, keeps the conversation in
 * the source language, reacts IN-ROLE when the learner drifts (relevance without a clunky
 * "wrong" grade — the bug we are replacing), gently recasts mistakes, and reports which
 * mission words the learner used plus any corrections for the end-of-session report card.
 * `used` is post-filtered against the mission pool so an invented word can never trigger a
 * bogus SRS grade on the client.
 */
export async function coachSceneTurn(params: {
  messages: { role: "user" | "assistant"; content: string }[];
  scene: SceneBible;
  sourceLang?: string;
  targetLang?: string;
  level?: string;
  profileNote?: string;
  wrap?: boolean;
}): Promise<CoachSceneTurn> {
  const source = langName(params.sourceLang ?? "en");
  const target = langName(params.targetLang ?? "zh");
  const level = params.level ? ` The learner's level is about ${params.level} (CEFR).` : "";
  const missionList = (params.scene.missionWords ?? [])
    .map((w) => `- ${w.word}${w.meaning ? ` (${w.meaning})` : ""}`)
    .join("\n");

  const bible =
    `SCENE — stay inside it every turn:\n` +
    `- Title: ${params.scene.title || "—"}\n` +
    `- Setting: ${params.scene.setting || "—"}\n` +
    `- You play: ${params.scene.character || params.scene.characterName || "a character"}\n` +
    `- The learner plays: ${params.scene.learnerRole || "themselves"}\n` +
    `- The learner's objective: ${params.scene.goal || "—"}\n` +
    `- Mission words the learner is practising:\n${missionList || "(none)"}`;

  const clipped = params.messages.slice(-16).map((m) => ({
    role: m.role,
    content: m.content.slice(0, 1500),
  })) as ChatMessage[];

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        (params.profileNote ?? "") +
        `You are ${params.scene.characterName || "a character"} in a language-practice roleplay. You are a warm, ` +
        `natural conversation partner — NOT a teacher reading a script and NOT a quiz. The learner is practising ` +
        `${source}; their own language is ${target}.${level}\n\n` +
        bible + `\n\n` +
        `How to play your turn:\n` +
        `1) STAY IN CHARACTER and keep the scene moving. Write "say" mostly in ${source}, pitched to the learner's ` +
        `level, short (1-3 sentences), and end with something that invites their reply. Add a brief ${target} gloss ` +
        `only if something would genuinely confuse.\n` +
        `2) RELEVANCE WITHOUT GRADING: if the learner drifts off the scene or ignores what your character just asked, ` +
        `react IN CHARACTER and steer back naturally (a barista pulls the talk back to the order). NEVER say ` +
        `"correct"/"wrong" and never break character to grade.\n` +
        `3) GENTLE RECAST: if a mistake blocks meaning or is clearly worth fixing, weave the corrected form naturally ` +
        `into your "say" (model it, don't lecture). ALSO record it in "corrections" as {original (what they wrote), ` +
        `corrected (the fixed form in ${source}), note (a tiny "why" in ${target}, may be "")}. These are collected for ` +
        `an end-of-session report and are NOT shown to the learner now. Capture at most 4, only genuine ones; leave the ` +
        `array empty if their message was fine.\n` +
        `4) MISSION WORDS: create natural openings for the mission words, but never quiz, list or translate them on ` +
        `demand. If the learner uses a mission word correctly in THIS message (any inflected form counts), put its ` +
        `canonical form — verbatim from the mission list — into "used". Be generous, but ONLY list real mission words ` +
        `they actually used; never invent.\n` +
        `5) ENDING: set "sceneDone" to true once the objective is resolved or the scene reaches a natural end (or the ` +
        `learner says goodbye / asks to stop). On that turn, "say" a short, warm in-character closing line and do not ` +
        `ask a new question.\n` +
        (params.wrap
          ? `\nThe learner is ending the session right now: give a brief, warm in-character sign-off (no new question) ` +
            `and set "sceneDone" to true.\n`
          : "") +
        scriptNote(params.sourceLang ?? "en") +
        ` Respond as JSON: {"say": string, "used": string[], ` +
        `"corrections": [{"original": string, "corrected": string, "note": string}], "sceneDone": boolean}.`,
    },
    ...clipped,
  ];

  const result = await chatJsonConversation({
    messages,
    schema: coachSceneTurnSchema,
    timeoutMs: 60000,
    label: "coachSceneTurn",
  });

  // Post-filter "used" to genuine mission words; keep corrections that actually have a fix.
  const pool = new Set((params.scene.missionWords ?? []).map((w) => w.word.trim().toLowerCase()));
  const used = [
    ...new Set((result.used ?? []).map((w) => w.trim()).filter((w) => pool.has(w.toLowerCase()))),
  ];
  const corrections = (result.corrections ?? [])
    .map((c) => ({
      original: (c.original ?? "").trim(),
      corrected: (c.corrected ?? "").trim(),
      note: (c.note ?? "").trim(),
    }))
    .filter((c) => c.corrected)
    .slice(0, 4);

  return {
    say: result.say.trim(),
    used,
    corrections,
    sceneDone: result.sceneDone ?? false,
  };
}
