"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { recorderSupported, startRecording, type Recording } from "@/lib/record";
import { compareRead, scorePronunciation, type PronounceScore, type ReadCheck, type ReadWord } from "@/lib/pronounce";
import { segment } from "@/lib/segment";
import { setReadAloudPinyin, useReadAloudPinyin, useToneColors } from "@/lib/learnPrefs";
import { CLOSES, OPENS } from "@/components/ExampleText";
import { Pinyin, toneClass } from "@/components/Pinyin";
import { SpeakButton } from "@/components/SpeakButton";
import { cn } from "@/lib/utils";
import { Baseline, Mic, Square, Loader2 } from "lucide-react";

// Read-aloud practice for the Reader: each sentence of the text gets a mic —
// read it out loud, and the SERVER transcribes (qwen3-asr-flash via /api/coach/stt).
// Unlike the browser recogniser this works on mobile (iOS included) and in mainland
// China without a VPN. Chinese gets its answer word by word (lib/pronounce.ts
// compareRead): the words a listener would hear as other words, each with its pinyin
// next to the pinyin of what was heard, and the words the recording doesn't have.
// Other languages keep the overall closeness score. Chinese sentences can carry
// their pinyin (the card's own switch, remembered).
type RowState =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "checking" }
  | { kind: "result"; score: PronounceScore; read?: ReadCheck }
  | { kind: "error"; message: string };

export function ReadAloudCheck({ sentences, lang, hiddenCount = 0 }: { sentences: string[]; lang: string; hiddenCount?: number }) {
  const { t } = useI18n();
  const [ok, setOk] = useState(false);
  const [rows, setRows] = useState<RowState[]>(() => sentences.map(() => ({ kind: "idle" })));
  const recRef = useRef<{ index: number; rec: Recording } | null>(null);
  const zh = lang === "zh" || lang === "zh-Hant";
  const pinyinOn = useReadAloudPinyin() && zh;

  useEffect(() => setOk(recorderSupported()), []);
  // Sentences changed (new text) → fresh rows.
  useEffect(() => setRows(sentences.map(() => ({ kind: "idle" }))), [sentences]);
  useEffect(
    () => () => {
      recRef.current?.rec.stop().catch(() => {});
    },
    [],
  );

  if (!ok) return null;

  const setRow = (i: number, s: RowState) => setRows((cur) => cur.map((r, j) => (j === i ? s : r)));

  async function toggle(i: number) {
    if (recRef.current?.index === i) {
      // Second tap = stop and check.
      const { rec } = recRef.current;
      recRef.current = null;
      setRow(i, { kind: "checking" });
      try {
        const audio = await rec.stop();
        const { text } = await api.stt({ audio: audio.base64, format: audio.format, sourceLang: lang });
        if (!text.trim()) {
          setRow(i, { kind: "error", message: t("pron.nothing") });
          return;
        }
        const score = scorePronunciation(sentences[i], [text]);
        const read = zh
          ? await compareRead(await api.segment(sentences[i]).catch(() => segment(sentences[i], lang)), text).catch(() => undefined)
          : undefined;
        setRow(i, { kind: "result", score, read });
      } catch (e) {
        const msg = (e as Error)?.message ?? "";
        setRow(i, { kind: "error", message: msg === "denied" ? t("pron.denied") : msg === "empty" ? t("pron.nothing") : t("pron.checkFailed") });
      }
      return;
    }
    // Another row is recording → stop it without checking (only one mic at a time).
    if (recRef.current) {
      const prev = recRef.current;
      recRef.current = null;
      prev.rec.stop().catch(() => {});
      setRow(prev.index, { kind: "idle" });
    }
    try {
      // A minute a sentence, and checked the moment the cap is hit: at 20 s the mic
      // went quiet while the button still pulsed, and the end of the reading was lost.
      const rec: Recording = await startRecording({
        maxMs: 60000,
        onAutoStop: () => {
          if (recRef.current?.rec === rec) void toggle(i);
        },
      });
      recRef.current = { index: i, rec };
      setRow(i, { kind: "recording" });
    } catch (e) {
      setRow(i, { kind: "error", message: (e as Error)?.message === "denied" ? t("pron.denied") : t("pron.checkFailed") });
    }
  }

  return (
    <div className="rounded-[20px] border border-black/[0.06] bg-surface p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Mic className="h-4 w-4 text-sage-deep" />
        <h3 className="font-serif text-[17px] font-medium text-ink">{t("reader.readAloud")}</h3>
        {zh && (
          <button
            type="button"
            onClick={() => setReadAloudPinyin(!pinyinOn)}
            aria-pressed={pinyinOn}
            className={cn(
              "ml-auto inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
              pinyinOn ? "border-sage bg-sage-tint text-sage-deep" : "border-black/[0.08] bg-surface text-ink-muted hover:bg-black/[0.03]",
            )}
          >
            <Baseline className="h-3.5 w-3.5" />
            {t("reader.ruby")}
          </button>
        )}
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-ink-faint">{t("reader.readAloudHint")}</p>

      <div className="mt-3 space-y-1.5">
        {sentences.map((s, i) => {
          const row = rows[i] ?? { kind: "idle" as const };
          return (
            <div key={i} className="rounded-[14px] border border-black/[0.05] bg-paper/60 px-3.5 py-2.5">
              <div className="flex items-start gap-2.5">
                <SentenceText
                  text={s}
                  words={row.kind === "result" ? row.read?.words : undefined}
                  zh={zh}
                  pinyin={pinyinOn}
                />
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  aria-label={t("pron.check")}
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors active:scale-95",
                    row.kind === "recording"
                      ? "animate-pulse border-warn/50 bg-warn-bg text-warn-text"
                      : "border-black/[0.08] bg-surface text-sage-deep hover:bg-sage-tint",
                  )}
                >
                  {row.kind === "recording" ? (
                    <Square className="h-3.5 w-3.5 fill-current" />
                  ) : row.kind === "checking" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Mic className="h-4 w-4" />
                  )}
                </button>
              </div>
              {row.kind === "recording" && (
                <div className="mt-1 text-[12px] font-medium text-warn-text">{t("pron.recording")}</div>
              )}
              {row.kind === "error" && <div className="mt-1 text-[12px] text-warn-text">{row.message}</div>}
              {row.kind === "result" && row.read && <ReadResult read={row.read} heard={row.score.heard} lang={lang} again={() => toggle(i)} />}
              {row.kind === "result" && !row.read && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span
                    className={cn(
                      "text-[12.5px] font-semibold",
                      row.score.band === "great" ? "text-sage-deep" : "text-warn-text",
                    )}
                  >
                    {row.score.band === "great" ? t("pron.great") : row.score.band === "close" ? t("pron.close") : t("pron.off")}
                    {" · "}
                    {Math.round(row.score.score * 100)}%
                  </span>
                  {row.score.heard && (
                    <span className="text-[12px] text-ink-faint">{t("pron.heard", { heard: row.score.heard })}</span>
                  )}
                  <button type="button" onClick={() => toggle(i)} className="text-[12px] font-semibold text-sage hover:text-sage-deep">
                    {t("pron.again")}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {hiddenCount > 0 && (
        <p className="mt-2 text-center text-[12px] text-ink-faint">{t("reader.readAloudMore", { n: String(hiddenCount) })}</p>
      )}
    </div>
  );
}

// The sentence as its row shows it — after a check, word by word, the misheard ones
// underlined and the missed ones grey — with, when the switch is on, the reading over
// each character. Read from the whole sentence, as on an example, so 了 and 长 read
// right; an explicit break chance after each character, or a phone sizes the row to
// the sentence and scrolls sideways (see ExampleText).
function SentenceText({ text, words, zh, pinyin: on }: { text: string; words?: ReadWord[]; zh: boolean; pinyin: boolean }) {
  const tones = useToneColors();
  const full = words ? words.map((w) => w.text).join("") : text;
  const [readings, setReadings] = useState<{ of: string; list: string[] } | null>(null);

  useEffect(() => {
    if (!on) return;
    let cancelled = false;
    void import("pinyin-pro").then(({ pinyin }) => {
      if (!cancelled) setReadings({ of: full, list: pinyin(full, { type: "all" }).map((c) => (c.isZh ? c.pinyin : "")) });
    });
    return () => {
      cancelled = true;
    };
  }, [on, full]);

  const chars = Array.from(full);
  const ruby = on && readings?.of === full && readings.list.length === chars.length ? readings.list : null;
  let at = 0;
  const piece = (part: string) => {
    const from = at;
    const own = Array.from(part);
    at += own.length;
    if (!ruby) return part;
    return own.map((c, k) => {
      const i = from + k;
      const brk = OPENS.test(c) || CLOSES.test(chars[i + 1] ?? "") ? null : <wbr />;
      return (
        <Fragment key={k}>
          {ruby[i] ? (
            <ruby>
              {c}
              <rt className={cn("px-px pb-0.5 font-pinyin text-[0.6em] font-normal leading-none tracking-tight text-ink-faint", tones && toneClass(ruby[i]))}>
                {ruby[i]}
              </rt>
            </ruby>
          ) : (
            c
          )}
          {brk}
        </Fragment>
      );
    });
  };

  return (
    <p className={cn("min-w-0 flex-1 text-ink", zh ? "text-[18px]" : "text-[14.5px]", ruby ? "leading-[2.4]" : "leading-relaxed")}>
      {words
        ? words.map((w, k) => (
            <span
              key={k}
              className={cn(
                w.status === "misheard" && "underline decoration-warn-text decoration-2 underline-offset-4",
                w.status === "missed" && "text-ink-faint",
              )}
            >
              {piece(w.text)}
            </span>
          ))
        : piece(text)}
    </p>
  );
}

// Word by word: how many came through, then each misheard word with its pinyin and
// the pinyin of what was heard, in tone colours — 海鸥 hǎi ōu · sounded like 好后 hǎo hòu.
function ReadResult({ read, heard, lang, again }: { read: ReadCheck; heard: string; lang: string; again: () => void }) {
  const { t } = useI18n();
  const misheard = read.words.filter((w) => w.status === "misheard");
  const missed = read.words.some((w) => w.status === "missed");
  const all = read.total > 0 && read.understood === read.total;
  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className={cn("text-[12.5px] font-semibold", all ? "text-sage-deep" : "text-warn-text")}>
          {all ? t("pron.allUnderstood") : t("pron.understood", { n: String(read.understood), total: String(read.total) })}
        </span>
        <button type="button" onClick={again} className="text-[12px] font-semibold text-sage hover:text-sage-deep">
          {t("pron.again")}
        </button>
      </div>
      {misheard.length > 0 && (
        <ul className="mt-1 space-y-0.5">
          {misheard.map((w, k) => (
            <li key={k} className="flex flex-wrap items-center gap-x-2 text-[13px] leading-snug">
              {/* Two halves that wrap whole: the word as it should sound, then what was heard. */}
              <span className="inline-flex items-center gap-1.5">
                <span className="font-medium text-ink">{w.text}</span>
                {w.pinyin && <Pinyin text={w.pinyin} className="text-ink-soft" />}
                <SpeakButton text={w.text} lang={lang} size="inline" />
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="text-ink-faint">{t("pron.soundsLike")}</span>
                <span className="text-ink-soft">{w.heard}</span>
                {w.heardPinyin && <Pinyin text={w.heardPinyin} className="text-ink-faint" />}
              </span>
            </li>
          ))}
        </ul>
      )}
      {missed && <p className="mt-1 text-[12px] text-ink-faint">{t("pron.missedHint")}</p>}
      {heard && <p className="mt-0.5 text-[12px] text-ink-faint">{t("pron.heard", { heard })}</p>}
    </div>
  );
}
