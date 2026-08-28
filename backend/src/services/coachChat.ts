import { chatJsonConversation, type ChatMessage } from "./llm.js";
import { coachChatSchema, type CoachChatResult } from "../lib/schemas.js";
import { langName, scriptNote } from "../lib/langs.js";

/**
 * The casual "learn by chatting" coach. Unlike the drill, this is NOT a quiz: it's
 * a relaxed, genuinely fun conversation in the language the learner is studying.
 * The coach naturally slips a couple of the learner's own words into the talk, and
 * quietly rewards the learner for using them. Low pressure, high engagement — the
 * "immersion" counterpart to the structured drill.
 */
export async function coachChat(params: {
  messages: { role: "user" | "assistant"; content: string }[];
  words: { word: string; meaning: string }[];
  sourceLang?: string;
  targetLang?: string;
  level?: string;
  topic?: string; // steer the conversation toward this
  wrap?: boolean; // the learner is finishing — give a warm sign-off
  profileNote?: string; // "about this learner" memory, prepended to the prompt
}): Promise<CoachChatResult> {
  const source = langName(params.sourceLang ?? "en");
  const target = langName(params.targetLang ?? "zh");
  const level = params.level ? ` The learner's level is about ${params.level} (CEFR).` : "";
  const wordList = params.words
    .slice(0, 14)
    .map((w) => `- ${w.word}${w.meaning ? ` (${w.meaning})` : ""}`)
    .join("\n");

  const clipped = params.messages.slice(-16).map((m) => ({
    role: m.role,
    content: m.content.slice(0, 1500),
  })) as ChatMessage[];

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        (params.profileNote ?? "") +
        `You are a warm, funny, genuinely curious ${source} conversation partner — like a friend who ` +
        `happens to be a great language coach. The learner's own language is ${target}.` +
        level +
        `\n\nThis is a RELAXED CHAT, not a lesson or a quiz. The whole point is that it feels fun and ` +
        `natural, and the learner picks up words without it feeling like studying.\n\n` +
        `These are words the learner is currently studying — their "words in play":\n${wordList}\n\n` +
        `How to chat:\n` +
        `1) Talk like a real person: react to what they say, share a tiny opinion or a light joke, ask ONE ` +
        `engaging follow-up question. Keep it short — 1-3 sentences. Lead the conversation somewhere fun; ` +
        `never let it stall.\n` +
        `2) IMMERSION: write mostly in ${source}, pitched at the learner's level so it's easy to follow. ` +
        `Only drop in a short ${target} word/gloss if something would otherwise be confusing.\n` +
        `3) SEED naturally: when it fits, weave ONE (occasionally two) of the learner's words-in-play into ` +
        `your OWN reply, used correctly in context — so they meet the word alive, not drilled. Don't force ` +
        `it every turn and never list or "quiz" the words. List the words you used this way in "seeded".\n` +
        `4) REWARD: if the learner uses one of their words-in-play (roughly correctly — be generous), react ` +
        `with a quick, warm bit of delight ("nice — you slipped in «resilient»!") and list those words in ` +
        `"used". Only count a word in "used" when THEY actually used it in their latest message.\n` +
        `5) Keep it low-pressure: do NOT nitpick grammar. Only reformulate gently if a mistake blocks ` +
        `meaning, and even then keep the fun tone. Never grade, never say "correct/wrong".\n` +
        `6) Pull topics from what the learner cares about (their goal/interests above) and from wherever the ` +
        `conversation naturally goes.` +
        (params.topic ? ` The learner specifically wants to chat about: "${params.topic}". Lead there.` : "") +
        (params.wrap
          ? `\n\nThe learner is WRAPPING UP now. Give a short, warm sign-off: name a couple of the words they ` +
            `used well today, one encouraging line, and DO NOT ask a new question or start a new thread.`
          : "") +
        `\n\n"say" is your reply. "used" = the learner's words-in-play they just used well (may be empty). ` +
        `"seeded" = your words-in-play you wove into THIS reply (may be empty). Both must be exact words ` +
        `from the list above, verbatim.` +
        scriptNote(params.sourceLang ?? "en") +
        ` Respond as JSON: {"say": string, "used": string[], "seeded": string[]}.`,
    },
    ...clipped,
  ];

  const result = await chatJsonConversation({
    messages,
    schema: coachChatSchema,
    timeoutMs: 60000,
    label: "coachChat",
  });

  // Keep only words that are genuinely in the pool (models sometimes invent).
  const pool = new Set(params.words.map((w) => w.word.trim().toLowerCase()));
  const clean = (arr: string[]) =>
    [...new Set(arr.map((w) => w.trim()).filter((w) => pool.has(w.toLowerCase())))];

  return {
    say: result.say.trim(),
    used: clean(result.used ?? []),
    seeded: clean(result.seeded ?? []),
  };
}
