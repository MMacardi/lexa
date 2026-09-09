// Local, offline transcription (no model call, no tokens): Chinese → Hanyu Pinyin
// via pinyin-pro, Korean → Revised Romanization via es-hangul. Japanese needs the
// model (kanji→reading requires a heavy dictionary), so it isn't "local".
// The libraries are dynamically imported so they only load when actually used.

import { useEffect, useState } from "react";
import { useShowTranscription } from "./learnPrefs";

export function isLocalTr(lang: string): boolean {
  return lang === "zh" || lang === "zh-Hant" || lang === "ko";
}

export async function localTranscribe(word: string, lang: string): Promise<string> {
  if (lang === "zh" || lang === "zh-Hant") {
    const { pinyin } = await import("pinyin-pro");
    return pinyin(word, { toneType: "symbol", type: "string" });
  }
  if (lang === "ko") {
    const { romanize } = await import("es-hangul");
    return romanize(word);
  }
  return "";
}

const EMPTY = new Map<string, string>();

/**
 * On-device readings for a list of words, keyed by the word itself — for chip UIs that
 * want pinyin next to each entry. Honours the "show transcription" preference and
 * returns an empty map for languages we can't romanize locally (so callers can render
 * unconditionally). Depends on a JOINED key, not the array identity, because callers
 * rebuild their word arrays on every render.
 */
export function useTranscriptions(words: string[], lang: string): Map<string, string> {
  const showTr = useShowTranscription();
  const on = showTr && isLocalTr(lang);
  const [map, setMap] = useState<Map<string, string>>(EMPTY);
  const key = on ? words.map((w) => w.trim()).filter(Boolean).join("\u0000") : "";

  useEffect(() => {
    if (!key) {
      setMap((cur) => (cur === EMPTY ? cur : EMPTY));
      return;
    }
    const list = key.split("\u0000");
    let cancelled = false;
    void (async () => {
      const next = new Map<string, string>();
      for (const w of list) {
        if (cancelled) return;
        try {
          const tr = await localTranscribe(w, lang);
          if (tr) next.set(w, tr);
        } catch {
          /* a word we can't romanize simply renders without its reading */
        }
      }
      if (!cancelled) setMap(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [key, lang]);

  return on ? map : EMPTY;
}
