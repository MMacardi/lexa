"use client";

import { Fragment, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { mikaDisplayText } from "@/lib/mikaPinyin";

const readingCache = new Map<string, Map<number, string>>();
let pinyinModule: Promise<typeof import("pinyin-pro")> | undefined;
function InlineText({ text, ruby }: { text: string; ruby: boolean }) {
  const [reading, setReading] = useState<{ text: string; map: Map<number, string> } | null>(null);
  useEffect(() => {
    if (!ruby || !/\p{Script=Han}/u.test(text)) return;
    let cancelled = false;
    void (pinyinModule ??= import("pinyin-pro")).then(({ pinyin }) => {
      if (cancelled) return;
      let map = readingCache.get(text);
      if (!map) {
        map = new Map();
        // Formatting can split a polyphonic word (银**行**). Read the entire
        // visible line, then map its syllables back into the marked-up source.
        const positions: number[] = [];
        let visible = "";
        for (let i = 0; i < text.length; i++) {
          if (text[i] === "*" || text[i] === "`") continue;
          positions.push(i);
          visible += text[i];
        }
        let offset = 0;
        for (const item of pinyin(visible, { type: "all" })) {
          if (item.isZh) map.set(positions[offset], item.pinyin);
          offset += item.origin.length;
        }
        // The bundled dictionary reads 还给 as hái gěi; in this verb phrase
        // (return something to someone) it is huán gěi.
        for (const match of visible.matchAll(/还给/g)) map.set(positions[match.index], "huán");
        if (readingCache.size >= 512) readingCache.delete(readingCache.keys().next().value!);
        readingCache.set(text, map);
      }
      setReading({ text, map });
    }).catch(() => { /* Plain characters remain readable if the chunk cannot load. */ });
    return () => { cancelled = true; };
  }, [text, ruby]);
  const map = ruby && reading?.text === text ? reading.map : null;
  return <>{inline(text, map)}</>;
}

// Tiny, safe markdown renderer for chat replies: **bold**, *italic*, `code`,
// numbered/bulleted lists and line breaks. Builds React nodes (no innerHTML).
function inline(text: string, readings: Map<number, string> | null): ReactNode[] {
  const plain = (value: string, start: number): ReactNode => {
    if (!readings) return value;
    let offset = start;
    return Array.from(value).map((char) => {
      const at = offset;
      offset += char.length;
      const reading = readings.get(at);
      return reading ? <Fragment key={at}><ruby>{char}<rt className="select-none px-px pb-0.5 font-pinyin text-[0.55em] font-normal not-italic leading-none tracking-tight text-ink-faint">{reading}</rt></ruby>{/[，。！？、；：,.!?;:）)」』”’]/.test(text[offset] ?? "") ? null : <wbr />}</Fragment> : char;
    });
  };
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(plain(text.slice(last, m.index), last));
    if (m[1]) out.push(<strong key={key++}>{plain(m[1], m.index + 2)}</strong>);
    else if (m[2]) out.push(<em key={key++}>{plain(m[2], m.index + 1)}</em>);
    else if (m[3])
      out.push(
        <code key={key++} className="rounded bg-black/[0.06] px-1 py-0.5 text-[0.9em]">
          {plain(m[3], m.index + 1)}
        </code>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(plain(text.slice(last), last));
  return out;
}

// While an answer is still streaming, the last line is half-written: a `**bold**`
// in progress would show its asterisks and then snap. Close whatever marker hasn't
// found its pair yet (and hide an opener whose first character hasn't arrived), so
// the text grows already formatted instead of flickering.
function closeMarkers(text: string): string {
  let out = text.replace(/[*`]+$/, "");
  if ((out.match(/`/g) ?? []).length % 2) out += "`";
  if ((out.match(/\*\*/g) ?? []).length % 2) out += "**";
  if ((out.replace(/\*\*/g, "").match(/\*/g) ?? []).length % 2) out += "*";
  return out;
}

export function RichText({ text, className, streaming = false, mika = false, pinyin = false }: { text: string; className?: string; streaming?: boolean; mika?: boolean; pinyin?: boolean }) {
  // A literal "\n" is a line break the model escaped twice: the backend fixes final
  // answers, this covers text still streaming in and chats saved before that.
  const lines = (mika ? mikaDisplayText(text) : text).split(/\r?\n|(?:\\r)?\\n/);
  // A line indented under a list item belongs to it — the pinyin and translation
  // under an example sentence, the "→ usage" under a word — so it sits in the item's
  // column, quieter than the item itself.
  // `mark[i]` is the list marker a line hangs from: its own ("1.", "•"), or for an
  // indented line the item's above it, drawn invisibly to line the text up.
  const mark: (string | null)[] = [];
  const under: boolean[] = [];
  lines.forEach((l, i) => {
    const m = l.match(/^\s*(?:(\d+)[.)]|[-*•])\s+/);
    under[i] = !m && /^(\s{2,}|\t)\S/.test(l) && i > 0 && mark[i - 1] !== null;
    mark[i] = m ? (m[1] ? `${m[1]}.` : "•") : under[i] ? mark[i - 1] : null;
  });
  return (
    <div data-mika-reply={mika || undefined} className={cn("space-y-1.5 break-words", pinyin && "[&_ruby]:leading-[2.4]", className)} onCopy={mika ? (event) => {
      const selection = window.getSelection();
      if (!selection?.rangeCount || selection.isCollapsed) return;
      const fragment = selection.getRangeAt(0).cloneContents();
      fragment.querySelectorAll("rt, [aria-hidden]").forEach(node => node.remove());
      const plain = (node: Node): string => node.nodeType === Node.TEXT_NODE ? node.textContent ?? "" :
        Array.from(node.childNodes).map(plain).join("") + (node instanceof Element && /^(DIV|P|BR)$/.test(node.tagName) ? "\n" : "");
      event.clipboardData.setData("text/plain", plain(fragment).trim());
      event.preventDefault();
    } : undefined}>
      {lines.map((line, i) => {
        // Only the line being written right now can hold an unclosed marker.
        const fix = (v: string) => (streaming && i === lines.length - 1 ? closeMarkers(v) : v);
        // Only settled lines get readings; the unfinished tail stays plain until a
        // newline/final response arrives, so no transcription runs per token.
        const render = (v: string) => <InlineText text={fix(v)} ruby={pinyin && !(streaming && i === lines.length - 1)} />;
        if (under[i]) {
          return (
            <div key={i} className="-mt-1 flex gap-2 text-ink-soft">
              <span aria-hidden className={cn("invisible shrink-0", mark[i] !== "•" && "font-semibold")}>{mark[i]}</span>
              <span className="min-w-0 leading-relaxed">{render(line.trim())}</span>
            </div>
          );
        }
        const num = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
        if (num) {
          return (
            <div key={i} className="flex gap-2">
              <span className="shrink-0 font-semibold text-ink-faint">{num[1]}.</span>
              <span className="min-w-0">{render(num[2])}</span>
            </div>
          );
        }
        // Headings and rules (the photo model likes them): a bold line, a gap.
        const head = line.match(/^\s*#{1,4}\s+(.*)$/);
        if (head) {
          return (
            <p key={i} className="pt-1 font-semibold leading-relaxed">
              {render(head[1])}
            </p>
          );
        }
        if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) return <div key={i} className="h-1.5" />;
        const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2">
              <span className="shrink-0 text-ink-faint">•</span>
              <span className="min-w-0">{render(bullet[1])}</span>
            </div>
          );
        }
        if (!line.trim()) return <div key={i} className="h-1.5" />;
        return (
          <p key={i} className="leading-relaxed">
            <Fragment>{render(line)}</Fragment>
          </p>
        );
      })}
    </div>
  );
}
