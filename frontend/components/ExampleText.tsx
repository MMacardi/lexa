"use client";

import { Fragment, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { HighlightWord } from "@/components/HighlightWord";
import { WordMeaningPop, type WordPopTarget } from "@/components/WordMeaningPop";
import { toneClass } from "@/components/Pinyin";
import { api, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { errText } from "@/lib/errText";
import { useI18n } from "@/lib/i18n";
import { useExamplePinyin, useToneColors } from "@/lib/learnPrefs";
import { resolveMeaning } from "@/lib/resolveMeaning";
import { segment, type Token } from "@/lib/segment";
import { useToast } from "@/lib/toast";
import { localTranscribe } from "@/lib/transcribe";
import { cn } from "@/lib/utils";

// A line mustn't end on an opening bracket or quote, nor start on a comma or a
// closing one (see the Reader's ruby).
export const OPENS = /[“‘「『《〈【（(\[]/;
export const CLOSES = /[，。！？、；：”’」』》〉】）),.!?;:\]]/;
const HAN = /\p{Script=Han}/u;

// A sentence's words, asked for once per page: the server's segmenter (ICU mended
// with CC-CEDICT, as the Reader uses), or the browser's own when that fails offline.
const words = new Map<string, Promise<Token[]>>();
function wordsOf(text: string): Promise<Token[]> {
  let got = words.get(text);
  if (!got) {
    got = api.segment(text).catch(() => segment(text, "zh"));
    words.set(text, got);
  }
  return got;
}

/**
 * An example sentence with the card's word highlighted and, when the learner
 * turned on "pinyin over examples", the reading over each character. Read from
 * the whole sentence, not character by character, so 长 in 长大 is zhǎng and 了
 * after a verb is le. `hideWordReading` leaves the card's own word bare: on a
 * review card the sentence is support, and the word's sound is the answer.
 *
 * With `targetLang`, every other word of a Chinese sentence can be tapped: its
 * pinyin and meaning (the dictionary first, as in the Reader) and "Add to my
 * words", the sentence kept as the new card's example. Examples are written a step
 * above the learner, so this is where the one unknown word gets caught.
 */
export function ExampleText({
  text,
  word,
  lang,
  targetLang,
  hideWordReading,
}: {
  text: string;
  word: string;
  lang: string;
  targetLang?: string;
  hideWordReading?: boolean;
}) {
  const zh = lang === "zh" || lang === "zh-Hant";
  const on = useExamplePinyin() && zh;
  const tones = useToneColors();
  const [readings, setReadings] = useState<string[] | null>(null);
  const { t } = useI18n();
  const { accountId } = useAccount();
  const { show, trackImport } = useToast();
  const qc = useQueryClient();
  const [pop, setPop] = useState<WordPopTarget | null>(null);
  const [span, setSpan] = useState<{ from: number; to: number } | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());

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

  if (!zh) return <HighlightWord text={text} word={word} />;

  const chars = Array.from(text);
  const ruby = on && readings && readings.length === chars.length ? readings : null;
  const tappable = Boolean(targetLang && accountId);

  // Which characters belong to an occurrence of the card's word.
  const w = Array.from(word.trim());
  const inWord = new Array<boolean>(chars.length).fill(false);
  if (w.length) {
    for (let i = 0; i + w.length <= chars.length; i++) {
      if (w.every((c, j) => chars[i + j] === c)) for (let j = 0; j < w.length; j++) inWord[i + j] = true;
    }
  }

  // The word around character `i`, as the segmenter cut the sentence; the single
  // character when its tokens don't spell the sentence back.
  async function wordAt(i: number): Promise<{ text: string; from: number; to: number } | null> {
    const tokens = await wordsOf(text);
    if (tokens.map((tk) => tk.text).join("") === text) {
      let at = 0;
      for (const tk of tokens) {
        const n = Array.from(tk.text).length;
        if (i < at + n) return tk.wordLike ? { text: tk.text, from: at, to: at + n } : null;
        at += n;
      }
    }
    return { text: chars[i], from: i, to: i + 1 };
  }

  async function open(i: number, anchor: HTMLElement) {
    const got = await wordAt(i);
    // The card's own word is the answer (on the front) or already on screen.
    if (!got || got.text === word.trim() || !targetLang) return;
    const deck = qc.getQueryData<Word[]>(["words", accountId]) ?? [];
    const owned = deck.find((d) => d.word === got.text && d.sourceLang === lang && d.targetLang === targetLang);
    setSpan({ from: got.from, to: got.to });
    const base = { word: got.text, sentence: text, sourceLang: lang, targetLang, anchor };
    if (owned) {
      setPop({ ...base, meaning: owned.meaningZh ?? "", transcription: owned.phonetic ?? "", isNew: false });
      return;
    }
    setPop({ ...base, meaning: "", isNew: true, loading: true });
    try {
      const r = await resolveMeaning({ word: got.text, sentence: text, sourceLang: lang, targetLang });
      // The reading always: an unknown word in a sentence is first a sound to learn.
      const transcription = r.transcription || (await localTranscribe(got.text, lang).catch(() => ""));
      setPop((cur) => (cur?.anchor === anchor ? { ...cur, meaning: r.meaning, transcription, loading: false } : cur));
    } catch {
      setPop((cur) => (cur?.anchor === anchor ? { ...cur, meaning: t("reader.translateFailed"), loading: false, isNew: false } : cur));
    }
  }

  function onTap(e: React.MouseEvent) {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-ci]");
    if (!el) return;
    // Not a flip of the review card, nor a click on whatever holds the sentence.
    e.stopPropagation();
    void open(Number(el.dataset.ci), el);
  }

  // The Reader's capture: the dictionary's card at once, filled in behind, and this
  // sentence as its example (attributed to the card it was met on).
  async function add(target: WordPopTarget) {
    if (adding || !targetLang) return;
    setAdding(true);
    try {
      const r = await api.batchAddWords({
        telegramId: accountId,
        sourceLang: lang,
        targetLang,
        items: [{ word: target.word, sentence: text }],
        source: t("example.tapSource", { word: word.trim() }),
        enrich: true,
      });
      setAdded((s) => new Set([...s, target.word]));
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      if (r.job) trackImport({ jobId: r.job.id, telegramId: accountId, words: [target.word], total: r.job.total, processed: 0 });
      show({ icon: "🌱", title: t("pop.addedToast", { word: target.word }) });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setAdding(false);
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
    const reading = ruby ? (hideWordReading && inWord[i] ? "" : ruby[i]) : "";
    // An explicit break chance after each character: with none between ruby
    // elements, an iPhone sized the text to its longest line and scrolled sideways.
    const brk = !ruby || OPENS.test(chars[i]) || CLOSES.test(chars[i + 1] ?? "") ? null : <wbr />;
    const body = reading ? (
      <ruby>
        {chars[i]}
        <rt
          className={cn(
            "px-px pb-0.5 font-pinyin text-[0.5em] font-normal not-italic leading-none tracking-tight text-ink-faint",
            tones && toneClass(reading),
          )}
        >
          {reading}
        </rt>
      </ruby>
    ) : (
      chars[i]
    );
    const tap = tappable && !inWord[i] && HAN.test(chars[i]);
    const lit = span && i >= span.from && i < span.to;
    return (
      <Fragment key={i}>
        {tap ? (
          <span data-ci={i} className={cn("cursor-pointer rounded-sm", lit ? "bg-sage-tint text-sage-deep" : "hover:bg-sage-tint/70")}>
            {body}
          </span>
        ) : (
          body
        )}
        {brk}
      </Fragment>
    );
  };

  // The line height rides on the inline wrapper, so the readings get room in any
  // paragraph this sits in without the caller knowing pinyin is on.
  return (
    <span className={cn(ruby && "leading-[2.2]")} onClick={tappable ? onTap : undefined}>
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
      {pop && (
        // The popover is portalled to <body>, but React still bubbles its taps up
        // this tree: stopped here, so a tap inside it doesn't flip the review card.
        <span onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
          <WordMeaningPop
            target={pop}
            adding={adding}
            added={added.has(pop.word)}
            onAdd={pop.isNew ? () => void add(pop) : undefined}
            onClose={() => {
              setPop(null);
              setSpan(null);
            }}
          />
        </span>
      )}
    </span>
  );
}
