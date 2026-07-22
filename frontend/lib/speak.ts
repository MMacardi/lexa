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

/** Speak `text` in the given language code (en/zh/ru/...). */
export function speak(text: string, lang = "en") {
  if (!canSpeak() || !text.trim()) return;
  const synth = window.speechSynthesis;
  synth.cancel(); // stop anything already playing
  const u = new SpeechSynthesisUtterance(text);
  const want = BCP47[lang] ?? lang;
  u.lang = want;
  // Prefer a voice that matches the language if one is installed.
  const voices = synth.getVoices();
  const match = voices.find((v) => v.lang === want) ?? voices.find((v) => v.lang.startsWith(lang));
  if (match) u.voice = match;
  u.rate = 0.95;
  synth.speak(u);
}
