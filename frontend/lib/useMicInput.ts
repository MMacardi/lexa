"use client";

// One mic hook for every composer (coach chat / scene / practice). It replaces the three
// duplicated inline Web Speech blocks with an engine-agnostic capture that honours the
// learner's mic pref (auto / browser / server — see lib/micEngine.ts):
//
//  - browser engine: live realtime dictation; onText fires continuously with the full
//    text (base + what's been said), onInterim with the not-yet-final tail.
//  - server engine: tap to record, tap again to stop → we upload to /api/coach/stt and
//    call onText(base + transcript) once. No live interim; the composer shows a
//    "recording…/transcribing…" pill instead.
//
// If the browser recogniser fails at runtime we set the sticky flag so "auto" resolves to
// the server engine from then on (China Chrome / iOS self-heal after one failed attempt).

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { startDictation, speechLang, type DictationController } from "@/lib/dictation";
import { startRecording, type Recording } from "@/lib/record";
import { resolveMicEngine, type ResolvedEngine } from "@/lib/micEngine";
import { markMicBrowserFailed } from "@/lib/learnPrefs";

export type MicPhase = "idle" | "recording" | "transcribing";

export interface UseMicInput {
  phase: MicPhase;
  /** Live not-yet-final tail (browser engine only; empty on the server path). */
  interim: string;
  /** The engine in use for the current/last capture. */
  engine: ResolvedEngine;
  /** Start or stop capture (a single tap toggles). */
  toggle: () => void;
  /** Stop and discard silently (e.g. when the learner hits send while recording). */
  cancel: () => void;
}

export function useMicInput(opts: {
  /** Source-language code (e.g. "en"); converted to a BCP-47 tag for the browser engine. */
  lang?: string;
  /** Text already in the box, so a transcript appends rather than replaces. */
  getBase?: () => string;
  /** Called with the FULL text (base + transcript). Live on the browser path, once on server. */
  onText: (full: string) => void;
  /** Live tail (browser path only). */
  onInterim?: (tail: string) => void;
  /** A user-facing, already-translated error/hint message. */
  onError?: (message: string) => void;
}): UseMicInput {
  const { t } = useI18n();
  const [phase, setPhase] = useState<MicPhase>("idle");
  const [interim, setInterim] = useState("");
  const [engine, setEngine] = useState<ResolvedEngine>("none");

  const dictRef = useRef<DictationController | null>(null);
  const recRef = useRef<Recording | null>(null);
  const mountedRef = useRef(true);
  // Keep the latest callbacks without re-creating toggle/cancel on every render.
  const cb = useRef(opts);
  cb.current = opts;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try {
        dictRef.current?.stop();
      } catch {
        /* ignore */
      }
      dictRef.current = null;
      recRef.current?.stop().catch(() => {});
      recRef.current = null;
    };
  }, []);

  const join = (a: string, b: string) => [a, b].map((s) => s.trim()).filter(Boolean).join(" ");

  const startBrowser = useCallback(() => {
    const lang = speechLang(cb.current.lang);
    const base = cb.current.getBase?.() ?? "";
    const ctrl = startDictation({
      lang,
      base,
      onText: (full) => {
        if (mountedRef.current) cb.current.onText(full);
      },
      onInterim: (tail) => {
        if (!mountedRef.current) return;
        setInterim(tail);
        cb.current.onInterim?.(tail);
      },
      onError: (kind) => {
        // Browser recogniser failed at runtime — make "auto" prefer the server next time.
        markMicBrowserFailed();
        if (!mountedRef.current) return;
        dictRef.current = null;
        setInterim("");
        setPhase("idle");
        cb.current.onError?.(kind === "unsupported" ? t("coach.practiceMicUnsupported") : t("mic.browserFailed"));
      },
      onEnd: () => {
        if (!mountedRef.current) return;
        dictRef.current = null;
        setInterim("");
        setPhase("idle");
      },
    });
    if (!ctrl) {
      markMicBrowserFailed();
      cb.current.onError?.(t("coach.practiceMicUnsupported"));
      setPhase("idle");
      return;
    }
    dictRef.current = ctrl;
    setPhase("recording");
  }, [t]);

  const startServer = useCallback(async () => {
    try {
      const rec = await startRecording({ maxMs: 20000 });
      if (!mountedRef.current) {
        rec.stop().catch(() => {});
        return;
      }
      recRef.current = rec;
      setPhase("recording");
    } catch (e) {
      recRef.current = null;
      setPhase("idle");
      cb.current.onError?.((e as Error)?.message === "denied" ? t("pron.denied") : t("coach.practiceSttFail"));
    }
  }, [t]);

  const stopServer = useCallback(async () => {
    const rec = recRef.current;
    recRef.current = null;
    if (!rec) {
      setPhase("idle");
      return;
    }
    setPhase("transcribing");
    const base = cb.current.getBase?.() ?? "";
    try {
      const audio = await rec.stop();
      const { text } = await api.stt({ audio: audio.base64, format: audio.format, sourceLang: cb.current.lang });
      if (!mountedRef.current) return;
      if (!text.trim()) {
        setPhase("idle");
        cb.current.onError?.(t("pron.nothing"));
        return;
      }
      cb.current.onText(join(base, text));
      setPhase("idle");
    } catch (e) {
      if (!mountedRef.current) return;
      setPhase("idle");
      const msg = (e as Error)?.message ?? "";
      cb.current.onError?.(msg === "denied" ? t("pron.denied") : msg === "empty" ? t("pron.nothing") : t("coach.practiceSttFail"));
    }
  }, [t]);

  const toggle = useCallback(() => {
    // A capture is already running → stop it.
    if (dictRef.current) {
      const ctrl = dictRef.current;
      dictRef.current = null;
      try {
        ctrl.stop();
      } catch {
        /* ignore */
      }
      setInterim("");
      setPhase("idle");
      return;
    }
    if (recRef.current) {
      void stopServer();
      return;
    }
    if (phase === "transcribing") return; // wait for the in-flight STT
    // Nothing running → start, picking the engine now (so a pref change applies at once).
    const eng = resolveMicEngine();
    setEngine(eng);
    if (eng === "none") {
      cb.current.onError?.(t("coach.practiceMicUnsupported"));
      return;
    }
    if (eng === "browser") startBrowser();
    else void startServer();
  }, [phase, startBrowser, startServer, stopServer, t]);

  const cancel = useCallback(() => {
    if (dictRef.current) {
      const ctrl = dictRef.current;
      dictRef.current = null;
      try {
        ctrl.stop();
      } catch {
        /* ignore */
      }
    }
    if (recRef.current) {
      const rec = recRef.current;
      recRef.current = null;
      rec.stop().catch(() => {}); // discard the audio, no STT call
    }
    setInterim("");
    setPhase("idle");
  }, []);

  return { phase, interim, engine, toggle, cancel };
}
