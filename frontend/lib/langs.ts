// Languages a user can pick for a card pair (source -> target).
export const LANGS = [
  { code: "en", native: "English" },
  { code: "zh", native: "中文" },
  { code: "ru", native: "Русский" },
  { code: "es", native: "Español" },
  { code: "de", native: "Deutsch" },
  { code: "fr", native: "Français" },
  { code: "ja", native: "日本語" },
  { code: "ko", native: "한국어" },
] as const;

const LABELS: Record<string, string> = Object.fromEntries(
  LANGS.map((l) => [l.code, l.native]),
);

export function langLabel(code: string): string {
  return LABELS[code] ?? code.toUpperCase();
}

export function pairLabel(source: string, target: string): string {
  return `${langLabel(source)} → ${langLabel(target)}`;
}
