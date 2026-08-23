// Local, deterministic transcription (no model call, no tokens): Chinese → Hanyu
// Pinyin via pinyin-pro, Korean → Revised Romanization via es-hangul. Used to fill
// a card's `phonetic` reliably instead of trusting the model, which sometimes
// returns IPA for Chinese. Japanese needs the model (kanji → reading), so it has
// no local form here. Mirrors the frontend's lib/transcribe.ts.

export function hasLocalPhonetic(lang?: string): boolean {
  return lang === "zh" || lang === "zh-Hant" || lang === "ko";
}

export async function localPhonetic(word: string, lang?: string): Promise<string | null> {
  const w = word.trim();
  if (!w) return null;
  try {
    if (lang === "zh" || lang === "zh-Hant") {
      const { pinyin } = await import("pinyin-pro");
      const r = pinyin(w, { toneType: "symbol", type: "string" }).trim();
      return r && r !== w ? r : null; // r === w means nothing was transcribed
    }
    if (lang === "ko") {
      const { romanize } = await import("es-hangul");
      const r = romanize(w).trim();
      // es-hangul only romanizes Hangul; if CJK remains (e.g. a Hanja word) it
      // failed — fall back to the model rather than showing the raw characters.
      if (!r || /[぀-ヿ㐀-鿿가-힯]/.test(r)) return null;
      return r;
    }
  } catch {
    return null;
  }
  return null;
}
