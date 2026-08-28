// Fuzzy, inflection-tolerant matching of a set of study words inside free text.
// "to get by" should light up on "getting by"; "resilient" on "resilience". We do
// this by matching a stem of each token plus a short letter suffix, and by allowing
// leading "to " (infinitive marker) to be optional. Latin-script oriented, but
// non-Latin tokens fall back to an exact match (no stemming, no word boundary).

const RE_SPECIAL = /[.*+?^${}()|[\]\\]/g;
const escape = (s: string) => s.replace(RE_SPECIAL, "\\$&");
const hasLatin = (s: string) => /[a-zA-Z]/.test(s);

// A regex fragment (no anchors) that matches one study word and its close forms.
function wordPattern(word: string): string {
  const cleaned = word.trim().toLowerCase().replace(/^to\s+/, ""); // drop infinitive "to "
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  if (!tokens.length) return "";
  const parts = tokens.map((tok) => {
    if (!hasLatin(tok)) return escape(tok); // CJK etc. — exact
    // Keep a stem, allow up to 4 trailing letters for inflections (get→getting,
    // resilient→resilience). Short tokens (<3) stay exact to avoid false hits.
    const stem = tok.length >= 3 ? tok.slice(0, Math.max(3, tok.length - 3)) : tok;
    const suffix = tok.length >= 3 ? "[\\p{L}\\p{M}']{0,4}" : "";
    return escape(stem) + suffix;
  });
  return parts.join("\\s+");
}

export type WordMatcher = {
  regex: RegExp | null; // combined, with ONE capture group, "giu" — safe for String.split
  canonical: (surface: string) => string | null; // map a matched surface form back to the study word
};

export function buildWordMatcher(pool: string[]): WordMatcher {
  const entries = pool
    .map((w) => ({ word: w, pattern: wordPattern(w) }))
    .filter((e) => e.pattern.length > 0);
  if (!entries.length) return { regex: null, canonical: () => null };

  // Letter-aware boundaries (\b misbehaves around apostrophes and non-Latin script).
  const B = "(?<![\\p{L}\\p{M}])";
  const A = "(?![\\p{L}\\p{M}])";
  let regex: RegExp | null;
  try {
    regex = new RegExp(`${B}(${entries.map((e) => e.pattern).join("|")})${A}`, "giu");
  } catch {
    regex = null; // very old engines without lookbehind — degrade to no highlight
  }
  const singles = entries.map((e) => ({ word: e.word, re: safe(`^(?:${e.pattern})$`) }));
  const canonical = (surface: string) => singles.find((s) => s.re?.test(surface))?.word ?? null;
  return { regex, canonical };
}

function safe(src: string): RegExp | null {
  try {
    return new RegExp(src, "iu");
  } catch {
    return null;
  }
}
