"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n, LOCALES } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import { Compass, Sparkles, ArrowRight, Check, Plus, FileText, Layers, Sun, Moon, Globe, ChevronDown, Brain } from "lucide-react";

// Public marketing landing for signed-out visitors. `onStart` reveals the login
// screen. Feature demos are distributed down the page (each feature has its own
// animated mini-preview), plus a grid of bright scenario cards — all purely
// client-side (no requests, no tokens). Localized (en default / ru; zh → en).

const copy = {
  ru: {
    signIn: "Войти",
    eyebrow: "Твой личный AI-наставник по языкам",
    heroTitle: "Превращай всё, что ты учишь, в личную систему памяти",
    heroSub: "Не просто карточки. Наставник, который заставляет вспоминать слова, строит план под твой уровень и помнит твой прогресс.",
    ctaMain: "Начать бесплатно",
    ctaHint: "Без карты. Вход через Telegram, Google или email.",
    rowReaderTitle: "Читай что угодно — тапни, чтобы выучить",
    rowReaderText: "Вставь любой текст, тапни незнакомое слово — увидишь перевод и добавишь в колоду одним нажатием. CJK-сегментация из коробки.",
    rowCardsTitle: "Карточки под твой стиль",
    rowCardsText: "Листай как удобно — слово→значение, наоборот или по синонимам. Свайпом ставишь оценку, FSRS планирует следующее повторение.",
    rowDeckTitle: "Из чего угодно — колода",
    rowDeckText: "Список, PDF-учебник или фото тетради (даже от руки) — за секунды превращается в колоду для повторения по FSRS.",
    rowMemoryTitle: "Наставник, который тебя помнит",
    rowMemoryText: "Знает твою цель, интересы и слабые места — и подстраивает практику, подсказки и подбор слов под тебя. Между сессиями и устройствами.",
    scenTitle: "Практика под любую ситуацию",
    scenSub: "Наставник подстраивается под язык, уровень и то, что тебе нужно.",
    howTitle: "Как это работает",
    how: [
      { n: "01", title: "Загрузи слова", text: "Импортируй список, PDF или фото — или добавляй по одному." },
      { n: "02", title: "Практикуйся с наставником", text: "Он гоняет тебя по слабым словам и оценивает ответы." },
      { n: "03", title: "Запоминай надолго", text: "Повторения по FSRS закрепляют слова в долгую память." },
    ],
    finalTitle: "Начни учить умнее уже сегодня",
    finalSub: "Бесплатно на время беты.",
    rights: "Все права защищены.",
    terms: "Условия",
    privacy: "Конфиденциальность",
    scenarios: [
      { title: "Первый день на испанском", coach: "¡Hola! Начнём с простого — поздоровайся и скажи, кто ты.", user: "Hola, soy Alex." },
      { title: "Перед поездкой в Токио", coach: "Едешь в Токио — потренируем заказ еды.", user: "すみません、これをください。" },
      { title: "Собеседование на английском", coach: "Расскажи о себе — поправлю по ходу.", user: "I'm a software developer with…" },
      { title: "Кофе по-французски", coach: "В кафе — как попросишь кофе?", user: "Un café, s'il vous plaît." },
      { title: "Small talk на немецком", coach: "Планы на выходные? Одну фразу по-немецки.", user: "Ich gehe wandern." },
      { title: "Возвращаемся к китайскому", coach: "Вчера 的 подвело — повторим 慢慢来.", user: "我们今天做什么？" },
    ],
  },
  en: {
    signIn: "Sign in",
    eyebrow: "Your personal AI language tutor",
    heroTitle: "Turn everything you study into a personal memory system",
    heroSub: "Not just flashcards. A coach that makes you recall words, builds a plan for your level, and remembers your progress.",
    ctaMain: "Start free",
    ctaHint: "No card. Sign in with Telegram, Google or email.",
    rowReaderTitle: "Read anything — tap to learn",
    rowReaderText: "Paste any text, tap an unknown word to see its meaning, and add it to your deck in one tap. CJK segmentation built in.",
    rowCardsTitle: "Flashcards that fit how you learn",
    rowCardsText: "Flip through cards your way — word→meaning, reversed, or by synonyms. Swipe to grade; FSRS schedules the next review.",
    rowDeckTitle: "Anything → a deck",
    rowDeckText: "A list, a textbook PDF, or a photo of your notebook (even handwriting) becomes an FSRS-reviewed deck in seconds.",
    rowMemoryTitle: "A coach that remembers you",
    rowMemoryText: "Knows your goal, interests and weak spots — and tailors practice, hints and word picks to you. Across sessions and devices.",
    scenTitle: "Practice for any situation",
    scenSub: "The coach adapts to your language, your level and what you actually need.",
    howTitle: "How it works",
    how: [
      { n: "01", title: "Load your words", text: "Import a list, a PDF or a photo — or add them one by one." },
      { n: "02", title: "Practice with the coach", text: "It drills your weak words and grades your answers." },
      { n: "03", title: "Remember for good", text: "FSRS reviews lock the words into long-term memory." },
    ],
    finalTitle: "Start learning smarter today",
    finalSub: "Free during the beta.",
    rights: "All rights reserved.",
    terms: "Terms",
    privacy: "Privacy",
    scenarios: [
      { title: "Day one in Spanish", coach: "¡Hola! Let's start simple — say hello and who you are.", user: "Hola, soy Alex." },
      { title: "Before a trip to Tokyo", coach: "You're headed to Tokyo — let's practice ordering food.", user: "すみません、これをください。" },
      { title: "A job interview in English", coach: "Tell me about yourself — I'll fix it as you go.", user: "I'm a software developer with…" },
      { title: "Ordering coffee in French", coach: "At the café — how do you ask for a coffee?", user: "Un café, s'il vous plaît." },
      { title: "Small talk in German", coach: "Weekend plans? Say one thing in German.", user: "Ich gehe wandern." },
      { title: "Picking Chinese back up", coach: "Yesterday 的 tripped you — let's redo it 慢慢来.", user: "我们今天做什么？" },
    ],
  },
};

// ---------- shared helpers ----------
function useStepper(steps: number, delay = 1000) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (i >= steps) return;
    const t = setTimeout(() => setI((v) => v + 1), delay);
    return () => clearTimeout(t);
  }, [i, steps, delay]);
  return i;
}

// Reveal on scroll into view.
function Reveal({ children, delay = 0, className = "" }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (el.classList.add("reveal-in"), io.unobserve(el))),
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

// Only mount children once scrolled near — so each demo starts its animation
// exactly when the reader reaches it (not all at page load).
function WhenVisible({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (setSeen(true), io.disconnect())),
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className="min-h-[300px]">
      {seen ? children : null}
    </div>
  );
}

function MockRich({ text }: { text: string }) {
  const parts = text.split(/(\*[^*]+\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        /^\*[^*]+\*$/.test(p) ? (
          <span key={i} className="rounded bg-sage-tint px-1 font-semibold text-sage-deep">{p.slice(1, -1)}</span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}

function CoachDot() {
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sage text-white">
      <Compass className="h-4 w-4" />
    </span>
  );
}

function DemoCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[400px] rounded-[24px] border border-black/[0.08] bg-surface p-4 shadow-[0_30px_70px_rgba(46,42,38,0.14)]">
      {children}
    </div>
  );
}

// ---------- animated feature demos ----------
function PracticeScene({ locale }: { locale: string }) {
  const ru = locale === "ru";
  const meaning = ru ? "если только не" : "if not · except if";
  const turns = ru
    ? [
        { role: "coach", text: "Начнём со слова *unless* — составь короткое предложение." },
        { role: "hint", text: "💡 Подсказка: I won't … *unless* …" },
        { role: "user", text: "I won't go unless you come with me." },
        { role: "grade", text: "Отлично — естественно и верно!" },
      ]
    : [
        { role: "coach", text: "Let's start with *unless* — make a short sentence." },
        { role: "hint", text: "💡 Hint: I won't … *unless* …" },
        { role: "user", text: "I won't go unless you come with me." },
        { role: "grade", text: "Perfect — natural and correct!" },
      ];
  const step = useStepper(turns.length, 1200);
  const typing = step < turns.length && turns[step].role !== "user";
  return (
    <DemoCard>
      <div className="mb-3 flex items-center justify-center rounded-[16px] border border-sage/25 bg-gradient-to-br from-sage-tint/60 to-surface px-4 py-3 text-center">
        <div>
          <div className="font-serif text-[24px] font-semibold leading-none text-ink">unless</div>
          <div className="mt-1 text-[12px] font-medium text-sage-deep">{meaning}</div>
        </div>
      </div>
      <div className="flex min-h-[210px] flex-col gap-2.5">
        {turns.slice(0, step).map((t, i) =>
          t.role === "user" ? (
            <div key={i} className="anim-fade-up flex justify-end">
              <div className="max-w-[80%] rounded-[14px] rounded-br-sm bg-sage px-3 py-2 text-[13.5px] leading-snug text-white">{t.text}</div>
            </div>
          ) : (
            <div key={i} className="anim-fade-up flex items-end gap-2">
              <CoachDot />
              <div className="max-w-[82%]">
                {t.role === "grade" && (
                  <span className="mb-1 inline-flex items-center gap-1 rounded-full border border-sage/40 bg-sage-tint px-1.5 py-0.5 text-[10px] font-semibold text-sage-deep">
                    <Check className="h-2.5 w-2.5" strokeWidth={3} /> {ru ? "Верно" : "Correct"}
                  </span>
                )}
                <div className={`rounded-[14px] rounded-bl-sm border px-3 py-2 text-[13.5px] leading-snug ${t.role === "hint" ? "border-sage/30 bg-sage-tint/40 text-sage-deep" : "border-black/[0.06] bg-paper text-ink"}`}>
                  <MockRich text={t.text} />
                </div>
              </div>
            </div>
          ),
        )}
        {typing && (
          <div className="anim-fade-in flex items-end gap-2">
            <CoachDot />
            <div className="flex items-center gap-1 rounded-[14px] rounded-bl-sm border border-black/[0.06] bg-paper px-3 py-2.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.2s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint [animation-delay:-0.1s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-ink-faint" />
            </div>
          </div>
        )}
      </div>
    </DemoCard>
  );
}

function ReaderScene({ locale }: { locale: string }) {
  const ru = locale === "ru";
  const step = useStepper(3, 1300);
  const tapped = step >= 1;
  const showGloss = step >= 2;
  const added = step >= 3;
  return (
    <DemoCard>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{ru ? "Чтение · тапни слово" : "Reader · tap a word"}</div>
      <p className="min-h-[132px] rounded-[16px] border border-black/[0.06] bg-paper p-4 font-serif text-[17px] leading-relaxed text-ink">
        The city proved remarkably{" "}
        <span className="relative inline-block">
          <span className={`rounded px-1 transition-colors ${added ? "bg-sage-tint text-sage-deep" : tapped ? "bg-news-hl text-sage-deep" : ""}`}>resilient</span>
          {showGloss && !added && (
            <span className="anim-popover absolute left-1/2 top-full z-10 mt-2 w-[188px] -translate-x-1/2 rounded-[12px] border border-black/[0.08] bg-surface p-2.5 text-left font-sans shadow-[0_14px_36px_rgba(46,42,38,0.18)]">
              <span className="block text-[13px] font-semibold text-ink">resilient</span>
              <span className="mt-0.5 block text-[13px] text-sage-deep">устойчивый, стойкий</span>
              <span className="mt-2 flex items-center justify-center gap-1 rounded-full bg-sage px-2 py-1 text-[11px] font-semibold text-white">
                <Plus className="h-3 w-3" /> {ru ? "Добавить" : "Add"}
              </span>
            </span>
          )}
        </span>{" "}
        after the flood.
      </p>
      <div className="mt-3 h-8">
        {added && (
          <div className="anim-fade-up inline-flex items-center gap-1.5 rounded-full border border-sage/40 bg-sage-tint px-3 py-1.5 text-[12px] font-semibold text-sage-deep">
            <Check className="h-3.5 w-3.5" strokeWidth={3} /> {ru ? "Добавлено в колоду" : "Added to your deck"}
          </div>
        )}
      </div>
    </DemoCard>
  );
}

function DeckScene({ locale }: { locale: string }) {
  const ru = locale === "ru";
  const step = useStepper(4, 850);
  const cards: [string, string][] = [
    ["ubiquitous", "вездесущий"],
    ["curb", "сдерживать"],
    ["scalable", "масштабируемый"],
  ];
  return (
    <DemoCard>
      <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink-muted">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-paper px-2.5 py-1"><FileText className="h-3.5 w-3.5" /> PDF</span>
        <ArrowRight className="h-4 w-4 text-ink-faint" />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-tint px-2.5 py-1 text-sage-deep"><Layers className="h-3.5 w-3.5" /> {ru ? "Колода" : "Deck"}</span>
      </div>
      <div className="flex min-h-[168px] flex-col gap-2">
        {cards.slice(0, step).map(([w, m], i) => (
          <div key={i} className="anim-fade-up flex items-center justify-between rounded-[12px] border border-black/[0.07] bg-paper px-3 py-2.5">
            <span className="text-[15px] font-semibold text-ink">{w}</span>
            <span className="text-[13px] text-sage-deep">{m}</span>
          </div>
        ))}
      </div>
      {step >= cards.length && (
        <div className="anim-fade-up mt-3 text-[12px] font-semibold text-sage-deep">{ru ? "12 карточек готовы к повторению" : "12 cards ready to review"}</div>
      )}
    </DemoCard>
  );
}

function FlashcardScene({ locale }: { locale: string }) {
  const ru = locale === "ru";
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setFlipped((f) => !f), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <DemoCard>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{ru ? "Карточки · нажми, чтобы перевернуть" : "Flashcards · tap to flip"}</div>
      <div className="flip-scene">
        <div className={`flip-card ${flipped ? "is-flipped" : ""}`}>
          <div className="flip-face flex min-h-[204px] flex-col items-center justify-center rounded-[16px] border border-black/[0.06] bg-paper p-6 text-center">
            <div className="font-serif text-[30px] font-semibold text-ink">resilient</div>
            <div className="mt-1 text-[13px] text-ink-faint">/rɪˈzɪl.i.ənt/</div>
            <div className="mt-4 text-[12px] text-ink-faint">{ru ? "вспомни значение…" : "recall the meaning…"}</div>
          </div>
          <div className="flip-face flip-back flex min-h-[204px] flex-col justify-center rounded-[16px] border border-sage/30 bg-sage-tint/40 p-6">
            <div className="font-serif text-[22px] font-semibold text-ink">resilient</div>
            <div className="mt-1 text-[15px] font-medium text-sage-deep">{ru ? "устойчивый, стойкий" : "устойчивый (resilient)"}</div>
            <div className="mt-3 font-serif text-[14px] italic leading-snug text-quote">“The city proved remarkably resilient after the flood.”</div>
          </div>
        </div>
      </div>
    </DemoCard>
  );
}

function MemoryScene({ locale }: { locale: string }) {
  const ru = locale === "ru";
  const step = useStepper(3, 900);
  const rows = ru
    ? [
        { k: "Цель", v: "IELTS 7.0 через 3 месяца" },
        { k: "Интересы", v: "технологии, стартапы" },
        { k: "Замечено", v: "путает past simple и present perfect" },
      ]
    : [
        { k: "Goal", v: "IELTS 7.0 in 3 months" },
        { k: "Interests", v: "tech, startups" },
        { k: "Noticed", v: "mixes up past simple & present perfect" },
      ];
  return (
    <DemoCard>
      <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        <Brain className="h-4 w-4 text-sage-deep" /> {ru ? "Что наставник знает о тебе" : "What your coach knows about you"}
      </div>
      <div className="flex min-h-[168px] flex-col gap-2">
        {rows.slice(0, step).map((r, i) => (
          <div key={i} className="anim-fade-up rounded-[12px] border border-black/[0.07] bg-paper px-3.5 py-2.5">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{r.k}</div>
            <div className="mt-0.5 text-[14px] font-medium text-ink">{r.v}</div>
          </div>
        ))}
      </div>
    </DemoCard>
  );
}

function ScenarioCard({ s }: { s: { title: string; coach: string; user: string } }) {
  return (
    <div className="flex h-full flex-col rounded-[20px] border border-black/[0.07] bg-surface p-5 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_18px_44px_rgba(46,42,38,0.1)]">
      <div className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full bg-sage" />
        <span className="h-2.5 w-2.5 rounded-full bg-taupe" />
        <span className="h-2.5 w-2.5 rounded-full bg-warn" />
      </div>
      <h3 className="mt-4 font-serif text-[19px] font-semibold text-ink">{s.title}</h3>
      <div className="mt-3 flex flex-col gap-2">
        <div className="flex items-start gap-1.5 text-[13px] leading-snug text-ink-soft">
          <span className="shrink-0 font-semibold text-sage-deep">Coach</span>
          <span>“{s.coach}”</span>
        </div>
        <div className="self-end rounded-[12px] rounded-br-sm bg-sage px-3 py-1.5 text-[13px] font-medium text-white">{s.user}</div>
      </div>
    </div>
  );
}

// ---------- header controls ----------
function LangMenu() {
  const { locale, setLocale } = useI18n();
  const [open, setOpen] = useState(false);
  const cur = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.1] px-3 py-2 text-sm font-semibold text-ink-muted transition-colors hover:border-sage/60 hover:text-ink">
        <Globe className="h-4 w-4" /> {cur.label} <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <button type="button" aria-hidden className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1.5 min-w-[120px] overflow-hidden rounded-[14px] border border-black/[0.08] bg-surface p-1 shadow-[0_16px_40px_rgba(46,42,38,0.18)]">
            {LOCALES.map((l) => (
              <button key={l.code} type="button" onClick={() => { setLocale(l.code); setOpen(false); }} className="flex w-full items-center justify-between gap-3 rounded-[10px] px-3 py-2 text-sm font-semibold text-ink-muted transition-colors hover:bg-sage-tint hover:text-sage-deep">
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
    <button type="button" onClick={toggle} aria-label="Toggle theme" className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/[0.1] text-ink-muted transition-colors hover:border-sage/60 hover:text-ink">
      {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

// ---------- feature row ----------
function FeatureRow({ title, text, demo, flip }: { title: string; text: string; demo: React.ReactNode; flip?: boolean }) {
  return (
    <Reveal>
      <div className="grid items-center gap-8 lg:grid-cols-2 lg:gap-14">
        <div className={flip ? "lg:order-2" : ""}>
          <h3 className="font-serif text-[26px] font-medium tracking-[-0.01em] sm:text-[34px]">{title}</h3>
          <p className="mt-3 max-w-[460px] text-[16px] leading-relaxed text-ink-soft sm:text-[17px]">{text}</p>
        </div>
        <div className={flip ? "lg:order-1" : ""}>
          <WhenVisible>{demo}</WhenVisible>
        </div>
      </div>
    </Reveal>
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
          <span className="bg-gradient-to-r from-sage-deep via-sage to-taupe bg-clip-text font-serif text-[22px] font-semibold tracking-[-0.01em] text-transparent">Lexa</span>
          <div className="flex items-center gap-2">
            <LangMenu />
            <ThemeToggle />
            <button type="button" onClick={onStart} className="rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sage-deep">{L.signIn}</button>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="aurora-blob absolute -top-32 left-[15%] h-[420px] w-[420px] rounded-full bg-sage/25 blur-[120px]" />
          <div className="aurora-blob slow absolute -top-10 right-[12%] h-[380px] w-[380px] rounded-full bg-taupe/25 blur-[120px]" />
        </div>
        <div className="relative mx-auto grid max-w-[1080px] items-center gap-10 px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20 lg:grid-cols-2">
          <div className="text-center lg:text-left">
            <span className="anim-fade-up inline-flex items-center gap-1.5 rounded-full border border-sage/25 bg-sage-tint/60 px-3.5 py-1.5 text-[13px] font-semibold text-sage-deep backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" /> {L.eyebrow}
            </span>
            <h1 className="anim-fade-up mx-auto mt-6 max-w-[560px] font-serif text-[36px] font-medium leading-[1.06] tracking-[-0.02em] sm:text-[52px] lg:mx-0 lg:max-w-none" style={{ animationDelay: "60ms" }}>
              {L.heroTitle}
            </h1>
            <p className="anim-fade-up mx-auto mt-6 max-w-[480px] text-[16px] leading-relaxed text-ink-soft sm:text-[19px] lg:mx-0" style={{ animationDelay: "120ms" }}>
              {L.heroSub}
            </p>
            <div className="anim-fade-up mt-9 flex flex-col items-center gap-3 lg:items-start" style={{ animationDelay: "180ms" }}>
              <button type="button" onClick={onStart} className="group inline-flex items-center gap-2 rounded-full bg-sage px-8 py-4 text-[17px] font-semibold text-white shadow-[0_16px_40px_rgba(124,152,133,0.4)] transition-all hover:bg-sage-deep hover:shadow-[0_20px_50px_rgba(124,152,133,0.5)] active:scale-[0.98]">
                {L.ctaMain} <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
              </button>
              <span className="text-[13px] text-ink-faint">{L.ctaHint}</span>
            </div>
          </div>
          <div className="anim-fade-up" style={{ animationDelay: "240ms" }}>
            <PracticeScene locale={locale} />
          </div>
        </div>
      </section>

      {/* feature rows — each with its own animated demo */}
      <section className="mx-auto flex max-w-[1080px] flex-col gap-16 px-5 py-10 sm:px-8 sm:gap-24 sm:py-16">
        <FeatureRow title={L.rowReaderTitle} text={L.rowReaderText} demo={<ReaderScene locale={locale} />} />
        <FeatureRow title={L.rowCardsTitle} text={L.rowCardsText} demo={<FlashcardScene locale={locale} />} flip />
        <FeatureRow title={L.rowDeckTitle} text={L.rowDeckText} demo={<DeckScene locale={locale} />} />
        <FeatureRow title={L.rowMemoryTitle} text={L.rowMemoryText} demo={<MemoryScene locale={locale} />} flip />
      </section>

      {/* scenario grid — brief, bright, many languages/situations */}
      <section className="mx-auto max-w-[1080px] px-5 py-10 sm:px-8 sm:py-16">
        <Reveal>
          <h2 className="text-center font-serif text-[27px] font-medium tracking-[-0.01em] sm:text-[34px]">{L.scenTitle}</h2>
          <p className="mx-auto mt-2 max-w-[520px] text-center text-[15px] text-ink-soft">{L.scenSub}</p>
        </Reveal>
        <div className="mt-9 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {L.scenarios.map((s, i) => (
            <Reveal key={s.title} delay={(i % 3) * 80}>
              <ScenarioCard s={s} />
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
                <span className="font-serif text-[26px] font-bold text-sage-deep">{s.n}</span>
                <h3 className="mt-3 font-serif text-[18px] font-semibold">{s.title}</h3>
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
              <button type="button" onClick={onStart} className="group mt-7 inline-flex items-center gap-2 rounded-full bg-sage px-8 py-4 text-[17px] font-semibold text-white transition-all hover:bg-sage-deep active:scale-[0.98]">
                {L.ctaMain} <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
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
