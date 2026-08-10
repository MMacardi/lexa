import { chatJsonConversation, type ChatMessage } from "./llm.js";
import { tutorChatSchema, type TutorChatResult } from "../lib/schemas.js";
import { langName, scriptNote } from "../lib/langs.js";

/**
 * Global AI tutor chat — not tied to a specific card. Helps the learner with the
 * language they're studying and can propose vocabulary to save (addWords), which
 * the client turns into one-tap "create cards" actions.
 */
export async function tutorChat(params: {
  messages: { role: "user" | "assistant"; content: string }[];
  sourceLang?: string;
  targetLang?: string;
}): Promise<TutorChatResult> {
  const source = langName(params.sourceLang ?? "en");
  const target = langName(params.targetLang ?? "zh");
  const clipped = params.messages.slice(-12).map((m) => ({
    role: m.role,
    content: m.content.slice(0, 2000),
  })) as ChatMessage[];

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        `You are a friendly, encouraging ${source} tutor for a learner whose language is ${target}. ` +
        `Answer in the "answer" field ENTIRELY in ${target}, concise and practical. Help them learn ` +
        `${source}: meanings, usage, grammar, example sentences, and picking vocabulary. ` +
        `Stay focused on ${source} language learning; politely decline unrelated general-knowledge questions.\n\n` +
        `ACTIONS — you can add words to the learner's deck: whenever they ask to save/add words, OR ask ` +
        `you to suggest words on a topic/level to study, put those ${source} words (single words or short ` +
        `phrases, real ${source}, deduplicated) in "addWords" so they can be added with one tap. If no ` +
        `words are being added, use an empty array.` +
        scriptNote(params.sourceLang ?? "en") +
        ` (This applies to example sentences, vocabulary, and every ${source} word you write.) ` +
        'Respond as JSON: {"answer": string, "addWords": string[]}.',
    },
    ...clipped,
  ];

  const result = await chatJsonConversation({ messages, schema: tutorChatSchema, timeoutMs: 60000 });
  return {
    answer: result.answer.trim(),
    addWords: (result.addWords ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 30),
  };
}
