import { Fragment } from "react";

// Words of a gloss that say nothing about the sense: prepositions, "кем-л." and the like.
const STOP = new Set([
  "и", "или", "а", "в", "во", "на", "о", "об", "с", "со", "к", "ко", "по", "за", "из", "от", "до", "для", "при", "под", "над",
  "не", "ни", "быть", "это", "тот", "та", "то", "как", "что", "чем", "очень", "себя", "свой", "кто",
  "the", "a", "an", "to", "of", "in", "on", "at", "for", "with", "by", "be", "or", "and", "sth", "sb", "one's", "oneself",
]);
const WORD = /[\p{L}\p{M}]+(?:-[\p{L}\p{M}]+)*/gu;
const HAN = /\p{Script=Han}/u;
const CYR = /\p{Script=Cyrillic}/u;

/**
 * The part of a term every form of it starts with. Russian: a verb loses -ть(ся)
 * and its aspect suffix (откликаться → отклик, so «откликнулись» is found;
 * обслуживать → обслуж), any other word its ending (поездка → поездк: «поездку»,
 * not «поезде»). Elsewhere a long word loses two letters (respond → respo).
 */
function stemOf(term: string): string {
  let w = term.toLowerCase();
  if (CYR.test(w)) {
    // An infinitive: a vowel before -ть(ся) (часть is a noun), or -ти, -чь.
    if (/[аеёиоуыюя]ть(ся)?$|ти(сь)?$|чь(ся)?$/.test(w)) {
      w = w.replace(/(ть|ти|чь)(ся|сь)?$/, "");
      w = w.replace(/(ыва|ива|ова|ева|ну|а|я|е|и|о|у)$/, "");
    } else {
      w = w.replace(/(ый|ий|ой|ая|яя|ое|ее|ые|ие|ых|их)$/, "").replace(/[аяоеёьйыиую]$/, "");
    }
    return w.length >= 3 ? w : term.toLowerCase();
  }
  return w.length > 5 ? w.slice(0, -2) : w;
}

/** A gloss's stems, its usage hints and "кем-л." words left out. */
export function glossStems(meaning: string): string[] {
  const bare = meaning.replace(/\s*[(（][^)）]*[)）]/g, " ");
  const out = new Set<string>();
  for (const m of bare.matchAll(WORD)) {
    const w = m[0].toLowerCase();
    if (w.length < 3 || STOP.has(w) || /-л$/.test(w)) continue;
    out.add(HAN.test(w) ? w : stemOf(w));
  }
  return [...out];
}

/**
 * An example's translation with the card's meaning marked in it, as the word is
 * marked in the sentence above: each word that starts with a stem of the meaning
 * (响应 «откликаться (на призыв)» → «откликнулись»). A translation that words it
 * another way marks nothing; with no meaning (the question side), it's plain text.
 */
export function GlossText({ text, meaning }: { text: string; meaning?: string | null }) {
  const stems = meaning ? glossStems(meaning) : [];
  if (!stems.length) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const m of text.matchAll(WORD)) {
    const w = m[0].toLowerCase();
    const hit = stems.some((s) => {
      if (HAN.test(s)) return w.includes(s);
      if (!w.startsWith(s)) return false;
      // Short Russian roots need a matching inflected stem: «боль» → «боли»,
      // but never «больнице» just because both start with «бол».
      return !CYR.test(s) || s.length >= 4 || stemOf(w).replace(/ь$/, "") === s.replace(/ь$/, "");
    });
    if (!hit) continue;
    parts.push(<Fragment key={`t${at}`}>{text.slice(at, m.index)}</Fragment>);
    parts.push(
      <mark key={m.index} className="rounded bg-news-hl px-0.5 text-sage-deep">
        {m[0]}
      </mark>,
    );
    at = m.index! + m[0].length;
  }
  parts.push(<Fragment key="end">{text.slice(at)}</Fragment>);
  return <>{parts}</>;
}
