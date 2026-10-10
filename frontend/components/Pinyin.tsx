"use client";

import { useToneColors } from "@/lib/learnPrefs";

const V = "aeiouüvāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ";
// One syllable: an initial, its vowels, a final n / ng / r that isn't the next
// syllable's initial. Cards space their syllables ("diàn nǎo"), so this only has to
// guess for the odd unspaced reading.
const SYLLABLE = new RegExp(`(?:[zcs]h|[bpmfdtnlgkhjqxrzcsyw])?[${V}]+(?:ng(?![${V}])|n(?![${V}])|r(?![${V}]))?`, "gi");
const MARKS = ["āēīōūǖ", "áéíóúǘ", "ǎěǐǒǔǚ", "àèìòùǜ"];

/** A syllable's tone from its mark: 1–4, or 5 for the neutral tone (no mark). */
export function toneOf(syllable: string): number {
  for (const c of syllable.toLowerCase()) {
    const i = MARKS.findIndex((m) => m.includes(c));
    if (i >= 0) return i + 1;
  }
  return 5;
}

// Neutral keeps the surrounding colour: it is the absence of a tone, not a fifth one.
const TONE_CLASS = ["", "text-tone1", "text-tone2", "text-tone3", "text-tone4", ""];
export const toneClass = (syllable: string) => TONE_CLASS[toneOf(syllable)];

/**
 * Tone-marked pinyin with each syllable in its tone's colour, while the learner
 * keeps tone colours on (the default). Anything that isn't pinyin — a learner's
 * own transcription, IPA — passes through as it is, since only marked vowels colour.
 */
export function Pinyin({ text, className }: { text: string; className?: string }) {
  const on = useToneColors();
  // The pinyin font: in the app's own, a syllable opening on ā or ō lost its macron.
  const box = className ? `font-pinyin ${className}` : "font-pinyin";
  if (!on || !text) return <span className={box}>{text}</span>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(SYLLABLE)) {
    if (m.index > at) parts.push(text.slice(at, m.index));
    const cls = toneClass(m[0]);
    parts.push(
      cls ? (
        <span key={m.index} className={cls}>
          {m[0]}
        </span>
      ) : (
        m[0]
      ),
    );
    at = m.index + m[0].length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <span className={box}>{parts}</span>;
}
