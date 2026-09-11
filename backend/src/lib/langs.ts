// Supported languages for vocabulary cards. Any pair (source -> target) is allowed.
// Chinese ships as ONE language (Simplified script, 🇨🇳). `zh-Hant` is a legacy data
// code kept for old records: it still resolves to plain "Chinese" in prompts (the
// scriptNote below keeps such cards' output in their own script).
export const LANG_NAMES: Record<string, string> = {
  en: "English",
  zh: "Chinese",
  "zh-Hant": "Chinese",
  ru: "Russian",
  es: "Spanish",
  de: "German",
  fr: "French",
  ja: "Japanese",
  ko: "Korean",
};

export function langName(code: string): string {
  return LANG_NAMES[code] ?? code;
}

// An explicit reminder about which Han script to use, injected into prompts so the
// model never mixes Simplified and Traditional (a common failure for Chinese pairs).
export function scriptNote(code: string): string {
  if (code === "zh") return " Write every Chinese character in SIMPLIFIED script (简体字) — never Traditional.";
  if (code === "zh-Hant") return " Write every Chinese character in TRADITIONAL script (繁體字) — never Simplified.";
  return "";
}
