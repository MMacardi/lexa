import type { Locale } from "./i18n";

const labels = [
  ["noun", "существительное", "名词", "n", "n."],
  ["verb", "глагол", "动词", "v", "v."],
  ["adjective", "прилагательное", "形容词", "adj", "adj."],
  ["adverb", "наречие", "副词", "adv", "adv."],
  ["pronoun", "местоимение", "代词", "pron", "pron."],
  ["preposition", "предлог", "介词", "prep", "prep."],
  ["conjunction", "союз", "连词", "conj", "conj."],
  ["particle", "частица", "助词"],
  ["numeral", "числительное", "数词", "number"],
  ["classifier", "счётное слово", "量词", "measure word", "счетное слово"],
  ["interjection", "междометие", "叹词", "interj", "interj."],
  ["idiom", "идиома", "成语"],
  ["phrase", "словосочетание", "短语"],
  ["proper noun", "имя собственное", "专有名词"],
  ["determiner", "определитель", "限定词"],
  ["auxiliary verb", "вспомогательный глагол", "助动词"],
  ["modal verb", "модальный глагол", "情态动词"],
  ["suffix", "суффикс", "后缀"],
  ["prefix", "префикс", "前缀"],
] as const;

// Old cards and dictionary entries may use different languages or abbreviations.
// Keep custom labels intact; translate only recognized grammatical terms.
export function localizePartOfSpeech(value: string | null | undefined, locale: Locale): string {
  if (!value) return "";
  const index = { en: 0, ru: 1, zh: 2 }[locale];
  return value.split(/(\s*[/,;、]\s*)/).map((part) => {
    const key = part.trim().toLowerCase();
    const row = labels.find((terms) => terms.some((term) => term === key));
    return row ? row[index] : part;
  }).join("");
}
