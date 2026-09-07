"use client";

import { useEffect, useRef, useState } from "react";
import { recognizeOnce, dictationSupported, speechLang, type DictationController } from "@/lib/dictation";
import { scorePronunciation, type PronounceScore } from "@/lib/pronounce";
import { useI18n } from "@/lib/i18n";
import { HoverTip } from "@/components/ui/HoverTip";
import { cn } from "@/lib/utils";
import { Mic, Square } from "lucide-react";

// 🎤 pronunciation self-check: say the word, the browser's speech recogniser
// transcribes it, and we score how close it sounded (text as a proxy — encouraging,
// not clinical). Renders nothing when the browser has no recogniser. Free.
export function PronounceButton({
  text,
  lang,
  size = "md",
  className,
}: {
  text: string;
  lang: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const { t } = useI18n();
  const [ok, setOk] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [result, setResult] = useState<PronounceScore | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ctrlRef = useRef<DictationController | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => setOk(dictationSupported()), []);
  useEffect(() => () => ctrlRef.current?.stop(), []); // stop on unmount

  // Dismiss the feedback popover on outside tap / Esc (but not mid-listen).
  useEffect(() => {
    if (listening || (!result && !err)) return;
    const close = () => {
      setResult(null);
      setErr(null);
    };
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) close();
    };
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onEsc);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onEsc);
    };
  }, [listening, result, err]);

  if (!ok) return null;

  const start = () => {
    if (listening) {
      ctrlRef.current?.stop();
      return;
    }
    setResult(null);
    setErr(null);
    setInterim("");
    const ctrl = recognizeOnce({
      lang: speechLang(lang),
      onInterim: setInterim,
      onResult: (cands) => {
        setInterim("");
        if (!cands.length) {
          setErr(t("pron.nothing"));
          return;
        }
        setResult(scorePronunciation(text, cands));
      },
      onError: (kind) => {
        setListening(false);
        setErr(kind === "unsupported" ? t("pron.unsupported") : t("pron.nothing"));
      },
      onEnd: () => setListening(false),
    });
    if (ctrl) {
      ctrlRef.current = ctrl;
      setListening(true);
    }
  };

  const dim = size === "sm" ? "h-7 w-7 text-[13px]" : "h-9 w-9 text-[16px]";
  const bandCls = result?.band === "great" ? "text-sage-deep" : "text-warn-text";
  const bandKey = result ? (result.band === "great" ? "pron.great" : result.band === "close" ? "pron.close" : "pron.off") : "";
  const open = listening || !!result || !!err;

  return (
    <span ref={wrapRef} className={cn("relative inline-flex", className)}>
      <HoverTip title={t("pron.check")} className="inline-flex">
        <button
          type="button"
          onClick={start}
          aria-label={t("pron.check")}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full border transition-colors active:scale-95",
            listening
              ? "animate-pulse border-warn/50 bg-warn-bg text-warn-text"
              : "border-black/[0.08] bg-surface text-sage-deep hover:bg-sage-tint",
            dim,
          )}
        >
          {listening ? <Square className="h-[0.9em] w-[0.9em]" /> : <Mic className="h-[1em] w-[1em]" />}
        </button>
      </HoverTip>

      {open && (
        <span className="anim-popover absolute left-0 top-full z-30 mt-2 w-max max-w-[240px] rounded-[12px] border border-black/[0.08] bg-surface px-3 py-2 text-left shadow-[0_14px_40px_rgba(46,42,38,0.2)]">
          {listening ? (
            <span className="block text-[13px] text-ink-soft">{interim || t("pron.listening")}</span>
          ) : err ? (
            <span className="block text-[13px] text-ink-soft">{err}</span>
          ) : result ? (
            <>
              <span className={cn("block text-[13px] font-semibold", bandCls)}>
                {t(bandKey)} · {Math.round(result.score * 100)}%
              </span>
              {result.heard && (
                <span className="mt-0.5 block text-[12px] text-ink-faint">{t("pron.heard", { heard: result.heard })}</span>
              )}
              <button type="button" onClick={start} className="mt-1.5 text-[12px] font-semibold text-sage hover:text-sage-deep">
                {t("pron.again")}
              </button>
            </>
          ) : null}
        </span>
      )}
    </span>
  );
}
