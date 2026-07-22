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
