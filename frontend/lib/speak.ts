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
type SpeechState = { text: string; loading: boolean } | null;
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
    () => Boolean(state?.loading && state.text === text),
    () => false,
  );
}

// Each play gets a number, so a clip that fails after the learner has already tapped
// something else doesn't fall back to the browser voice over the new one.
let playId = 0;

function playServer(text: string, lang: string) {
  const el = getPlayer();
  const id = ++playId;
  if (canSynth() && (window.speechSynthesis.speaking || window.speechSynthesis.pending)) window.speechSynthesis.cancel();
  const done = () => {
    if (id === playId) setState(null);
  };
  el.onplaying = () => {
    if (id === playId) setState({ text, loading: false });
  };
  el.onended = done;
  el.onerror = () => {
    if (id !== playId) return;
    done();
    speakBrowser(text, lang); // offline, signed out, the service down: the browser's voice
  };
  setState({ text, loading: true });
  el.src = ttsUrl(text, lang);
  el.play().catch((e: Error) => {
    // AbortError: a newer tap replaced this clip. NotAllowedError: played outside a
    // tap before anything unlocked the element — the browser's voice may still go.
    if (id !== playId || e?.name === "AbortError") return;
    done();
    if (e?.name === "NotAllowedError") speakBrowser(text, lang);
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
  if (typeof Audio !== "undefined" && (!player || player.paused)) {
    const el = getPlayer();
    silence ??= silenceUrl();
    el.src = silence;
    el.play().catch(() => {});
  }
  if (!canSynth()) return;
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
export function speak(text: string, lang = "en"): boolean {
  if (!text.trim()) return false;
  if (serverVoice(text, lang)) {
    playServer(text, lang);
    return true;
  }
  return speakBrowser(text, lang);
}

function speakBrowser(text: string, lang: string): boolean {
  if (!canSynth()) return false;
  if (hasVoice(lang) === false) return false;
  if (player && !player.paused) player.pause();
  playId++;
  setState(null);
  const synth = window.speechSynthesis;
  const want = BCP47[lang] ?? lang;

  const fire = () => {
    const u = new SpeechSynthesisUtterance(text);
    keepAlive = u; // anti-GC
    u.lang = want;
    const match = pickVoice(lang, want);
    if (match) u.voice = match; // otherwise let the engine use its default voice
    u.rate = 0.95;
    u.onend = () => {
      if (keepAlive === u) keepAlive = null;
    };
    u.onerror = () => {
      if (keepAlive === u) keepAlive = null;
    };

    const speakNow = () => {
      // Chromium clips the first ~200ms of a fresh utterance ("little" → "tle").
      // Queue a near-instant silent primer first; it absorbs the clip so the real
      // word plays from the start.
      const warm = new SpeechSynthesisUtterance("​"); // zero-width space
      warm.volume = 0;
      warm.rate = 2;
      try {
        synth.speak(warm);
      } catch {
        /* ignore */
      }
      synth.speak(u);
      // Some Chromium builds start paused — nudge it.
      setTimeout(() => {
        if (synth.paused) synth.resume();
      }, 90);
    };

    // Only cancel when something is actually playing — an unconditional cancel()
    // right before speak() is itself a cause of the clipped/garbled start.
    if (synth.speaking || synth.pending) {
      synth.cancel();
      setTimeout(speakNow, 140);
    } else {
      speakNow();
    }
  };

  // If voices haven't loaded yet, wait one tick so we don't fire into an empty
  // engine (which stays silent on the first interaction).
  if (!cachedVoices.length && synth.getVoices().length === 0) {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      synth.removeEventListener?.("voiceschanged", go);
      loadVoices();
      fire();
    };
    synth.addEventListener?.("voiceschanged", go);
    setTimeout(go, 300); // fallback if the event never fires
    return true;
  }

  fire();
  return true;
}
