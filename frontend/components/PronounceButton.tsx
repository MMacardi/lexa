"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { recognizeOnce, dictationSupported, speechLang, type DictationController } from "@/lib/dictation";
import { recorderSupported, startRecording, type Recording } from "@/lib/record";
import { resolveMicEngine } from "@/lib/micEngine";
import { markMicBrowserFailed } from "@/lib/learnPrefs";
import { scorePronunciation, type PronounceScore } from "@/lib/pronounce";
import { useI18n } from "@/lib/i18n";
import { HoverTip } from "@/components/ui/HoverTip";
import { cn } from "@/lib/utils";
import { Mic, Square, Loader2 } from "lucide-react";
import { usePresence } from "@/lib/motion";

// 🎤 pronunciation self-check: say the word, we transcribe it and score how close it
// sounded (text as a proxy — encouraging, not clinical). Engine is resolved per the
// learner's mic pref: the browser recogniser where it works, else our server STT
// (qwen3-asr) — which is what finally makes this work on iPhone and in mainland China.
// Renders nothing when neither engine is available.
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
  const [checking, setChecking] = useState(false); // server path: recorded, awaiting STT
  const [interim, setInterim] = useState("");
  const [result, setResult] = useState<PronounceScore | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const ctrlRef = useRef<DictationController | null>(null);
  const recRef = useRef<Recording | null>(null);
  const engineRef = useRef<"browser" | "server">("browser");
  const mountedRef = useRef(true);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => setOk(dictationSupported() || recorderSupported()), []);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try {
        ctrlRef.current?.stop();
      } catch {
        /* ignore */
      }
      recRef.current?.stop().catch(() => {});
      recRef.current = null;
    };
  }, []);

  // Dismiss the feedback popover on outside tap / Esc (but not mid-capture).
  useEffect(() => {
    if (listening || checking || (!result && !err)) return;
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
  }, [listening, checking, result, err]);

  const open = listening || checking || !!result || !!err;
  const pop = usePresence(open);
  // What the bubble last showed — see where it's filled in below.
  const lastBody = useRef<React.ReactNode>(null);

  // The bubble hangs from the button's left edge. Near the right side of the
  // screen (the mic in a flashcard's corner) that ran it off the edge, so it is
  // pulled back to stay inside the screen.
  const popRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const w = wrapRef.current;
    const m = popRef.current;
    if (!w || !m) return;
    const left = w.getBoundingClientRect().left;
    const right = document.documentElement.clientWidth - 8;
    const next = Math.max(8 - left, Math.min(0, right - (left + m.offsetWidth)));
    setShift((s) => (s === next ? s : next));
  });

  if (!ok) return null;

  const startBrowser = () => {
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
        // Browser recogniser failed — make "auto" prefer the server engine next time.
        markMicBrowserFailed();
        setListening(false);
        setErr(kind === "unsupported" ? t("pron.unsupported") : t("mic.browserFailed"));
      },
      onEnd: () => setListening(false),
    });
    if (ctrl) {
      ctrlRef.current = ctrl;
      setListening(true);
    } else {
      markMicBrowserFailed();
      setErr(t("pron.unsupported"));
    }
  };

  const startServer = async () => {
    try {
      const rec = await startRecording({ maxMs: 8000 });
      if (!mountedRef.current) {
        rec.stop().catch(() => {});
        return;
      }
      recRef.current = rec;
      setListening(true);
    } catch (e) {
      setListening(false);
      setErr((e as Error)?.message === "denied" ? t("pron.denied") : t("pron.checkFailed"));
    }
  };

  const stopServer = async () => {
    const rec = recRef.current;
    recRef.current = null;
    setListening(false);
    if (!rec) return;
    setChecking(true);
    try {
      const audio = await rec.stop();
      const { text: transcript } = await api.stt({ audio: audio.base64, format: audio.format, sourceLang: lang });
      if (!mountedRef.current) return;
      if (!transcript.trim()) {
        setErr(t("pron.nothing"));
        return;
      }
      setResult(scorePronunciation(text, [transcript]));
    } catch (e) {
      if (!mountedRef.current) return;
      const msg = (e as Error)?.message ?? "";
      setErr(msg === "denied" ? t("pron.denied") : msg === "empty" ? t("pron.nothing") : t("pron.checkFailed"));
    } finally {
      if (mountedRef.current) setChecking(false);
    }
  };

  const start = () => {
    // A capture is running → stop it (server path then transcribes).
    if (listening) {
      if (engineRef.current === "server") void stopServer();
      else ctrlRef.current?.stop();
      return;
    }
    if (checking) return; // wait for the in-flight STT
    setResult(null);
    setErr(null);
    setInterim("");
    const eng = resolveMicEngine();
    if (eng === "none") {
      setErr(t("pron.unsupported"));
      return;
    }
    engineRef.current = eng;
    if (eng === "server") void startServer();
    else startBrowser();
  };

  const dim = size === "sm" ? "h-7 w-7 text-[13px]" : "h-9 w-9 text-[16px]";
  const bandCls = result?.band === "great" ? "text-sage-deep" : "text-warn-text";
  const bandKey = result ? (result.band === "great" ? "pron.great" : result.band === "close" ? "pron.close" : "pron.off") : "";

  const body = listening ? (
    <span className="block text-[13px] text-ink-soft">
      {engineRef.current === "server" ? t("pron.recording") : interim || t("pron.listening")}
    </span>
  ) : checking ? (
    <span className="block text-[13px] text-ink-soft">{t("mic.checking")}</span>
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
  ) : null;
  // Closing clears the very state the bubble shows (result/err), so while it
  // fades out it keeps rendering what it last said instead of going blank.
  if (open) lastBody.current = body;

  return (
    <span ref={wrapRef} className={cn("relative inline-flex", className)}>
      <HoverTip title={t("pron.check")} className="inline-flex">
        <button
          type="button"
          onClick={start}
          disabled={checking}
          aria-label={t("pron.check")}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full border transition-colors active:scale-95 disabled:opacity-60",
            listening
              ? "animate-pulse border-warn/50 bg-warn-bg text-warn-text"
              : "border-black/[0.08] bg-surface text-sage-deep hover:bg-sage-tint",
            dim,
          )}
        >
          {listening ? (
            <Square className="h-[0.9em] w-[0.9em]" />
          ) : checking ? (
            <Loader2 className="h-[1em] w-[1em] animate-spin" />
          ) : (
            <Mic className="h-[1em] w-[1em]" />
          )}
        </button>
      </HoverTip>

      {pop.mounted && (
        <span
          ref={popRef}
          data-closing={pop.closing || undefined}
          style={{ left: shift }}
          className="anim-popover absolute top-full z-30 mt-2 w-max max-w-[240px] rounded-[12px] border border-black/[0.08] bg-surface px-3 py-2 text-left shadow-[0_14px_40px_rgba(46,42,38,0.2)]"
        >
          {open ? body : lastBody.current}
        </span>
      )}
    </span>
  );
}
