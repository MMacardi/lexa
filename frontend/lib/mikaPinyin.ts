// Display-only cleanup of legacy model readings. Keep translations and stored prose.
const HAN = /\p{Script=Han}/u;
const TONE = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/i;
function isReading(text: string) {
  return TONE.test(text) && /^[a-züāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ\s'’.,!?，。！？:;()\-]+$/i.test(text);
}

export function mikaDisplayText(text: string): string {
  const lines = text.split(/\r?\n|(?:\\r)?\\n/);
  return lines.map((line, i) => {
    if (i && HAN.test(lines[i - 1])) {
      const body = line.trim().replace(/^[*_]+|[*_]+$/g, "");
      const parts = body.match(/^(.+?)\s+[—–]\s+(.+)$/);
      if (isReading(parts?.[1] ?? body)) return parts ? `${line.match(/^\s*/)?.[0] ?? ""}${parts[2]}` : "";
    }
    return line.replace(/([\p{Script=Han}][*_]*\s*)[（(]([^()（）]+)[)）]/gu,
      (whole, word: string, reading: string) => isReading(reading) ? word.trimEnd() : whole);
  }).join("\n");
}
