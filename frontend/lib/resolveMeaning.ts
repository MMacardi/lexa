// Resolve the meaning of an arbitrary word on tap — the lookup chain the Reader uses,
// extracted so the Coach bubbles can reuse it. Cache first (a repeat tap costs no model
// call, even in a later session); then, for Chinese, the shared default meaning when
// it is settled (one sense, one reading — no sentence can change it, so no model is
// asked: about half the HSK list); then one gloss request. The pinyin/romanization for
// Chinese and Korean is computed on-device instead of asked from the model.

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
  /** surrounding text, so the gloss can pick the right sense of an ambiguous word */
  sentence?: string;
  sourceLang: string;
  targetLang: string;
}): Promise<ResolvedMeaning> {
  const word = opts.word.trim();
  if (!word) return { meaning: "", transcription: "" };

  const cached = getGloss(word, opts.sourceLang, opts.targetLang);
  if (cached) return { meaning: cached.gloss, transcription: cached.tr };

  const key = `${opts.sourceLang}|${opts.targetLang}|${word.toLowerCase()}`;
  const running = inflight.get(key);
  if (running) return running;

  const task = (async (): Promise<ResolvedMeaning> => {
    const showTr = getShowTranscription() && hasTranscription(opts.sourceLang);
    if (isChineseLang(opts.sourceLang)) {
      const d = await dictEntry(word, opts.targetLang);
      // The dictionary's reading, like the Reader: a bare 了 is le, not liǎo.
      if (d?.settled && d.meaning) return { meaning: d.meaning, transcription: showTr ? d.phonetic : "" };
    }
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
    setGloss(word, opts.sourceLang, opts.targetLang, entry);
    return { meaning: entry.gloss, transcription: entry.tr };
  })();

  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}
