import { chatJsonConversation, type ChatMessage } from "./llm.js";
import { coachDrillSchema, type CoachDrillResult } from "../lib/schemas.js";
import { langName, scriptNote } from "../lib/langs.js";

/**
 * The adaptive Coach "practice" drill. Unlike the free-form tutor chat, this runs
 * a focused spoken/typed workout over a SPECIFIC set of the learner's words: the
 * coach asks the learner to USE each word, grades the answer, corrects, adapts the
 * difficulty, and moves on. The per-word grade is returned so the client can feed
 * it back into the SRS. This is the differentiator vs a plain flashcard app.
 */
export async function coachDrill(params: {
  messages: { role: "user" | "assistant"; content: string }[];
  words: { word: string; meaning: string }[];
  sourceLang?: string;
  targetLang?: string;
  level?: string;
  profileNote?: string; // "about this learner" memory, prepended to the prompt
}): Promise<CoachDrillResult> {
  const source = langName(params.sourceLang ?? "en");
  const target = langName(params.targetLang ?? "zh");
  const level = params.level ? ` The learner's level is about ${params.level} (CEFR).` : "";
  const wordList = params.words
    .slice(0, 12)
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
        `You are an adaptive, warm ${source} practice coach. The learner's own language is ${target}.` +
        level +
        `\n\nYour job: run a short, lively workout over EXACTLY these words the learner is studying:\n` +
        `${wordList}\n\n` +
        `How the session goes:\n` +
        `1) Work through the list STRICTLY IN THE GIVEN ORDER, top to bottom, ONE word per turn. Do NOT ` +
        `skip a word, jump ahead, or reorder — the next word is always the one right after the last you ` +
        `covered. Only skip a word if the learner explicitly asks to skip it.\n` +
        `2) Your VERY FIRST message must already contain the first task — a short friendly clause AND the ` +
        `FIRST word of the list with a concrete request. NAME the word explicitly and ask the learner to DO ` +
        `something with it. NEVER send a vague opener like "let's start with the first word" without naming ` +
        `it. Example shape: "Привет! Начнём со слова «resilient» — составь с ним короткое предложение."\n` +
        `3) Drill by asking the learner to USE the word — compose a natural ${source} sentence with it, ` +
        `answer a small question using it, or translate a short phrase. Vary the task.\n` +
        `4) CONSISTENCY IS CRITICAL: "drillWord" MUST be the exact word your "say" is asking about in THIS ` +
        `message — they can never disagree. If your "say" moves on to the next word, "drillWord" is that ` +
        `next word. Never name one word in the text while setting a different "drillWord".\n` +
        `5) When the learner replies, GRADE their previous answer: set "grade" to "correct", "partial" or ` +
        `"wrong", and "gradedWord" to THAT word (the one they just attempted). Give brief, specific ` +
        `feedback in "say" — praise what was right, fix mistakes, show the corrected ${source} form when ` +
        `needed. Then move to the NEXT word in the list (set "drillWord" to it).\n` +
        `6) ADAPT: if they answer easily, make the next task a bit harder (richer sentence, nuance). If ` +
        `they struggle, simplify and give a small hint — but stay on the SAME word until it's attempted.\n` +
        `7) When every word has been practised (or the learner asks to stop), set "done" to true and end ` +
        `with a short, encouraging wrap-up naming what improved.\n\n` +
        `By default write "say" in ${target} (the learner's language). If the learner asks to communicate ` +
        `in ${source}, DO switch: actually write more of your "say" in ${source} at their level (with a ` +
        `short ${target} gloss only if truly needed) — never merely promise to switch and then keep using ` +
        `${target}. Keep it warm and concise — at most ~3 short sentences. The ${source} words/sentences ` +
        `you quote always stay in ${source}. "drillWord" is the word you are asking about in THIS message ` +
        `(use "" only for the intro line before the first word, or the final wrap-up).` +
        scriptNote(params.sourceLang ?? "en") +
        ` Respond as JSON: {"say": string, "drillWord": string, "grade": "none"|"correct"|"partial"|"wrong", ` +
        `"gradedWord": string, "done": boolean}.`,
    },
    ...clipped,
  ];

  const result = await chatJsonConversation({
    messages,
    schema: coachDrillSchema,
    timeoutMs: 60000,
    label: "coachDrill",
  });
  return {
    say: result.say.trim(),
    drillWord: (result.drillWord ?? "").trim(),
    grade: result.grade ?? "none",
    gradedWord: (result.gradedWord ?? "").trim(),
    done: result.done ?? false,
  };
}
