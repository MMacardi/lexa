// Text-to-speech for pronunciation. Chinese is read by Bailian's voice from the
// server (GET /api/tts, backend services/tts.ts): the browser's own Chinese voice is
// the robotic Huihui on Windows and missing on some Android phones. Everything else,
// and Chinese whenever the server can't answer, uses the browser's Web Speech API
// (window.speechSynthesis), which ships in all modern browsers.

import { useSyncExternalStore } from "react";
import { ttsUrl } from "./api";

const BCP47: Record<string, string> = {
  en: "en-US",
  zh: "zh-CN",
  "zh-Hant": "zh-TW",
  ru: "ru-RU",
  es: "es-ES",
  de: "de-DE",
  fr: "fr-FR",
  ja: "ja-JP",
  ko: "ko-KR",
};

export function canSpeak(): boolean {
  return typeof window !== "undefined" && ("speechSynthesis" in window || typeof Audio !== "undefined");
}

function canSynth(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// ── The server's voice ────────────────────────────────────────────────────────
const SERVER_LANGS = new Set(["zh", "zh-Hant"]);
const SERVER_MAX = 300; // the backend's TTS_MAX_CHARS
const HAN = /\p{Script=Han}/u;
const serverVoice = (text: string, lang: string) =>
  SERVER_LANGS.has(lang) && HAN.test(text) && text.length <= SERVER_MAX && typeof Audio !== "undefined";

// One <audio> element for every clip. iOS lets an element play outside a tap once it
// has played inside one, so the listening card and quiz, which speak on their own
// a moment after the tap, reuse the element the tap unlocked.
let player: HTMLAudioElement | null = null;
function getPlayer(): HTMLAudioElement {
  if (!player) {
    player = new Audio();
    player.preload = "auto";
  }
  return player;
}
// A blink of silence (0.02 s, 8 kHz 16-bit mono WAV), played inside a tap to unlock the element.
function silenceUrl(): string {
  const samples = 160;
  const v = new DataView(new ArrayBuffer(44 + samples * 2));
  const tag = (at: number, s: string) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  tag(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  tag(8, "WAVEfmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, 8000, true);
  v.setUint32(28, 16000, true); // bytes per second
  v.setUint16(32, 2, true); // bytes per frame
  v.setUint16(34, 16, true);
  tag(36, "data");
  v.setUint32(40, samples * 2, true);
  return URL.createObjectURL(new Blob([v.buffer], { type: "audio/wav" }));
}
let silence: string | null = null;

// What the player is doing, for a speaker button to show a spinner while a clip
// nobody has played before is being made (~2-3 s the first time, instant after).
type SpeechState = {
  text: string; lang: string; status: "loading" | "playing";
  rate: number; sentence: boolean; owner?: string; onUnavailable?: () => void;
} | null;
let state: SpeechState = null;
const listeners = new Set<() => void>();
function setState(s: SpeechState) {
  state = s;
  listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** True while `text` is being fetched to be spoken (not yet sounding). */
export function useSpeechLoading(text: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => Boolean(state?.status === "loading" && state.text === text),
    () => false,
  );
}

// Each play gets a number, so a clip that fails after the learner has already tapped
// something else doesn't fall back to the browser voice over the new one.
let playId = 0;
const pending = new Set<ReturnType<typeof setTimeout>>();
let removeVoiceWait: (() => void) | null = null;
const RATE_KEY = "lexa.sentenceRate";
let sentenceRate: 1 | 0.75 = 1;
const emit = () => listeners.forEach((l) => l());
function readRate() {
  try { sentenceRate = localStorage.getItem(RATE_KEY) === "0.75" ? 0.75 : 1; } catch { /* storage disabled */ }
}
if (typeof window !== "undefined") {
  readRate();
  window.addEventListener("storage", (e) => {
    if (e.key === RATE_KEY || e.key === null) { readRate(); applySentenceRate(); emit(); }
  });
}
export function useSentenceRate() {
  return useSyncExternalStore(subscribe, () => sentenceRate, () => 1 as const);
}
export function useSpeechState(text: string, lang: string) {
  return useSyncExternalStore(subscribe,
    () => state?.text === text && state.lang === lang ? state.status : "stopped",
    () => "stopped" as const);
}
export function setSentenceRate(rate: 1 | 0.75) {
  sentenceRate = rate;
  try { localStorage.setItem(RATE_KEY, String(rate)); } catch { /* storage disabled */ }
  applySentenceRate();
  emit();
}
function applySentenceRate() {
  if (!state?.sentence) return;
  if (keepAlive) {
    // Web Speech has no reliable live rate setter; replay with the chosen pace.
    speak(state.text, state.lang, { ...state, rate: sentenceRate });
  } else {
    state = { ...state, rate: sentenceRate };
    if (player) player.playbackRate = sentenceRate;
  }
}
function later(id: number, fn: () => void, ms: number) {
  const timer = setTimeout(() => { pending.delete(timer); if (id === playId) fn(); }, ms);
  pending.add(timer);
}
/** Invalidate callbacks before cancelling either engine (cancel may fire events). */
export function stopSpeech(owner?: string) {
  if (owner && state?.owner !== owner) return;
  playId++;
  pending.forEach(clearTimeout); pending.clear();
  removeVoiceWait?.(); removeVoiceWait = null;
  if (player) {
    player.onplaying = player.onended = player.onerror = null;
    player.pause();
    player.removeAttribute("src");
    player.load();
  }
  if (canSynth() && (keepAlive || window.speechSynthesis.speaking || window.speechSynthesis.pending)) window.speechSynthesis.cancel();
  keepAlive = null;
  setState(null);
}

function playServer(text: string, lang: string, id: number) {
  const el = getPlayer();
  const done = () => {
    if (id === playId) setState(null);
  };
  el.onplaying = () => {
    if (id === playId && state) setState({ ...state, status: "playing" });
  };
  el.onended = done;
  let fellBack = false;
  const fallback = () => {
    if (id !== playId || fellBack) return;
    fellBack = true;
    el.onplaying = el.onended = el.onerror = null;
    el.pause(); el.removeAttribute("src"); el.load();
    if (state) setState({ ...state, status: "loading" });
    if (!speakBrowser(text, lang, id)) unavailable(id);
  };
  el.onerror = fallback;
  el.src = ttsUrl(text, lang);
  el.preservesPitch = true;
  // Older Safari exposes the same pitch-preserving switch with a prefix.
  (el as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
  el.playbackRate = state?.rate ?? 1;
  el.play().catch((e: Error) => {
    // AbortError: a newer tap replaced this clip. NotAllowedError: played outside a
    // tap before anything unlocked the element — the browser's voice may still go.
    if (id !== playId || e?.name === "AbortError") return;
    fallback();
  });
}

// Voices load asynchronously in Chrome: getVoices() is empty on the very first
// call after a page load and only fills once the engine fires "voiceschanged".
// We prime it early and cache the result so the first click isn't silent.
let cachedVoices: SpeechSynthesisVoice[] = [];
function loadVoices() {
  if (!canSynth()) return;
  const v = window.speechSynthesis.getVoices();
  if (v.length) cachedVoices = v;
}
if (canSynth()) {
  loadVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
  // Some Windows Chrome/Edge builds boot the engine in a globally "paused" state;
  // an early resume() clears that so the first utterance actually plays.
  try {
    window.speechSynthesis.resume();
  } catch {
    /* ignore */
  }
}

function pickVoice(lang: string, want: string): SpeechSynthesisVoice | undefined {
  const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
  if (voices.length && !cachedVoices.length) cachedVoices = voices;
  const base = lang.split("-")[0];
  return (
    voices.find((v) => v.lang.replace("_", "-") === want) ??
    voices.find((v) => v.lang.replace("_", "-").startsWith(base)) ??
    // Some Android engines tag Mandarin by its ISO 639-3 code.
    (base === "zh" ? voices.find((v) => /^cmn/i.test(v.lang)) : undefined)
  );
}

/**
 * Is there a voice for this language? null while the engine hasn't listed its
 * voices (some Android builds never do, and still speak). False means another
 * language's voice would read it: an English voice spelling out 服务器.
 */
export function hasVoice(lang: string): boolean | null {
  if (!canSynth()) return false;
  const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  return Boolean(pickVoice(lang, BCP47[lang] ?? lang));
}

/**
 * Call inside the tap that starts something which will speak on its own later (a
 * listening card, a listening quiz): iOS lets speech start only from a gesture,
 * and once it has, from anywhere on the page.
 */
export function unlockSpeech() {
  if (!state && typeof Audio !== "undefined" && (!player || player.paused)) {
    const el = getPlayer();
    silence ??= silenceUrl();
    el.src = silence;
    el.play().catch(() => {});
  }
  if (state || !canSynth()) return;
  try {
    const u = new SpeechSynthesisUtterance("​");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    /* ignore */
  }
}

// Keep a reference to the active utterance. Chromium garbage-collects the
// utterance mid-speech otherwise, which cuts the audio off (or never starts it).
let keepAlive: SpeechSynthesisUtterance | null = null;

/**
 * Speak `text` in the given language code (en/zh/ru/...). False when it can't:
 * no speech engine, or no voice for the language (the caller says so rather than
 * let another language's voice read it).
 */
type SpeakOptions = { sentence?: boolean; rate?: number; owner?: string; onUnavailable?: () => void };
export function speak(text: string, lang = "en", options: SpeakOptions = {}): boolean {
  if (!text.trim()) return false;
  const wasSpeaking = canSynth() && (window.speechSynthesis.speaking || window.speechSynthesis.pending);
  stopSpeech();
  const id = playId;
  setState({ text, lang, status: "loading", sentence: options.sentence ?? false,
    rate: options.rate ?? (options.sentence ? sentenceRate : 0.95),
    owner: options.owner, onUnavailable: options.onUnavailable });
  if (serverVoice(text, lang)) {
    // Server clips retain their natural rate unless sentence speed was selected.
    state = { ...state!, rate: options.rate ?? (options.sentence ? sentenceRate : 1) };
    playServer(text, lang, id);
    return true;
  }
  const ok = speakBrowser(text, lang, id, Boolean(wasSpeaking));
  if (!ok) setState(null);
  return ok;
}

function unavailable(id: number) {
  if (id !== playId) return;
  const report = state?.onUnavailable;
  stopSpeech();
  report?.();
}

function speakBrowser(text: string, lang: string, id: number, afterCancel = false): boolean {
  if (!canSynth() || hasVoice(lang) === false) return false;
  const synth = window.speechSynthesis;
  const want = BCP47[lang] ?? lang;
  const fire = () => {
    if (id !== playId || !state) return;
    // Voices may have loaded during the wait; never use the wrong language.
    if (hasVoice(lang) === false) { unavailable(id); return; }
    const u = new SpeechSynthesisUtterance(text);
    keepAlive = u;
    u.lang = want;
    const match = pickVoice(lang, want);
    if (match) u.voice = match;
    u.rate = state.sentence ? state.rate : 0.95;
    u.pitch = 1;
    u.onstart = () => {
      if (id === playId && state) setState({ ...state, status: "playing" });
    };
    u.onend = () => {
      if (id === playId) { keepAlive = null; setState(null); }
    };
    u.onerror = () => unavailable(id);
    const speakNow = () => {
      if (id !== playId) return;
      // Keep the silent primer: Chromium otherwise clips the onset of a word.
      const warm = new SpeechSynthesisUtterance("\u200b");
      warm.volume = 0;
      warm.rate = 2;
      try {
        synth.speak(warm);
        synth.speak(u);
        later(id, () => { if (synth.paused) synth.resume(); }, 90);
      } catch { unavailable(id); }
    };
    if (afterCancel) later(id, speakNow, 140);
    else speakNow();
  };
  if (!cachedVoices.length && synth.getVoices().length === 0) {
    let done = false;
    const go = () => {
      if (done || id !== playId) return;
      done = true;
      removeVoiceWait?.(); removeVoiceWait = null;
      loadVoices();
      fire();
    };
    synth.addEventListener?.("voiceschanged", go);
    removeVoiceWait = () => synth.removeEventListener?.("voiceschanged", go);
    later(id, go, 300);
  } else fire();
  return true;
}
