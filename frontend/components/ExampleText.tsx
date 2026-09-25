"use client";

import { Fragment, useEffect, useState } from "react";
import { HighlightWord } from "@/components/HighlightWord";
import { useExamplePinyin } from "@/lib/learnPrefs";

// A line mustn't end on an opening bracket or quote, nor start on a comma or a
// closing one (see the Reader's ruby).
const OPENS = /[“‘「『《〈【（(\[]/;
const CLOSES = /[，。！？、；：”’」』》〉】）),.!?;:\]]/;

/**
 * An example sentence with the card's word highlighted and, when the learner
 * turned on "pinyin over examples", the reading over each character. Read from
 * the whole sentence, not character by character, so 长 in 长大 is zhǎng and 了
 * after a verb is le. `hideWordReading` leaves the card's own word bare: on a
 * review card the sentence is support, and the word's sound is the answer.
 */
export function ExampleText({
  text,
  word,
  lang,
  hideWordReading,
}: {
  text: string;
  word: string;
  lang: string;
  hideWordReading?: boolean;
}) {
  const on = useExamplePinyin() && (lang === "zh" || lang === "zh-Hant");
  const [readings, setReadings] = useState<string[] | null>(null);

  useEffect(() => {
    if (!on) {
      setReadings(null);
      return;
    }
    let cancelled = false;
    void import("pinyin-pro").then(({ pinyin }) => {
      if (!cancelled) setReadings(pinyin(text, { type: "all" }).map((c) => (c.isZh ? c.pinyin : "")));
    });
    return () => {
      cancelled = true;
    };
  }, [on, text]);

  const chars = Array.from(text);
  if (!on || !readings || readings.length !== chars.length) return <HighlightWord text={text} word={word} />;

  // Which characters belong to an occurrence of the card's word.
  const w = Array.from(word.trim());
  const inWord = new Array<boolean>(chars.length).fill(false);
  if (w.length) {
    for (let i = 0; i + w.length <= chars.length; i++) {
      if (w.every((c, j) => chars[i + j] === c)) for (let j = 0; j < w.length; j++) inWord[i + j] = true;
    }
  }

  // Runs of highlighted / plain characters, so the highlight stays one mark per word.
  const runs: { hl: boolean; from: number; to: number }[] = [];
  chars.forEach((_, i) => {
    const last = runs[runs.length - 1];
    if (last && last.hl === inWord[i]) last.to = i + 1;
    else runs.push({ hl: inWord[i], from: i, to: i + 1 });
  });

  const charNode = (i: number) => {
    const reading = hideWordReading && inWord[i] ? "" : readings[i];
    // An explicit break chance after each character: with none between ruby
    // elements, an iPhone sized the text to its longest line and scrolled sideways.
    const brk = OPENS.test(chars[i]) || CLOSES.test(chars[i + 1] ?? "") ? null : <wbr />;
    if (!reading)
      return (
        <Fragment key={i}>
          {chars[i]}
          {brk}
        </Fragment>
      );
    return (
      <Fragment key={i}>
        <ruby>
          {chars[i]}
          <rt className="pb-0.5 font-sans text-[0.5em] font-normal not-italic leading-none tracking-tight text-ink-faint">{reading}</rt>
        </ruby>
        {brk}
      </Fragment>
    );
  };

  // The line height rides on the inline wrapper, so the readings get room in any
  // paragraph this sits in without the caller knowing pinyin is on.
  return (
    <span className="leading-[2.2]">
      {runs.map((r) => {
        const nodes = [];
        for (let i = r.from; i < r.to; i++) nodes.push(charNode(i));
        return r.hl ? (
          <mark key={r.from} className="rounded bg-news-hl px-1 font-semibold text-sage-deep">
            {nodes}
          </mark>
        ) : (
          <Fragment key={r.from}>{nodes}</Fragment>
        );
      })}
    </span>
  );
}
