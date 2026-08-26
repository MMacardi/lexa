"use client";

import { useI18n } from "@/lib/i18n";
import { Compass, Sparkles, BookOpen, Brain, Send, ArrowRight, Camera, Repeat } from "lucide-react";

// Public marketing landing shown to signed-out visitors. `onStart` reveals the
// login screen. Bilingual (ru default / en); zh falls back to en. Kept self-
// contained so it's easy to restyle without touching the app i18n catalogue.
const copy = {
  ru: {
    signIn: "Войти",
    eyebrow: "Твой личный AI-наставник по языкам",
    heroTitle: "Превращай всё, что ты учишь, в личную систему памяти",
    heroSub:
      "Не просто карточки. Наставник, который заставляет тебя вспоминать слова, строит план под твой уровень и помнит твой прогресс.",
    ctaMain: "Начать бесплатно",
    ctaHint: "Без карты. Вход через Telegram, Google или email.",
    featuresTitle: "Что внутри",
    features: [
      { icon: Compass, title: "AI-наставник, а не коробка с карточками", text: "Просит употребить слово, проверяет ответ, исправляет и подстраивает сложность — ты реально вспоминаешь, а не смотришь." },
      { icon: Camera, title: "Из чего угодно → колода", text: "Список, PDF-учебник или фото тетради (даже от руки) — за секунды превращается в колоду для повторения." },
      { icon: Brain, title: "Помнит тебя", text: "Знает твою цель, интересы и слабые места — и подстраивает практику, подсказки и подбор слов под тебя." },
      { icon: Repeat, title: "Умные повторения (FSRS)", text: "Современный алгоритм интервального повторения показывает слово ровно тогда, когда ты вот-вот его забудешь." },
      { icon: BookOpen, title: "Чтение с переводом", text: "Вставь любой текст, тапай незнакомые слова, добавляй их в колоду в один тап. CJK-сегментация из коробки." },
      { icon: Send, title: "Учись прямо в Telegram", text: "Повторяй карточки, практикуйся голосом и получай напоминания — не выходя из мессенджера." },
    ],
    howTitle: "Как это работает",
    how: [
      { n: "1", title: "Загрузи слова", text: "Импортируй список, PDF или фото — или добавляй по одному." },
      { n: "2", title: "Практикуйся с наставником", text: "Он гоняет тебя по слабым словам и оценивает ответы." },
      { n: "3", title: "Запоминай надолго", text: "Повторения по FSRS закрепляют слова в долгую память." },
    ],
    finalTitle: "Начни учить умнее уже сегодня",
    finalSub: "Бесплатно на время беты.",
    rights: "Все права защищены.",
    terms: "Условия",
    privacy: "Конфиденциальность",
  },
  en: {
    signIn: "Sign in",
    eyebrow: "Your personal AI language tutor",
    heroTitle: "Turn everything you study into a personal memory system",
    heroSub:
      "Not just flashcards. A coach that makes you recall words, builds a plan for your level, and remembers your progress.",
    ctaMain: "Start free",
    ctaHint: "No card. Sign in with Telegram, Google or email.",
    featuresTitle: "What's inside",
    features: [
      { icon: Compass, title: "An AI coach, not a flashcard box", text: "Asks you to use a word, checks your answer, corrects you and adapts — you actually recall instead of staring." },
      { icon: Camera, title: "Anything → a deck", text: "A list, a textbook PDF, or a photo of your notebook (even handwriting) becomes a reviewable deck in seconds." },
      { icon: Brain, title: "It remembers you", text: "Knows your goal, interests and weak spots — and tailors practice, hints and word picks to you." },
      { icon: Repeat, title: "Smart reviews (FSRS)", text: "A modern spaced-repetition algorithm shows each word right before you'd forget it." },
      { icon: BookOpen, title: "Read with translation", text: "Paste any text, tap unknown words, add them to your deck in one tap. CJK segmentation built in." },
      { icon: Send, title: "Learn inside Telegram", text: "Review cards, practice by voice and get reminders — without leaving the messenger." },
    ],
    howTitle: "How it works",
    how: [
      { n: "1", title: "Load your words", text: "Import a list, a PDF or a photo — or add them one by one." },
      { n: "2", title: "Practice with the coach", text: "It drills your weak words and grades your answers." },
      { n: "3", title: "Remember for good", text: "FSRS reviews lock the words into long-term memory." },
    ],
    finalTitle: "Start learning smarter today",
    finalSub: "Free during the beta.",
    rights: "All rights reserved.",
    terms: "Terms",
    privacy: "Privacy",
  },
};

export function LandingScreen({ onStart }: { onStart: () => void }) {
  const { locale } = useI18n();
  const L = locale === "en" ? copy.en : locale === "zh" ? copy.en : copy.ru;

  return (
    <main className="min-h-screen bg-paper text-ink">
      {/* top bar */}
      <header className="mx-auto flex max-w-[1080px] items-center justify-between px-5 py-5 sm:px-8">
        <span className="font-serif text-[22px] font-semibold tracking-[-0.01em]">Lexa</span>
        <button
          type="button"
          onClick={onStart}
          className="rounded-full border border-black/[0.1] px-4 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-sage/60 hover:text-sage-deep"
        >
          {L.signIn}
        </button>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden">
        <div className="mx-auto max-w-[1080px] px-5 pb-14 pt-10 text-center sm:px-8 sm:pb-20 sm:pt-16">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-tint px-3 py-1 text-[13px] font-semibold text-sage-deep">
            <Sparkles className="h-3.5 w-3.5" /> {L.eyebrow}
          </span>
          <h1 className="anim-fade-up mx-auto mt-5 max-w-[820px] font-serif text-[34px] font-medium leading-[1.08] tracking-[-0.02em] sm:text-[52px]">
            {L.heroTitle}
          </h1>
          <p className="anim-fade-up mx-auto mt-5 max-w-[600px] text-[16px] leading-relaxed text-ink-soft sm:text-[19px]" style={{ animationDelay: "60ms" }}>
            {L.heroSub}
          </p>
          <div className="anim-fade-up mt-8 flex flex-col items-center gap-3" style={{ animationDelay: "120ms" }}>
            <button
              type="button"
              onClick={onStart}
              className="inline-flex items-center gap-2 rounded-full bg-sage px-7 py-3.5 text-[16px] font-semibold text-white shadow-[0_12px_30px_rgba(124,152,133,0.35)] transition-all hover:bg-sage-deep active:scale-[0.98]"
            >
              {L.ctaMain} <ArrowRight className="h-5 w-5" />
            </button>
            <span className="text-[13px] text-ink-faint">{L.ctaHint}</span>
          </div>
        </div>
      </section>

      {/* features */}
      <section className="mx-auto max-w-[1080px] px-5 py-8 sm:px-8 sm:py-14">
        <h2 className="text-center font-serif text-[26px] font-medium tracking-[-0.01em] sm:text-[32px]">{L.featuresTitle}</h2>
        <div className="mt-8 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {L.features.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-[20px] border border-black/[0.07] bg-surface p-6 transition-shadow hover:shadow-[0_14px_36px_rgba(46,42,38,0.08)]">
              <span className="inline-flex h-11 w-11 items-center justify-center rounded-[13px] bg-sage-tint text-sage-deep">
                <Icon className="h-[22px] w-[22px]" />
              </span>
              <h3 className="mt-4 font-serif text-[19px] font-semibold">{title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section className="mx-auto max-w-[1080px] px-5 py-8 sm:px-8 sm:py-14">
        <h2 className="text-center font-serif text-[26px] font-medium tracking-[-0.01em] sm:text-[32px]">{L.howTitle}</h2>
        <div className="mt-8 grid gap-3.5 sm:grid-cols-3">
          {L.how.map((s) => (
            <div key={s.n} className="rounded-[20px] border border-black/[0.07] bg-surface p-6">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sage font-serif text-[17px] font-bold text-white">{s.n}</span>
              <h3 className="mt-3.5 font-serif text-[18px] font-semibold">{s.title}</h3>
              <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* final CTA */}
      <section className="mx-auto max-w-[1080px] px-5 py-10 sm:px-8 sm:py-16">
        <div className="relative overflow-hidden rounded-[26px] border border-sage/25 bg-gradient-to-br from-sage-tint/70 via-surface to-surface p-8 text-center sm:p-14">
          <h2 className="font-serif text-[28px] font-medium tracking-[-0.01em] sm:text-[40px]">{L.finalTitle}</h2>
          <p className="mt-2 text-[15px] text-ink-soft sm:text-[17px]">{L.finalSub}</p>
          <button
            type="button"
            onClick={onStart}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-sage px-7 py-3.5 text-[16px] font-semibold text-white transition-all hover:bg-sage-deep active:scale-[0.98]"
          >
            {L.ctaMain} <ArrowRight className="h-5 w-5" />
          </button>
        </div>
      </section>

      {/* footer */}
      <footer className="mx-auto max-w-[1080px] px-5 py-8 sm:px-8">
        <div className="flex flex-col items-center justify-between gap-3 border-t border-black/[0.07] pt-6 text-[13px] text-ink-faint sm:flex-row">
          <span>© {new Date().getFullYear()} Lexa · {L.rights}</span>
          <div className="flex gap-4">
            <a href="/terms" className="font-semibold hover:text-ink">{L.terms}</a>
            <a href="/privacy" className="font-semibold hover:text-ink">{L.privacy}</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
