import type { HskVersion } from "./api";
import { wordKey, type Token } from "./segment";

export const countsAsWord = (tk: Token) => tk.wordLike && /\p{L}/u.test(tk.text);
export const hskTop = (version: HskVersion) => version === "2.0" ? 6 : 7;
export const hskRange = (level: number) => level === 1 ? "1" : `1–${level === 7 ? 9 : level}`;

/** Full-text vocabulary only: lowest band covering >=95% of LISTED occurrences.
 * Repeats carry their actual weight. Off-list words never enter that denominator;
 * report both their occurrences and unique keys so a low estimate cannot hide them.
 * HSK 3.0 stores the combined 7–9 band as 7. No grammar/proficiency inference.
 */
export function readerVocabulary(tokens: Token[], version: HskVersion) {
  const occurrences = Array<number>(hskTop(version) + 1).fill(0);
  const offListKeys = new Set<string>();
  let offList = 0;
  for (const tk of tokens) {
    if (!countsAsWord(tk)) continue;
    const level = tk.hsk?.[version];
    if (level && level >= 1 && level <= hskTop(version)) occurrences[level]++;
    else { offList++; offListKeys.add(wordKey(tk.text)); }
  }
  const listed = occurrences.reduce((a, b) => a + b, 0);
  let covered = 0;
  let level: number | null = null;
  for (let n = 1; listed && n < occurrences.length; n++) {
    covered += occurrences[n];
    // Integer comparison keeps the exact 19/20 boundary inclusive.
    if (covered * 100 >= listed * 95) { level = n; break; }
  }
  return { version, level, listed, occurrences, offList, offListUnique: offListKeys.size };
}

/** New words are UNIQUE keys without a card, unlike running-word coverage. */
export function readerCoverage(tokens: Token[], version: HskVersion, target: number | null,
  saved: ReadonlyMap<string, string>, known: ReadonlySet<string>, added: ReadonlySet<string>) {
  let total = 0;
  let hits = 0;
  const fresh = new Set<string>();
  const forTarget = new Set<string>();
  const levels = new Set<number>();
  for (const tk of tokens) {
    if (!countsAsWord(tk)) continue;
    total++;
    const key = wordKey(tk.text);
    const level = tk.hsk?.[version];
    if (level) levels.add(level);
    if (known.has(key)) hits++;
    if (!saved.has(key) && !added.has(key)) {
      fresh.add(key);
      if (level && target && level <= Math.min(target, hskTop(version))) forTarget.add(key);
    }
  }
  return { knownPct: total ? Math.round(hits / total * 100) : null, newKeys: fresh,
    newForTarget: forTarget.size, levelsHere: [...levels].sort((a, b) => a - b) };
}
