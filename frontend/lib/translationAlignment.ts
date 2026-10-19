export type TranslationSpan = { sourceStart: number; sourceEnd: number; targetStart: number; targetEnd: number; kind: "word" | "phrase" | "sentence" };
export type TranslationAlignment = { version: 1; source: string; translation: string; spans: TranslationSpan[] };
export function validAlignment(value: TranslationAlignment | null | undefined, source: string, translation: string): TranslationAlignment | null {
  if (value?.version !== 1 || value.source !== source || value.translation !== translation || !Array.isArray(value.spans)) return null;
  const valid = value.spans.every((s) => [s.sourceStart, s.sourceEnd, s.targetStart, s.targetEnd].every(Number.isInteger) &&
    s.sourceStart >= 0 && s.sourceStart < s.sourceEnd && s.sourceEnd <= source.length &&
    s.targetStart >= 0 && s.targetStart <= s.targetEnd && s.targetEnd <= translation.length);
  if (!valid || !value.spans.length) return null;
  const sentences = value.spans.filter((s) => s.kind === "sentence");
  return { ...value, spans: value.spans.filter((s) => s.kind === "sentence" || s.targetStart === s.targetEnd || !sentences.length ||
    sentences.some((p) => p.sourceStart <= s.sourceStart && p.sourceEnd >= s.sourceEnd && p.targetStart <= s.targetStart && p.targetEnd >= s.targetEnd)) };
}
export function alignedSpan(alignment: TranslationAlignment | null, start: number, end: number): TranslationSpan | null {
  const matches = alignment?.spans.filter((s) => s.sourceStart <= start && s.sourceEnd >= end && s.targetEnd > s.targetStart) ?? [];
  return matches.sort((a, b) => a.sourceEnd - a.sourceStart - (b.sourceEnd - b.sourceStart))[0] ?? null;
}
