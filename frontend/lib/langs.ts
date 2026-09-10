// Languages a user can pick for a card pair (source -> target). `name` is the
// English label (kept for latin-keyboard search); `ru`/`zh` are the localized
// display names shown when the app language is Russian/Chinese; `native` is the
// name in that language itself.
export const LANGS = [
  { code: "en", name: "English", native: "English", ru: "Английский", zh: "英语" },
  { code: "zh", name: "Chinese (Simplified)", native: "简体中文", ru: "Китайский (упрощ.)", zh: "简体中文" },
  { code: "zh-Hant", name: "Chinese (Traditional)", native: "繁體中文", ru: "Китайский (традиц.)", zh: "繁体中文" },
  { code: "ru", name: "Russian", native: "Русский", ru: "Русский", zh: "俄语" },
  { code: "es", name: "Spanish", native: "Español", ru: "Испанский", zh: "西班牙语" },
  { code: "de", name: "German", native: "Deutsch", ru: "Немецкий", zh: "德语" },
  { code: "fr", name: "French", native: "Français", ru: "Французский", zh: "法语" },
  { code: "ja", name: "Japanese", native: "日本語", ru: "Японский", zh: "日语" },
  { code: "ko", name: "Korean", native: "한국어", ru: "Корейский", zh: "韩语" },
] as const;

const CUSTOM_KEY = "lexa.customLangs";
const LOCALE_KEY = "lexa.locale";

// Current app language (en/ru/zh), read straight from the store the i18n provider
// writes. Lets the pure langLabel() localize without threading `t` through 20+ callers.
function currentLocale(): "en" | "ru" | "zh" {
  if (typeof window === "undefined") return "en";
  const l = localStorage.getItem(LOCALE_KEY);
  return l === "ru" || l === "zh" ? l : "en";
}

const AUTO_LABEL: Record<"en" | "ru" | "zh", string> = {
  en: "Auto-detect",
  ru: "Авто",
  zh: "自动",
};

// Custom languages the user added themselves (stored locally). Built-in languages
// show in the app language; custom ones keep the name the learner typed.
export function langLabel(code: string): string {
  const locale = currentLocale();
  if (code === "auto") return AUTO_LABEL[locale];
  const built = LANGS.find((l) => l.code === code);
  if (built) return locale === "ru" ? built.ru : locale === "zh" ? built.zh : built.name;
  if (typeof window !== "undefined") {
    try {
      const found = (JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]") as { code: string; name: string }[]).find(
        (x) => x.code === code,
      );
      if (found) return found.name;
    } catch {
      /* ignore */
    }
  }
  // Fall back to a Title-cased version of the code.
  return code.charAt(0).toUpperCase() + code.slice(1);
}

export function pairLabel(source: string, target: string): string {
  return `${langLabel(source)} → ${langLabel(target)}`;
}

// AI cards work for the built-in languages AND any custom language the AI recognised
// when it was added (Qwen is broadly multilingual — e.g. it knows Hindi, Arabic,
// Turkish…). A custom language flagged `ai: false` failed that check, so it is manual
// entry only rather than getting confident nonsense from the model.
const AI_LANGS = new Set<string>(LANGS.map((l) => l.code));
export function isAiSupported(code: string): boolean {
  if (code === "auto" || AI_LANGS.has(code)) return true;
  if (typeof window === "undefined") return false;
  try {
    const custom = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]") as { code: string; ai?: boolean }[];
    return custom.some((x) => x.code === code && x.ai !== false);
  } catch {
    return false;
  }
}

// Coarse "script family" of a language, for spotting a paste/source mismatch.
export function scriptFamily(lang: string): "latin" | "cyrillic" | "han" | "jpn" | "kor" {
  if (lang === "ru") return "cyrillic";
  if (lang === "zh" || lang === "zh-Hant") return "han";
  if (lang === "ja") return "jpn";
  if (lang === "ko") return "kor";
  return "latin";
}

// Guess the dominant language of a block of text from its script (coarse — Latin
// scripts can't be told apart, so they all map to "en"). Returns null if unsure.
export function detectDominantLang(text: string): string | null {
  const c = { latin: 0, cyrillic: 0, han: 0, kana: 0, hangul: 0 };
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) c.latin++;
    else if (cp >= 0x0400 && cp <= 0x04ff) c.cyrillic++;
    else if (cp >= 0x3040 && cp <= 0x30ff) c.kana++;
    else if (cp >= 0xac00 && cp <= 0xd7af) c.hangul++;
    else if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) c.han++;
  }
  const total = c.latin + c.cyrillic + c.han + c.kana + c.hangul;
  if (total < 3) return null; // too little to judge
  if (c.kana > 0 && c.kana + c.han >= total * 0.3) return "ja";
  if (c.hangul >= total * 0.3) return "ko";
  if (c.han >= total * 0.3) return "zh";
  if (c.cyrillic >= total * 0.5) return "ru";
  if (c.latin >= total * 0.5) return "en";
  return null;
}

// Dominant script family of raw text — like scriptFamily() but read off the
// characters, with no minimum length (works for a single short word). Returns
// null when there are no letters to judge. Used to spot when the user typed a
// word in their OWN language (the target) and really wants the reverse card.
export function scriptFamilyOfText(text: string): "latin" | "cyrillic" | "han" | "jpn" | "kor" | null {
  const c = { latin: 0, cyrillic: 0, han: 0, kana: 0, hangul: 0 };
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) c.latin++;
    else if (cp >= 0x0400 && cp <= 0x04ff) c.cyrillic++;
    else if (cp >= 0x3040 && cp <= 0x30ff) c.kana++;
    else if (cp >= 0xac00 && cp <= 0xd7af) c.hangul++;
    else if ((cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf)) c.han++;
  }
  if (c.kana > 0) return "jpn"; // any kana → Japanese
  if (c.hangul > 0) return "kor"; // any hangul → Korean
  if (c.han > 0) return "han"; // ideographs (no kana/hangul)
  if (c.cyrillic > c.latin) return "cyrillic";
  if (c.latin > 0) return "latin";
  return null;
}

// True when the text is written purely in Han ideographs (no kana / hangul), so
// it could be Chinese, Japanese kanji, or Korean hanja — genuinely ambiguous.
// Used to show the inline 中文/日本語/한국어 picker under the add field.
export function isAmbiguousHan(word: string): boolean {
  let hasHan = false;
  for (const ch of word) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x3040 && c <= 0x30ff) return false; // kana → Japanese
    if (c >= 0xac00 && c <= 0xd7af) return false; // hangul → Korean
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) hasHan = true;
  }
  return hasHan;
}
