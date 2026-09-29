import { langName } from "./langs.js";

// How a teaching answer is laid out — Mika, a card's Explain, and the follow-up
// chat about a card. Left to itself the model wrote one dense paragraph that mixed
// the rule, the contrast and the examples, with Chinese examples inline and bare of
// pinyin: hard going for an HSK 4 learner reading in their own language. Its word
// lists, where it did choose a layout, read well — so the layout is now spelled out,
// in exactly what the chat renders (RichText: **bold**, *italic*, "- " and "1. "
// lines, lines indented under them, blank lines). The coach's chat and scenes are
// not this: they are dialogue in the studied language, shown as plain text.
//
// The shape is shown, not only described: told to "open with one short line", the
// JSON-mode model wrote that line and stopped — inside a JSON string it doesn't
// break lines unless it sees "\n" doing it.
export function answerFormat(sourceCode: string, targetCode: string, field: string): string {
  const source = langName(sourceCode);
  const target = langName(targetCode);
  const zh = sourceCode === "zh" || sourceCode === "zh-Hant";
  const reading = zh ? `<pinyin with tone marks> — <${target} translation>` : `<${target} translation>`;
  // "written in Chinese characters": told only "a Chinese example sentence", a word
  // list came back with Russian sentences in that slot and pinyin under them.
  const sentence = zh ? `the example sentence itself, written in Chinese characters` : `the example sentence itself, in ${source}`;
  const shape =
    `"<the direct answer in one line: the meaning, the rule, or the corrected sentence>\\n` +
    `- <one point, at most two short sentences>\\n- <another point>\\n\\n` +
    `- <${sentence}>\\n  ${reading}"`;
  return (
    ` LAYOUT — "${field}" is several lines joined by \\n, shaped like this: ${shape}. ` +
    `The chat renders only **bold**, *italic*, lines starting "- " or "1. ", lines indented two spaces under ` +
    `them, and blank lines. So: no greeting and no restating the question before the first line; after it, one ` +
    `idea per "- " line ("1. " for steps and word lists), never a paragraph of more than about three sentences. ` +
    `Every ${source} example sentence is its own "- " line — never inside a sentence of explanation — with ` +
    `${zh ? "its pinyin and " : ""}its translation indented on the line under it. ` +
    (zh ? `The first time a Chinese word you are explaining appears, put its pinyin after it: 由于 (yóuyú). ` : "") +
    `Bold only the ${source} word or pattern being taught, where it first appears; no headings, tables, code ` +
    `or emoji. Everything but the ${source} sentences and words themselves is in ${target} — the points, the ` +
    `reasons, the labels. When correcting a sentence, open instead with the corrected sentence as an example ` +
    `line (${zh ? "pinyin and " : ""}translation under it), then one "- " line per change, in ${target}: what ` +
    `was wrong → why. Usually 4–8 lines in all; a word list may be longer. If a rule has exceptions, give the ` +
    `common case and say it is the common case.`
  );
}
