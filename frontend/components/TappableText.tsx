"use client";

import { useMemo } from "react";
import { segment, type Token } from "@/lib/segment";
import type { WordMatcher } from "@/lib/wordMatch";
import { cn } from "@/lib/utils";

export type WordEntry = { meaning: string; isNew: boolean };

// A bubble's text, rendered so the vocabulary visibly "lives" in the talk:
//  - words already in play (the learner's candidates + words Onomika just introduced)
//    are highlighted and tappable, exactly as before — used ones glow green, brand-new
//    ones amber;
//  - when `tapAny` is on, EVERY other word is quietly tappable too, for an instant
//    gloss + one-tap add to the deck (the Reader's mechanic, inside the Coach).
// The two passes are layered rather than merged: highlighting still uses the
// inflection-tolerant matcher, so multi-word entries ("get by") survive tokenization.
export function TappableText({
  text,
  lang,
  matcher,
  used,
  entries,
  tapAny,
  onKnown,
  onUnknown,
}: {
  text: string;
  lang: string;
  matcher: WordMatcher;
  used: Set<string>;
  entries: Map<string, WordEntry>;
  tapAny: boolean;
  onKnown: (canonical: string, el: HTMLElement) => void;
  onUnknown: (token: string, el: HTMLElement) => void;
}) {
  type Chunk =
    | { kind: "known"; surface: string; canonical: string }
    | { kind: "tokens"; tokens: Token[] }
    | { kind: "plain"; text: string };

  const chunks = useMemo<Chunk[]>(() => {
    const raw = matcher.regex ? text.split(matcher.regex) : [text];
    const out: Chunk[] = [];
    for (const p of raw) {
      if (!p) continue;
      const canonical = matcher.canonical(p);
      if (canonical) out.push({ kind: "known", surface: p, canonical });
      else if (!tapAny) out.push({ kind: "plain", text: p });
      else out.push({ kind: "tokens", tokens: segment(p, lang) });
    }
    return out;
  }, [text, matcher, lang, tapAny]);

  return (
    <>
      {chunks.map((c, i) => {
        if (c.kind === "plain") return <span key={i}>{c.text}</span>;

        if (c.kind === "known") {
          const key = c.canonical.trim().toLowerCase();
          const isNew = entries.get(key)?.isNew;
          const hit = !isNew && used.has(key);
          const fire = (el: HTMLElement) => onKnown(c.canonical, el);
          return (
            <span
              key={i}
              role="button"
              tabIndex={0}
              onClick={(e) => fire(e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fire(e.currentTarget);
                }
              }}
              className={cn(
                "cursor-pointer rounded-md px-1 py-0.5 font-semibold transition-colors",
                isNew
                  ? "bg-warn-bg text-warn-text ring-1 ring-inset ring-warn/30"
                  : hit
                    ? "bg-sage text-white"
                    : "bg-sage-tint text-sage-deep",
              )}
            >
              {c.surface}
            </span>
          );
        }

        return (
          <span key={i}>
            {c.tokens.map((tk, j) => {
              // Numbers, punctuation and separators stay inert — nothing to gloss.
              if (!tk.wordLike || /^[\p{N}\p{M}\s]+$/u.test(tk.text)) return <span key={j}>{tk.text}</span>;
              const fire = (el: HTMLElement) => onUnknown(tk.text, el);
              return (
                <span
                  key={j}
                  role="button"
                  tabIndex={-1}
                  onClick={(e) => fire(e.currentTarget)}
                  className="-mx-[1px] cursor-pointer rounded-[3px] px-[1px] transition-colors hover:bg-sage-tint/70 active:bg-sage-tint"
                >
                  {tk.text}
                </span>
              );
            })}
          </span>
        );
      })}
    </>
  );
}
