import type { Token } from "./segment";

export type Sentence = { start: number; end: number; text: string };
const END = /[.!?。！？…]/;
const CLOSER = /[.!?。！？…"'”’」』》〉】）)\]]/;
const LIST = /^\s*(?:\d+[.)、](?!\d)|[A-Za-z][.)、])\s*/;

/** Source offsets are retained so punctuation and paragraph whitespace stay intact. */
export function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  const add = (end: number) => {
    let a = start;
    while (a < end && /\s/.test(text[a])) a++;
    let b = end;
    while (b > a && /\s/.test(text[b - 1])) b--;
    const spoken = text.slice(a, b).replace(LIST, "");
    if (/[\p{L}\p{N}]/u.test(spoken)) out.push({ start: a, end: b, text: spoken });
    start = end;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\n" && (/^\s*\n/.test(text.slice(i + 1)) || LIST.test(text.slice(i + 1)))) {
      add(i);
      continue;
    }
    if (!END.test(c)) continue;
    if (c === ".") {
      const line = text.slice(text.lastIndexOf("\n", i - 1) + 1, i + 1);
      if (/^\s*(?:\d+|[A-Za-z])\.$/.test(line)) continue;
      // Decimals, dotted version numbers, URLs and Latin initials inside words.
      if (/[\p{L}\p{N}]/u.test(text[i - 1] ?? "") && /[\p{L}\p{N}]/u.test(text[i + 1] ?? "")) continue;
    }
    while (i + 1 < text.length && CLOSER.test(text[i + 1])) i++;
    add(i + 1);
  }
  add(text.length);
  return out;
}

/** A segmenter may merge punctuation with a newline or a second sentence. */
export function splitSentenceTokens(tokens: Token[], spans: Sentence[]): Token[] {
  const cuts = [...new Set(spans.flatMap((s) => [s.start, s.end]))].sort((a, b) => a - b);
  const out: Token[] = [];
  let at = 0;
  let cut = 0;
  for (const tk of tokens) {
    const end = at + tk.text.length;
    let from = at;
    while (cut < cuts.length && cuts[cut] <= at) cut++;
    while (cut < cuts.length && cuts[cut] < end) {
      const to = cuts[cut++];
      out.push({ ...tk, text: tk.text.slice(from - at, to - at) });
      from = to;
    }
    if (from < end) out.push({ ...tk, text: tk.text.slice(from - at) });
    at = end;
  }
  return out;
}

export function sentenceGroups(tokens: Token[], spans: Sentence[]) {
  let index = 0;
  let at = 0;
  return spans.map((s) => {
    const before: number[] = [];
    const body: number[] = [];
    while (index < tokens.length && at < s.start) {
      before.push(index); at += tokens[index++].text.length;
    }
    while (index < tokens.length && at < s.end) {
      body.push(index); at += tokens[index++].text.length;
    }
    // Bind the last word + punctuation + controls; the rest can wrap normally.
    const lastWord = body.findLastIndex((i) => tokens[i].wordLike && /[\p{L}\p{N}]/u.test(tokens[i].text));
    const tail = Math.max(0, lastWord);
    return { ...s, before, head: body.slice(0, tail), tail: body.slice(tail) };
  }).concat([{ start: at, end: at, text: "", before: tokens.slice(index).map((_, i) => index + i), head: [], tail: [] }]);
}
