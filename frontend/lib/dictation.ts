// Live speech-to-text on the browser's own SpeechRecognition engine (free,
// on-device, no server round-trip). Built for long "lecture mode" capture: the
// engine tends to stop itself after a pause, so we transparently restart until
// the caller says stop, committing each run's final text so nothing is lost.

// Map our language code to a BCP-47 tag for the recogniser.
export function speechLang(src?: string): string {
  const map: Record<string, string> = {
    en: "en-US", ru: "ru-RU", zh: "zh-CN", "zh-Hant": "zh-TW", ja: "ja-JP", ko: "ko-KR",
    es: "es-ES", fr: "fr-FR", de: "de-DE", it: "it-IT", pt: "pt-PT", nl: "nl-NL",
    pl: "pl-PL", tr: "tr-TR", uk: "uk-UA", hi: "hi-IN", ar: "ar-SA",
  };
  return map[src ?? "en"] ?? src ?? "en-US";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getSR(): any {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
}

export function dictationSupported(): boolean {
  return !!getSR();
}

export interface DictationController {
  stop(): void;
}

const join = (a: string, b: string) => [a, b].map((s) => s.trim()).filter(Boolean).join(" ");

/**
 * Start continuous dictation. `onText` always receives the FULL text (the given
 * `base` plus everything transcribed so far), so a caller can pipe it straight
 * into a textarea; `onInterim` gets just the live, not-yet-final tail. Returns a
 * controller whose stop() ends capture (or null if the browser has no engine).
 */
export function startDictation(opts: {
  lang: string;
  base?: string;
  onText: (full: string) => void;
  onInterim?: (tail: string) => void;
  onError?: (kind: "unsupported" | "fail") => void;
  onEnd?: () => void;
}): DictationController | null {
  const SR = getSR();
  if (!SR) {
    opts.onError?.("unsupported");
    return null;
  }
  let base = (opts.base ?? "").trim();
  let want = true; // keep capturing (drives the auto-restart) until stop()
  let runFinal = ""; // finalised text of the CURRENT run (reset each restart)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let rec: any = null;

  function run() {
    rec = new SR();
    rec.lang = opts.lang;
    rec.interimResults = true;
    rec.continuous = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      let f = "";
      let it = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) f += r[0].transcript;
        else it += r[0].transcript;
      }
      runFinal = f;
      opts.onInterim?.(it);
      opts.onText(join(base, f + it));
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onerror = (e: any) => {
      // "no-speech"/"aborted" are transient (a pause, or our own restart) — let
      // onend decide. Anything else is fatal: stop and surface it.
      if (e?.error && e.error !== "no-speech" && e.error !== "aborted") {
        want = false;
        opts.onError?.("fail");
      }
    };
    rec.onend = () => {
      base = join(base, runFinal); // bank this run so a restart doesn't drop it
      runFinal = "";
      opts.onInterim?.("");
      opts.onText(base);
      if (want) {
        try {
          run();
        } catch {
          want = false;
          opts.onEnd?.();
        }
      } else {
        opts.onEnd?.();
      }
    };
    rec.start();
  }

  try {
    run();
  } catch {
    opts.onError?.("unsupported");
    return null;
  }
  return {
    stop() {
      want = false;
      try {
        rec?.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}
