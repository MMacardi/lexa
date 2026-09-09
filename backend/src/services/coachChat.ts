import { chatJsonConversation, type ChatMessage } from "./llm.js";
import { coachChatSchema, type CoachChatResult } from "../lib/schemas.js";
import { langName, scriptNote } from "../lib/langs.js";
import { levelGuide } from "./levelGuide.js";

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
  const level = `\n\n${levelGuide(params.level, source)}`;
  const pool = params.words.slice(0, 24);
  const wordList = pool.length
    ? pool.map((w) => `- ${w.word}${w.meaning ? ` (${w.meaning})` : ""}`).join("\n")
    : "(none yet — the learner has no cards, so just talk and teach new words)";

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
        `These are words the learner happens to be reviewing — CANDIDATES, not a checklist:\n${wordList}\n\n` +
        `How to chat:\n` +
        `1) Talk like a real person: react to what they say, share a tiny opinion or a light joke, ask ONE ` +
        `engaging follow-up question. Length and vocabulary come from the LEVEL block above — obey it exactly. ` +
        `Lead the conversation somewhere fun; never let it stall.\n` +
        `2) IMMERSION: write mostly in ${source}. ` +
        `Never drop ${target} words or glosses into it — no parenthetical translations: the learner taps any ` +
        `highlighted word to see its meaning. Make an unclear word obvious from context instead.\n` +
        `3) SEED naturally: when one of the candidates genuinely fits what you are talking about RIGHT NOW, ` +
        `weave ONE (occasionally two) into your OWN reply, used correctly in context — so they meet the word ` +
        `alive, not drilled. If none of them fit this turn, use NONE: an unrelated word shoehorned into the ` +
        `chat is worse than no word at all. Never list or quiz them. List whatever you seeded in "seeded".\n` +
        `4) REWARD: if the learner uses one of the candidates (roughly correctly — be generous), react ` +
        `with a quick, warm bit of delight ("nice — you slipped in «resilient»!") and list those words in ` +
        `"used". Only count a word in "used" when THEY actually used it in their latest message.\n` +
        `5) Keep it low-pressure: do NOT nitpick grammar. Only reformulate gently if a mistake blocks ` +
        `meaning, and even then keep the fun tone. Never grade, never say "correct/wrong".\n` +
        `6) Pull topics from what the learner cares about (their goal/interests above) and from wherever the ` +
        `conversation naturally goes.` +
        (params.topic ? ` The learner specifically wants to chat about: "${params.topic}". Lead there.` : "") +
        `\n7) TEACH BY STEALTH: once in a while (NOT every turn, at most one per reply) introduce ONE brand-new ` +
        `word the learner most likely does NOT know yet — natural to the topic, at most one notch above their ` +
        `LEVEL block, and NOT from the candidate list above. Use it correctly in your reply, make its meaning ` +
        `clear from context the first time (never append a ${target} translation), and report it in "newWords" ` +
        `as {word (in ${source}), meaning (a short gloss in ` +
        `${target})}. Never quiz or list it.` +
        (params.wrap
          ? `\n\nThe learner is WRAPPING UP now. Give a short, warm sign-off: name a couple of the words they ` +
            `used well today, one encouraging line, and DO NOT ask a new question or start a new thread.`
          : "") +
        `\n\n"say" is your reply. "used" = the candidates the learner just used well (may be empty). ` +
        `"seeded" = the candidates you wove into THIS reply (may be empty). Both must be exact words ` +
        `from the list above, verbatim. "newWords" = brand-new words you introduced this reply (usually empty).` +
        scriptNote(params.sourceLang ?? "en") +
        ` Respond as JSON: {"say": string, "used": string[], "seeded": string[], ` +
        `"newWords": [{"word": string, "meaning": string}]}.`,
    },
    ...clipped,
  ];

  const result = await chatJsonConversation({
    messages,
    schema: coachChatSchema,
    timeoutMs: 60000,
    label: "coachChat",
  });

  // Keep only words that are genuinely in the candidate list (models sometimes invent).
  const poolSet = new Set(pool.map((w) => w.word.trim().toLowerCase()));
  const clean = (arr: string[]) =>
    [...new Set(arr.map((w) => w.trim()).filter((w) => poolSet.has(w.toLowerCase())))];

  // New words must NOT already be in the learner's pool.
  const seenNew = new Set<string>();
  const newWords = (result.newWords ?? [])
    .map((n) => ({ word: (n.word ?? "").trim(), meaning: (n.meaning ?? "").trim() }))
    .filter((n) => {
      const k = n.word.toLowerCase();
      if (!n.word || poolSet.has(k) || seenNew.has(k)) return false;
      seenNew.add(k);
      return true;
    })
    .slice(0, 2);

  return {
    say: result.say.trim(),
    used: clean(result.used ?? []),
    seeded: clean(result.seeded ?? []),
    newWords,
  };
}
