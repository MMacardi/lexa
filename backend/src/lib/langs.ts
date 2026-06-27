// Supported languages for vocabulary cards. Any pair (source -> target) is allowed.
export const LANG_NAMES: Record<string, string> = {
  en: "English",
  zh: "Simplified Chinese",
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
