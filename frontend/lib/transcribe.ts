// Local, offline transcription (no model call, no tokens): Chinese → Hanyu Pinyin
// via pinyin-pro, Korean → Revised Romanization via es-hangul. Japanese needs the
// model (kanji→reading requires a heavy dictionary), so it isn't "local".
// The libraries are dynamically imported so they only load when actually used.

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
