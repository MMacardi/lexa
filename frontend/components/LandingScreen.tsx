"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n, LOCALES } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Compass, Sparkles, BookOpen, Brain, Send, ArrowRight, Camera, Repeat, Sun, Moon, Globe, Check, ChevronDown } from "lucide-react";

// Public marketing landing shown to signed-out visitors. `onStart` reveals the
// login screen. Bilingual (en default / ru); zh falls back to en. Self-contained,
// with a language + theme switcher, an animated aurora hero and scroll-reveal.
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

// Fade + rise into view as the section scrolls in.
function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            el.classList.add("reveal-in");
            io.unobserve(el);
          }
        });
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`reveal ${className}`} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  );
}

function LangMenu() {
  const { locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const cur = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] px-3 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-sage/60 hover:text-ink"
      >
        <Globe className="h-4 w-4" /> {cur.label} <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <button type="button" aria-hidden className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1.5 min-w-[120px] overflow-hidden rounded-[14px] border border-black/[0.08] bg-surface p-1 shadow-[0_16px_40px_rgba(46,42,38,0.18)]">
            {LOCALES.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => {
                  setLocale(l.code);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-sm font-semibold text-ink-muted transition-colors hover:bg-sage-tint hover:text-sage-deep"
              >
                {l.label}
                {l.code === locale && <Check className="h-4 w-4 text-sage-deep" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/[0.1] text-ink-muted transition-colors hover:border-sage/60 hover:text-ink"
    >
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

export function LandingScreen({ onStart }: { onStart: () => void }) {
  const { locale } = useI18n();
  const L = locale === "ru" ? copy.ru : copy.en;

  return (
    <main className="min-h-screen bg-paper text-ink">
      {/* top bar */}
      <header className="sticky top-0 z-30 border-b border-black/[0.05] bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between px-5 py-3.5 sm:px-8">
          <span className="font-serif text-[22px] font-semibold tracking-[-0.01em]">Lexa</span>
          <div className="flex items-center gap-2">
            <LangMenu />
            <ThemeToggle />
            <button
              type="button"
              onClick={onStart}
              className="rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sage-deep"
            >
              {L.signIn}
            </button>
          </div>
        </div>
      </header>

      {/* hero with drifting aurora */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="aurora-blob absolute -top-32 left-[15%] h-[420px] w-[420px] rounded-full bg-sage/25 blur-[120px]" />
          <div className="aurora-blob slow absolute -top-10 right-[12%] h-[380px] w-[380px] rounded-full bg-taupe/25 blur-[120px]" />
        </div>
        <div className="relative mx-auto max-w-[1080px] px-5 pb-16 pt-14 text-center sm:px-8 sm:pb-24 sm:pt-20">
          <span className="anim-fade-up inline-flex items-center gap-1.5 rounded-full border border-sage/25 bg-sage-tint/60 px-3.5 py-1.5 text-[13px] font-semibold text-sage-deep backdrop-blur">
            <Sparkles className="h-3.5 w-3.5" /> {L.eyebrow}
          </span>
          <h1 className="anim-fade-up mx-auto mt-6 max-w-[840px] font-serif text-[36px] font-medium leading-[1.06] tracking-[-0.02em] sm:text-[56px]" style={{ animationDelay: "60ms" }}>
            {L.heroTitle}
          </h1>
          <p className="anim-fade-up mx-auto mt-6 max-w-[620px] text-[16px] leading-relaxed text-ink-soft sm:text-[20px]" style={{ animationDelay: "120ms" }}>
            {L.heroSub}
          </p>
          <div className="anim-fade-up mt-9 flex flex-col items-center gap-3" style={{ animationDelay: "180ms" }}>
            <button
              type="button"
              onClick={onStart}
              className="group inline-flex items-center gap-2 rounded-full bg-sage px-8 py-4 text-[17px] font-semibold text-white shadow-[0_16px_40px_rgba(124,152,133,0.4)] transition-all hover:bg-sage-deep hover:shadow-[0_20px_50px_rgba(124,152,133,0.5)] active:scale-[0.98]"
            >
              {L.ctaMain}
              <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
            </button>
            <span className="text-[13px] text-ink-faint">{L.ctaHint}</span>
          </div>
        </div>
      </section>

      {/* features */}
      <section className="mx-auto max-w-[1080px] px-5 py-10 sm:px-8 sm:py-16">
        <Reveal>
          <h2 className="text-center font-serif text-[27px] font-medium tracking-[-0.01em] sm:text-[34px]">{L.featuresTitle}</h2>
        </Reveal>
        <div className="mt-9 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {L.features.map(({ icon: Icon, title, text }, i) => (
            <Reveal key={title} delay={(i % 3) * 90}>
              <div className="h-full rounded-[22px] border border-black/[0.07] bg-surface p-6 transition-all duration-300 hover:-translate-y-1 hover:border-sage/30 hover:shadow-[0_18px_44px_rgba(46,42,38,0.1)]">
                <span className="inline-flex h-12 w-12 items-center justify-center rounded-[14px] bg-sage-tint text-sage-deep">
                  <Icon className="h-[23px] w-[23px]" />
                </span>
                <h3 className="mt-4 font-serif text-[19px] font-semibold">{title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* how it works */}
      <section className="mx-auto max-w-[1080px] px-5 py-10 sm:px-8 sm:py-16">
        <Reveal>
          <h2 className="text-center font-serif text-[27px] font-medium tracking-[-0.01em] sm:text-[34px]">{L.howTitle}</h2>
        </Reveal>
        <div className="mt-9 grid gap-3.5 sm:grid-cols-3">
          {L.how.map((s, i) => (
            <Reveal key={s.n} delay={i * 110}>
              <div className="h-full rounded-[22px] border border-black/[0.07] bg-surface p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sage font-serif text-[18px] font-bold text-white">{s.n}</span>
                <h3 className="mt-4 font-serif text-[18px] font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-[14px] leading-relaxed text-ink-soft">{s.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* final CTA */}
      <section className="mx-auto max-w-[1080px] px-5 py-12 sm:px-8 sm:py-20">
        <Reveal>
          <div className="relative overflow-hidden rounded-[28px] border border-sage/25 bg-gradient-to-br from-sage-tint/70 via-surface to-surface p-8 text-center sm:p-16">
            <div className="pointer-events-none absolute inset-0">
              <div className="aurora-blob absolute -bottom-24 left-1/3 h-[300px] w-[300px] rounded-full bg-sage/20 blur-[110px]" />
            </div>
            <div className="relative">
              <h2 className="font-serif text-[30px] font-medium tracking-[-0.01em] sm:text-[42px]">{L.finalTitle}</h2>
              <p className="mt-2 text-[15px] text-ink-soft sm:text-[18px]">{L.finalSub}</p>
              <button
                type="button"
                onClick={onStart}
                className="group mt-7 inline-flex items-center gap-2 rounded-full bg-sage px-8 py-4 text-[17px] font-semibold text-white transition-all hover:bg-sage-deep active:scale-[0.98]"
              >
                {L.ctaMain}
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
          </div>
        </Reveal>
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
