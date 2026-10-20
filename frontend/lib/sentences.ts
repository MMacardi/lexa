import type { Token } from "./segment";

export type Sentence = { start: number; end: number; text: string };
const END = /[.!?。！？…]/;
const CLOSER = /[.!?。！？…"'”’」』》〉】）)\]]/;
const LIST = /^[ \t]*(?:\d+[.)、．）](?!\d)|[（(]\d+[)）]|[A-Za-z][.)、．）])[ \t]*/;

/** Source offsets are retained so punctuation and paragraph whitespace stay intact. */
export function sentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const markers = new Map<number, number>();
  let lineStart = 0;
  for (const line of text.split("\n")) {
    const label = line.match(LIST);
    if (label) {
      markers.set(lineStart, lineStart + label[0].length);
      // Printed exercises also put A/B/C choices together on the question line.
      for (const option of line.matchAll(/(?<=\s)[A-F][.)、．）][ \t]*/g)) {
        markers.set(lineStart + option.index, lineStart + option.index + option[0].length);
      }
    }
    lineStart += line.length + 1;
  }
  let start = 0;
  const add = (end: number) => {
    let a = start;
    while (a < end && /\s/.test(text[a])) a++;
    let b = end;
    while (b > a && /\s/.test(text[b - 1])) b--;
    const spoken = text.slice(a, b);
    if (/\p{L}/u.test(spoken)) out.push({ start: a, end: b, text: spoken });
    start = end;
  };
  for (let i = 0; i < text.length; i++) {
    const markerEnd = markers.get(i);
    if (markerEnd !== undefined) {
      add(i);
      start = markerEnd;
      i = markerEnd - 1;
      continue;
    }
    const c = text[i];
    if (c === "\n") {
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

// Below the backend's 300-character cap: full-size Qwen chunks can time out.
export const SPEECH_CHUNK_CHARS = 120;

/** Provider chunks are separate from logical units: no extra Reader controls. */
export function speechChunks(text: string): Sentence[] {
  const chunks: Sentence[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + SPEECH_CHUNK_CHARS, text.length);
    if (end < text.length) {
      // Prefer a source pause near the limit, then a word boundary, then a hard cut.
      const floor = start + Math.floor(SPEECH_CHUNK_CHARS / 2);
      let pause = 0, space = 0;
      for (let i = floor; i < end; i++) {
        if (/[\n。！？!?；;，,、：:]/.test(text[i])) pause = i + 1;
        else if (/\s/.test(text[i])) space = i + 1;
      }
      end = pause || space || end;
      if (/[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) end--;
    }
    chunks.push({ start, end, text: text.slice(start, end) });
    start = end;
  }
  return chunks;
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
