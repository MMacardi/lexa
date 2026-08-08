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
function primeVoices() {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  const load = () => {
    const v = synth.getVoices();
    if (v.length) cachedVoices = v;
  };
  load();
  synth.addEventListener?.("voiceschanged", load);
}
if (typeof window !== "undefined") primeVoices();

function pickVoice(lang: string, want: string): SpeechSynthesisVoice | undefined {
  const voices = cachedVoices.length ? cachedVoices : window.speechSynthesis.getVoices();
  if (voices.length && !cachedVoices.length) cachedVoices = voices;
  return voices.find((v) => v.lang === want) ?? voices.find((v) => v.lang.startsWith(lang));
}

// Keep a reference to the active utterance. Chromium garbage-collects the
// utterance mid-speech otherwise, which cuts the audio off (or never starts it).
let keepAlive: SpeechSynthesisUtterance | null = null;

/** Speak `text` in the given language code (en/zh/ru/...). */
export function speak(text: string, lang = "en") {
  if (!canSpeak() || !text.trim()) return;
  const synth = window.speechSynthesis;
  const want = BCP47[lang] ?? lang;

  const doSpeak = () => {
    const u = new SpeechSynthesisUtterance(text);
    keepAlive = u; // anti-GC
    u.lang = want;
    const match = pickVoice(lang, want);
    if (match) u.voice = match;
    u.rate = 0.95;
    u.onend = () => {
      if (keepAlive === u) keepAlive = null;
    };
    u.onerror = () => {
      if (keepAlive === u) keepAlive = null;
    };
    synth.speak(u);
    // Some Chromium builds start "paused" and need a nudge to actually play.
    setTimeout(() => {
      if (synth.paused) synth.resume();
    }, 60);
  };

  const start = () => {
    // Only cancel when something is actually playing/queued, and let it settle
    // before speaking — cancel()+speak() in the same tick is silently dropped
    // on Chromium (the classic "first click does nothing" bug).
    if (synth.speaking || synth.pending) {
      synth.cancel();
      setTimeout(doSpeak, 120);
    } else {
      doSpeak();
    }
  };

  // If voices haven't loaded yet, wait one tick so we don't fire into an empty
  // engine (which stays silent on the first interaction).
  if (!cachedVoices.length && synth.getVoices().length === 0) {
    let done = false;
    const fire = () => {
      if (done) return;
      done = true;
      synth.removeEventListener?.("voiceschanged", fire);
      start();
    };
    synth.addEventListener?.("voiceschanged", fire);
    setTimeout(fire, 300); // fallback if the event never fires
    return;
  }

  start();
}
