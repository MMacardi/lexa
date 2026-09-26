import { chatJsonConversation, chatJsonConversationStream, CHAT_VISION_MODEL, type ChatMessage } from "./llm.js";
import { tutorChatSchema, type TutorChatResult } from "../lib/schemas.js";
import { langName, scriptNote, LANG_NAMES } from "../lib/langs.js";

// Codes Mika may tag a suggested word with (legacy zh-Hant isn't offered).
const OFFERABLE_LANGS = Object.keys(LANG_NAMES).filter((c) => c !== "zh-Hant");

// Every turn resends the whole window, photos included, so only the newest few stay
// attached; an older one is named in its turn so the thread still reads.
const MAX_IMAGES = 4;

/**
 * Global AI tutor chat — not tied to a specific card. Helps the learner with the
 * language they're studying and can propose vocabulary to save (addWords), which
 * the client turns into one-tap "create cards" actions.
 */
export async function tutorChat(params: {
  messages: { role: "user" | "assistant"; content: string; images?: string[] }[]; // images: data: URIs
  sourceLang?: string;
  targetLang?: string;
  level?: string;
  profileNote?: string; // "about this learner" memory, prepended to the prompt
  onDelta?: (chunk: string) => void; // stream the "answer" text as it is written
  signal?: AbortSignal;
}): Promise<TutorChatResult> {
  const source = langName(params.sourceLang ?? "en");
  const target = langName(params.targetLang ?? "zh");
  const levelLine = params.level ? ` The learner's level is about ${params.level} (CEFR) — pitch your ${source}, examples and explanations to it.` : "";
  // Past replies go back in the same JSON shape we ask for: fed as plain text, Qwen
  // copies them and answers with a bare JSON string, which fails the schema.
  // Walked newest-first so the photo budget goes to the latest turns.
  let photosLeft = MAX_IMAGES;
  const clipped = params.messages
    .slice(-12)
    .reverse()
    .map((m): ChatMessage => {
      if (m.role === "assistant") return { role: "assistant", content: JSON.stringify({ answer: m.content.slice(0, 2000) }) };
      const text = m.content.slice(0, 2000);
      const kept = (m.images ?? []).slice(0, photosLeft);
      photosLeft -= kept.length;
      const dropped = (m.images?.length ?? 0) - kept.length;
      if (!kept.length) {
        const note = dropped ? `[${dropped} earlier photo${dropped > 1 ? "s" : ""}, no longer attached]` : "";
        return { role: "user", content: [text, note].filter(Boolean).join("\n") };
      }
      return {
        role: "user",
        content: [
          { type: "text", text: text || "(A photo, no question — help me with it.)" },
          ...kept.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        ],
      };
    })
    .reverse();
  const withPhotos = clipped.some((m) => typeof m.content !== "string");

  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        (params.profileNote ?? "") +
        `You are a friendly, encouraging ${source} tutor for a learner whose language is ${target}.` +
        levelLine +
        ` Answer in the "answer" field ENTIRELY in ${target}, concise and practical. Help them learn ` +
        `${source}: meanings, usage, grammar, example sentences, and picking vocabulary. ` +
        `Stay on language learning — questions about words in OTHER languages are fine too; politely ` +
        `decline unrelated general-knowledge questions. ` +
        `Role-plays, level checks and study plans are welcome, and so is translating, correcting or ` +
        `writing a text (a message, a post, homework) — say briefly what you changed and why.\n\n` +
        // Only when a photo is in the window: the paragraph costs tokens on every turn.
        (withPhotos
          ? `PHOTOS — the learner attached photos (a textbook page, a sign, a menu, a screenshot, handwriting, ` +
            `an object). Look closely. If a photo has ${source} text, read it exactly — quote the ${source} ` +
            `lines you explain — and explain what it says and the words or grammar worth learning at their ` +
            `level. If it has no text, name what is in it in ${source}. A photo sent with no question means ` +
            `"help me with this". Offer the words from it worth learning (not the ones far below their ` +
            `level) in "addWords"/"addCards".\n\n`
          : "") +
        // So "how does X work / what should I do today" questions get real answers.
        `ABOUT THE APP (you are Mika, the tutor inside Onomika) — use when asked how things work or what to do: ` +
        `Today = home with the daily goal and due count. Flashcards = spaced repetition (FSRS): after each card ` +
        `the learner grades Again (forgot) / Hard / Good / Easy, which sets the next review date; review due cards ` +
        `first, daily. Quiz = multiple-choice, typing and fill-the-blank drills over saved words. Reader = paste or generate a ` +
        `text, tap any word to see its meaning and save it. Onomika Coach = picks what to study, a practice drill, ` +
        `free chat, and role-play scenes with a scored report. My words / Collections = the deck and Quizlet-style ` +
        `sets. Friends = streaks and invites. There is also a Telegram bot, @onomikabot. This chat reads photos ` +
        `too (the paperclip, or paste/drop an image) and takes voice (the mic). Name the page to open; ` +
        `don't invent features.\n\n` +
        `ACTIONS — you can add words to the learner's deck: whenever they ask to save/add words, OR ask ` +
        `you to suggest words on a topic/level to study, put those ${source} words (single words or short ` +
        `phrases, real ${source}, deduplicated) in "addWords" so they can be added with one tap. If no ` +
        `words are being added, use an empty array. Those words are only OFFERED — the learner taps to ` +
        `save them — so never say you have added or saved them; say they can add them below. ` +
        `IMPORTANT (saves work): for EACH word in "addWords", also add an object to "addCards" with ` +
        `{word, meaning, example, exampleTr}, REUSING the exact meaning and example sentence you already ` +
        `wrote in "answer" — do not invent new ones. "meaning" is the definition in ${target}; "example" is ` +
        `one natural ${source} sentence using the word; "exampleTr" is that sentence translated to ${target}. ` +
        `Keep "addCards" aligned with "addWords" (same words, same order). If you have no example for a word, ` +
        `leave its "example" empty. ` +
        // The learner can ask about a word from another language mid-chat (a Chinese
        // word inside an English chat) — those are offered too, saved into their own pair.
        `If a word you offer is NOT ${source} (the learner asked about a word in another language), ` +
        `still list it, and set that card's "lang" to its language code — one of ` +
        `${OFFERABLE_LANGS.join(", ")}. Leave "lang" empty for ${source} words; its "meaning" ` +
        `and "exampleTr" stay in ${target} and its "example" is a sentence in the word's own language.` +
        scriptNote(params.sourceLang ?? "en") +
        ` (This applies to example sentences, vocabulary, and every ${source} word you write.) ` +
        'Respond as JSON: {"answer": string, "addWords": string[], "addCards": [{"word": string, "meaning": string, "example": string, "exampleTr": string, "lang": string}]}.',
    },
    ...clipped,
  ];

  // A photo anywhere in the window needs the vision model; plain text stays on qwen-plus.
  const model = withPhotos ? CHAT_VISION_MODEL : undefined;
  const ask = (stream: boolean) =>
    stream && params.onDelta
      ? chatJsonConversationStream({
          messages,
          schema: tutorChatSchema,
          onDelta: params.onDelta,
          field: "answer", // Mika's reply lives in "answer", the coach's in "say"
          signal: params.signal,
          timeoutMs: 60000,
          label: "tutorChat.stream",
          model,
        })
      : chatJsonConversation({ messages, schema: tutorChatSchema, timeoutMs: 60000, label: "tutorChat", model });
  // One retry on an off-schema reply (e.g. a bare string) — it rarely repeats. The
  // retry does NOT stream: its deltas would append to the half-written first attempt
  // in the open bubble. The client replaces that text with the final answer anyway.
  const result = await ask(true).catch((err: Error) => {
    if (err.name === "AbortError") throw err;
    if (err.name !== "ZodError" && !err.message.startsWith("LLM did not return valid JSON")) throw err;
    return ask(false);
  });
  return {
    answer: result.answer.trim(),
    addWords: (result.addWords ?? []).map((s) => s.trim()).filter(Boolean).slice(0, 30),
    addCards: (result.addCards ?? [])
      .map((c) => ({
        word: c.word.trim(),
        meaning: (c.meaning ?? "").trim(),
        example: (c.example ?? "").trim(),
        exampleTr: (c.exampleTr ?? "").trim(),
        // Keep a language tag only when it is one we know; the client falls back
        // to the chat's own source language for anything else.
        lang: LANG_NAMES[(c.lang ?? "").trim()] ? (c.lang ?? "").trim() : "",
      }))
      .filter((c) => c.word)
      .slice(0, 30),
  };
}
