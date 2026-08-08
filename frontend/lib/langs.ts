// Languages a user can pick for a card pair (source -> target). `name` is the
// English label (used in the UI so search works with a latin keyboard); `native`
// is kept for reference.
export const LANGS = [
  { code: "en", name: "English", native: "English" },
  { code: "zh", name: "Chinese", native: "中文" },
  { code: "ru", name: "Russian", native: "Русский" },
  { code: "es", name: "Spanish", native: "Español" },
  { code: "de", name: "German", native: "Deutsch" },
  { code: "fr", name: "French", native: "Français" },
  { code: "ja", name: "Japanese", native: "日本語" },
  { code: "ko", name: "Korean", native: "한국어" },
] as const;

const LABELS: Record<string, string> = Object.fromEntries(LANGS.map((l) => [l.code, l.name]));

const CUSTOM_KEY = "lexa.customLangs";

// Custom languages the user added themselves (stored locally).
export function langLabel(code: string): string {
  if (code === "auto") return "Auto-detect";
  if (LABELS[code]) return LABELS[code];
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

// The AI agents only reliably handle the built-in languages. A user-added custom
// language (or "unknown") should fall back to manual cards, since the model may
// not actually know it.
const AI_LANGS = new Set<string>(LANGS.map((l) => l.code));
export function isAiSupported(code: string): boolean {
  return code === "auto" || AI_LANGS.has(code);
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
