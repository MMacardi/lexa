// Shared tap lookup: the dictionary's meaning and reading first, including words
// with several senses. Only gaps in the learner's language use a contextual AI
// gloss, cached per sentence across sessions. Dictionary data takes precedence
// over older AI cache entries. Chinese/Korean transcription is computed locally.

import { api } from "./api";
import { getGloss, setGloss } from "./glossCache";
import { getShowTranscription, hasTranscription } from "./learnPrefs";
import { isLocalTr, localTranscribe } from "./transcribe";
import { dictEntry, isChineseLang } from "./dictEntry";

export interface ResolvedMeaning {
  meaning: string;
  transcription: string; // pinyin / romaji / romanization; "" when not applicable
}

// One request per word even if it is tapped twice before the first one lands.
const inflight = new Map<string, Promise<ResolvedMeaning>>();

export async function resolveMeaning(opts: {
  word: string;
  /** surrounding text for the AI fallback when the dictionary has no meaning */
  sentence?: string;
  sourceLang: string;
  targetLang: string;
}): Promise<ResolvedMeaning> {
  const word = opts.word.trim();
  if (!word) return { meaning: "", transcription: "" };

  const sentence = opts.sentence?.trim() || "";
  const key = JSON.stringify([opts.sourceLang, opts.targetLang, word, sentence]);
  const running = inflight.get(key);
  if (running) return running;

  const task = (async (): Promise<ResolvedMeaning> => {
    const showTr = getShowTranscription() && hasTranscription(opts.sourceLang);
    if (isChineseLang(opts.sourceLang)) {
      const d = await dictEntry(word, opts.targetLang);
      const meaning = d?.meaning?.trim() || (opts.targetLang === "en" ? d?.gloss.trim() : "");
      if (d && meaning) return { meaning, transcription: showTr ? d.phonetic : "" };
    }
    const cached = getGloss(word, opts.sourceLang, opts.targetLang, sentence);
    if (cached) return { meaning: cached.gloss, transcription: cached.tr };
    const local = isLocalTr(opts.sourceLang); // zh / zh-Hant / ko → no model call
    const [localTr, res] = await Promise.all([
      showTr && local ? localTranscribe(word, opts.sourceLang) : Promise.resolve(""),
      api.gloss({
        word,
        sentence: opts.sentence?.trim() || word,
        sourceLang: opts.sourceLang,
        targetLang: opts.targetLang,
        withTranscription: showTr && !local,
      }),
    ]);
    const entry = { gloss: res.gloss, tr: local ? localTr : (res.transcription ?? "").trim() };
    setGloss(word, opts.sourceLang, opts.targetLang, entry, sentence);
    return { meaning: entry.gloss, transcription: entry.tr };
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}
