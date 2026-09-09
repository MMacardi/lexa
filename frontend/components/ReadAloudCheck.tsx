"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { recorderSupported, startRecording, type Recording } from "@/lib/record";
import { scorePronunciation, type PronounceScore } from "@/lib/pronounce";
import { cn } from "@/lib/utils";
import { Mic, Square, Loader2 } from "lucide-react";

// Read-aloud practice for the Reader: each sentence of the text gets a mic —
// read it out loud, and the SERVER transcribes (qwen-audio-asr via /api/coach/stt)
// and scores how close it sounded. Unlike the browser recogniser this works on
// mobile (iOS included) and in mainland China without a VPN.
type RowState =
  | { kind: "idle" }
  | { kind: "recording" }
  | { kind: "checking" }
  | { kind: "result"; score: PronounceScore }
  | { kind: "error"; message: string };

export function ReadAloudCheck({ sentences, lang, hiddenCount = 0 }: { sentences: string[]; lang: string; hiddenCount?: number }) {
  const { t } = useI18n();
  const [ok, setOk] = useState(false);
  const [rows, setRows] = useState<RowState[]>(() => sentences.map(() => ({ kind: "idle" })));
  const recRef = useRef<{ index: number; rec: Recording } | null>(null);

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
        setRow(i, { kind: "result", score: scorePronunciation(sentences[i], [text]) });
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
      const rec = await startRecording({ maxMs: 20000 });
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
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-ink-faint">{t("reader.readAloudHint")}</p>

      <div className="mt-3 space-y-1.5">
        {sentences.map((s, i) => {
          const row = rows[i] ?? { kind: "idle" as const };
          return (
            <div key={i} className="rounded-[14px] border border-black/[0.05] bg-paper/60 px-3.5 py-2.5">
              <div className="flex items-start gap-2.5">
                <p className="min-w-0 flex-1 text-[14.5px] leading-relaxed text-ink">{s}</p>
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
              {row.kind === "result" && (
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
