// Resolve WHICH speech-to-text engine a mic should use, given the learner's pref and
// what this browser/device actually supports.
//
// Two engines:
//  - "browser": the free, on-device Web Speech recogniser (realtime interim text), but
//    dead on iOS Safari and in mainland China (audio would route to Google).
//  - "server": record the utterance, send it to our STT (qwen3-asr via /api/coach/stt).
//    Works everywhere incl. iPhone/China, ~0.8 s, no live interim.
//
// "auto" prefers the browser engine where it works, and once it has failed at runtime
// (sticky lexa.micBrowserFailed) it goes straight to the server. Callers detect a
// browser-path failure and call markMicBrowserFailed() so the next "auto" resolves to
// server — this is what makes China Chrome self-heal after one failed attempt.

import { dictationSupported } from "@/lib/dictation";
import { recorderSupported } from "@/lib/record";
import { getMicEngine, micBrowserFailed } from "@/lib/learnPrefs";

export type ResolvedEngine = "browser" | "server" | "none";

/** The engine a mic should use right now ("none" = neither is available). */
export function resolveMicEngine(): ResolvedEngine {
  const pref = getMicEngine();
  if (pref === "browser") return dictationSupported() ? "browser" : "none";
  if (pref === "server") return recorderSupported() ? "server" : "none";
  // auto
  if (micBrowserFailed() && recorderSupported()) return "server";
  if (dictationSupported()) return "browser";
  if (recorderSupported()) return "server";
  return "none";
}

/** True when at least one engine can run (gates whether to render a mic at all). */
export function micAvailable(): boolean {
  return dictationSupported() || recorderSupported();
}
