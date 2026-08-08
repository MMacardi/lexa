// Browser text-to-speech for pronunciation. Free, no API — uses the Web Speech
// API (window.speechSynthesis), which ships in all modern browsers.

const BCP47: Record<string, string> = {
  en: "en-US",
  zh: "zh-CN",
  ru: "ru-RU",
  es: "es-ES",
  de: "de-DE",
  fr: "fr-FR",
  ja: "ja-JP",
  ko: "ko-KR",
};

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

// Voices load asynchronously in Chrome: getVoices() is empty on the very first
// call after a page load and only fills once the engine fires "voiceschanged".
// We prime it early and cache the result so the first click isn't silent.
let cachedVoices: SpeechSynthesisVoice[] = [];
function loadVoices() {
  if (!canSpeak()) return;
  const v = window.speechSynthesis.getVoices();
  if (v.length) cachedVoices = v;
}
if (typeof window !== "undefined" && canSpeak()) {
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
  return (
    voices.find((v) => v.lang === want) ??
    voices.find((v) => v.lang.replace("_", "-").startsWith(lang))
  );
}

// Keep a reference to the active utterance. Chromium garbage-collects the
// utterance mid-speech otherwise, which cuts the audio off (or never starts it).
let keepAlive: SpeechSynthesisUtterance | null = null;

/** Speak `text` in the given language code (en/zh/ru/...). */
export function speak(text: string, lang = "en") {
  if (!canSpeak() || !text.trim()) return;
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
    return;
  }

  fire();
}
