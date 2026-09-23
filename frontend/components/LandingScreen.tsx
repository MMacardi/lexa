"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useI18n } from "@/lib/i18n";
import { LangMenu, ThemeToggle, Reveal } from "@/components/LandingChrome";
import { Compass, Sparkles, ArrowRight, Check, Plus, FileText, Layers, Brain, Clapperboard } from "lucide-react";

// Public marketing landing for signed-out visitors. `onStart` reveals the login
// screen. Feature demos are distributed down the page (each feature has its own
// animated mini-preview), plus a grid of bright scenario cards — all purely
// client-side (no requests, no tokens). Localized (en / ru / zh).

const copy = {
  ru: {
    signIn: "Войти",
    eyebrow: "Твой личный ИИ-наставник по языкам",
    heroTitle: "Превращай всё, что изучаешь, в личную систему памяти",
    heroSub: "Умные карточки и интервальные повторения — плюс личный ИИ-наставник: подсказывает, что учить, тренирует на практике и помнит твой прогресс.",
    ctaMain: "Начать бесплатно",
    ctaHint: "Карта не нужна. Вход через Telegram, Google или email.",
    pillars: [
      { t: "Умные карточки", s: "интервальные повторения (FSRS)" },
      { t: "ИИ-наставник", s: "тренирует и подстраивается" },
      { t: "Помнит тебя", s: "цель, интересы, слабые места" },
    ],
    rowReaderTitle: "Читай что угодно — тапни, чтобы выучить",
    rowReaderText: "Вставь любой текст, тапни незнакомое слово — увидишь перевод и добавишь в колоду одним нажатием. CJK-сегментация из коробки.",
    rowCardsTitle: "Карточки под твой стиль",
    rowCardsText: "Листай как удобно — слово→значение, наоборот или по синонимам. Свайпом ставишь оценку, FSRS планирует следующее повторение.",
    rowDeckTitle: "Из чего угодно — готовая колода",
    rowDeckText: "Список, PDF-учебник или фото тетради (даже от руки) — за секунды превращается в колоду для повторения по FSRS.",
    rowMemoryTitle: "Наставник, который тебя помнит",
    rowMemoryText: "Знает твою цель, интересы и слабые места — и подстраивает практику, подсказки и подбор слов под тебя. Между сессиями и устройствами.",
    scenTitle: "Практика под любую ситуацию",
    scenSub: "Наставник подстраивается под язык, уровень и то, что тебе нужно.",
    scenSteps: [
      { t: "Выбери сцену", s: "персонаж и ситуация под твою цель" },
      { t: "Говори внутри истории", s: "слова твоей колоды вплетаются в диалог" },
      { t: "Получи отчёт", s: "ошибки и успехи уходят в интервальные повторения" },
    ],
    scenes: [
      { img: "/scenes/bakery.webp", title: "Пекарня", teaser: "Закажите хлеб и выпечку у вежливого пекаря.", words: ["a baguette", "fresh", "a slice"] },
      { img: "/scenes/cinema.webp", title: "Кинотеатр", teaser: "Спросите про сеансы и возьмите два билета.", words: ["showtimes", "tickets", "row"] },
      { img: "/scenes/office.webp", title: "Офис", teaser: "Обсудите задачу с коллегой между встречами.", words: ["deadline", "to schedule", "follow up"] },
      { img: "/scenes/cafe.webp", title: "Кафе", teaser: "Встретьте друга за кофе и поболтайте.", words: ["to catch up", "on tap", "cosy"] },
      { img: "/scenes/travel.webp", title: "Дорога", teaser: "Заселитесь в отель и уточните всё важное.", words: ["check-in", "luggage", "view"] },
      { img: "/scenes/interview.webp", title: "Собеседование", teaser: "Расскажите о себе — и получите обратную связь.", words: ["strength", "experience", "to hire"] },
    ],
    howTitle: "Как это работает",
    how: [
      { n: "01", title: "Загрузи слова", text: "Импортируй список, PDF или фото — или добавляй по одному." },
      { n: "02", title: "Практикуйся с наставником", text: "Он тренирует тебя на слабых словах и оценивает ответы." },
      { n: "03", title: "Запоминай надолго", text: "Повторения по FSRS закрепляют слова в долговременную память." },
    ],
    finalTitle: "Начни учиться умнее уже сегодня",
    finalSub: "Бесплатно на время беты.",
    rights: "Все права защищены.",
    terms: "Условия",
    privacy: "Конфиденциальность",
    faqTitle: "Частые вопросы",
    faq: [
      { q: "Чем это отличается от обычного приложения с карточками?", a: "Вместо простого перелистывания наставник заставляет вспоминать каждое слово — ты его употребляешь, он проверяет ответ, исправляет и подстраивается. Карточки, интервальные повторения и читалка уже внутри; закрепляет именно коучинг." },
      { q: "Подойдёт, если я совсем новичок?", a: "Да. Скажи наставнику свой уровень и цель — он построит план: какие слова учить и по сколько новых в день. А карточки и интервальные повторения закрепят их в памяти." },
      { q: "А для продвинутых полезно?", a: "Конечно. Поставь уровень выше — наставник разбирает нюансы, регистр и сложные слова и повышает сложность по мере прогресса." },
      { q: "Это ИИ — что с моими данными и голосом?", a: "Голосовые ответы в вебе распознаёт сам браузер — для этого ничего не загружается на сервер. Твои слова и прогресс принадлежат тебе; мы обрабатываем их только чтобы приложение работало. Подробнее —", link: { text: "Политика конфиденциальности", href: "/privacy" } },
      { q: "Это бесплатно? Что такое Pro?", a: "На время беты — бесплатно. Позже план Pro снимет дневные лимиты ИИ и добавит бонусы, но твои слова и прогресс всегда можно оставить и выгрузить бесплатно." },
      { q: "Какие языки поддерживаются и можно ли перенести свои слова?", a: "Много языковых пар, включая китайский, японский и корейский. Свои слова можно перенести: вставить список, загрузить PDF, сфотографировать тетрадь или импортировать экспорт из другого приложения." },
    ],
  },
  en: {
    signIn: "Sign in",
    eyebrow: "Your personal AI language tutor",
    heroTitle: "Turn everything you study into a personal memory system",
    heroSub: "Smart flashcards and spaced repetition — plus a personal AI coach that picks what to learn, drills you, and remembers your progress.",
    ctaMain: "Start free",
    ctaHint: "No card. Sign in with Telegram, Google or email.",
    pillars: [
      { t: "Smart flashcards", s: "spaced repetition (FSRS)" },
      { t: "AI coach", s: "drills you and adapts" },
      { t: "Remembers you", s: "goal, interests, weak spots" },
    ],
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
    scenSteps: [
      { t: "Pick a scene", s: "a character and a situation that fit your goal" },
      { t: "Talk inside the story", s: "your deck's words get woven into the dialogue" },
      { t: "Get a report", s: "misses and wins feed your spaced repetition" },
    ],
    scenes: [
      { img: "/scenes/bakery.webp", title: "The bakery", teaser: "Order bread and pastries from a friendly baker.", words: ["a baguette", "fresh", "a slice"] },
      { img: "/scenes/cinema.webp", title: "The cinema", teaser: "Ask about showtimes and grab two tickets.", words: ["showtimes", "tickets", "row"] },
      { img: "/scenes/office.webp", title: "The office", teaser: "Talk a task through with a coworker between meetings.", words: ["deadline", "to schedule", "follow up"] },
      { img: "/scenes/cafe.webp", title: "The café", teaser: "Meet a friend for coffee and catch up.", words: ["to catch up", "on tap", "cosy"] },
      { img: "/scenes/travel.webp", title: "On the road", teaser: "Check into a hotel and sort out the details.", words: ["check-in", "luggage", "view"] },
      { img: "/scenes/interview.webp", title: "The interview", teaser: "Tell them about yourself — and get it right.", words: ["strength", "experience", "to hire"] },
    ],
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
    faqTitle: "Frequently asked questions",
    faq: [
      { q: "How is this different from a normal flashcard app?", a: "Instead of just flipping cards, a coach makes you recall each word — you use it, it checks your answer, corrects you and adapts. Cards, spaced repetition and a reader are built in; the coaching is what makes it stick." },
      { q: "Can I use it as a complete beginner?", a: "Yes. Tell the coach your level and goal and it builds a plan — which words to learn and how many new ones a day. Cards and spaced repetition then lock them into memory." },
      { q: "Is it useful for advanced learners?", a: "Absolutely. Set a higher level and the coach drills nuance, register and tricky words, adapting the difficulty as you improve." },
      { q: "It's AI — what about my data and voice?", a: "Voice answers on the web are transcribed by your own browser — nothing is uploaded for that. Your words and progress are yours; we only process them to run the app. See the", link: { text: "Privacy Policy", href: "/privacy" } },
      { q: "Is it free? What's Pro?", a: "It's free during the beta. Later a Pro plan will lift the daily AI limits and add extras — but your saved words and progress are always free to keep and export." },
      { q: "Which languages are supported, and can I import my existing words?", a: "Many language pairs, including Chinese, Japanese and Korean. Bring your words by pasting a list, dropping a PDF, snapping a photo of your notebook, or importing an export from another app." },
    ],
  },
  zh: {
    signIn: "登录",
    eyebrow: "你的专属 AI 语言导师",
    heroTitle: "把你学的一切,变成一套私人记忆系统",
    heroSub: "智能卡片与间隔重复——再加一位专属 AI 导师:帮你决定学什么、带你实战练习,并记住你的进度。",
    ctaMain: "免费开始",
    ctaHint: "无需银行卡。用 Telegram、Google 或邮箱登录。",
    pillars: [
      { t: "智能卡片", s: "间隔重复 (FSRS)" },
      { t: "AI 导师", s: "带你练习、随你调整" },
      { t: "记住你", s: "目标、兴趣、薄弱点" },
    ],
    rowReaderTitle: "读任何内容——点一下就学会",
    rowReaderText: "粘贴任意文本,点一下生词即可看到释义,一键加入卡组。内置中日韩分词。",
    rowCardsTitle: "贴合你学习方式的卡片",
    rowCardsText: "按你喜欢的方式翻阅——词→义、反向或按同义词。滑动评分,FSRS 安排下次复习。",
    rowDeckTitle: "任何内容 → 一副卡组",
    rowDeckText: "一份清单、教材 PDF,或笔记本的照片(哪怕手写),几秒内变成可用 FSRS 复习的卡组。",
    rowMemoryTitle: "一位记住你的导师",
    rowMemoryText: "了解你的目标、兴趣和薄弱点——为你定制练习、提示和选词。跨会话、跨设备。",
    scenTitle: "为任何场景而练",
    scenSub: "导师会根据你的语言、水平和真正需要的内容来调整。",
    scenSteps: [
      { t: "选择一个场景", s: "贴合你目标的角色与情境" },
      { t: "在故事里对话", s: "你卡组的词会织进对话中" },
      { t: "获得报告", s: "错处与亮点都汇入间隔重复" },
    ],
    scenes: [
      { img: "/scenes/bakery.webp", title: "面包店", teaser: "向亲切的店员点面包和糕点。", words: ["a baguette", "fresh", "a slice"] },
      { img: "/scenes/cinema.webp", title: "电影院", teaser: "询问场次并买两张票。", words: ["showtimes", "tickets", "row"] },
      { img: "/scenes/office.webp", title: "办公室", teaser: "在会议间隙和同事敲定一项任务。", words: ["deadline", "to schedule", "follow up"] },
      { img: "/scenes/cafe.webp", title: "咖啡馆", teaser: "和朋友喝杯咖啡、叙叙旧。", words: ["to catch up", "on tap", "cosy"] },
      { img: "/scenes/travel.webp", title: "旅途中", teaser: "入住酒店并安排好各项细节。", words: ["check-in", "luggage", "view"] },
      { img: "/scenes/interview.webp", title: "面试", teaser: "介绍你自己——并表现出色。", words: ["strength", "experience", "to hire"] },
    ],
    howTitle: "它是如何运作的",
    how: [
      { n: "01", title: "导入单词", text: "导入清单、PDF 或照片——或逐个添加。" },
      { n: "02", title: "跟导师练习", text: "它专练你的弱词,并为你的回答打分。" },
      { n: "03", title: "长久记住", text: "FSRS 复习把单词锁进长期记忆。" },
    ],
    finalTitle: "今天就开始更聪明的学习",
    finalSub: "内测期间免费。",
    rights: "版权所有。",
    terms: "条款",
    privacy: "隐私",
    faqTitle: "常见问题",
    faq: [
      { q: "它和普通卡片应用有什么不同?", a: "不只是翻卡片——导师会让你主动回忆每个单词:你去用它,它检查你的答案、纠正并调整。卡片、间隔重复和读客都已内置,真正让知识牢固的是这种教练式练习。" },
      { q: "完全零基础也能用吗?", a: "可以。告诉导师你的水平和目标,它会制定计划——学哪些词、每天学多少新词。之后卡片和间隔重复把它们牢牢记住。" },
      { q: "对高水平学习者有用吗?", a: "当然。把水平调高,导师就会训练细微差别、语域和难词,并随你的进步调整难度。" },
      { q: "这是 AI——我的数据和语音怎么办?", a: "网页上的语音回答由你自己的浏览器识别——此过程不上传任何内容。你的单词和进度归你所有,我们仅为运行应用而处理它们。详见——", link: { text: "隐私政策", href: "/privacy" } },
      { q: "免费吗?Pro 是什么?", a: "内测期间免费。之后 Pro 方案会解除每日 AI 限制并增加更多功能——但你保存的单词和进度永远可以免费保留和导出。" },
      { q: "支持哪些语言?我能导入已有的单词吗?", a: "支持很多语言对,包括中文、日语和韩语。你可以粘贴清单、上传 PDF、拍下笔记本,或导入其他应用的导出文件,把你的单词带过来。" },
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
  const zh = locale === "zh";
  const meaning = ru ? "если только не" : zh ? "除非;如果不" : "if not · except if";
  const turns = ru
    ? [
        { role: "coach", text: "Начнём со слова *unless* — составь короткое предложение." },
        { role: "hint", text: "Подсказка: I won't … *unless* …" },
        { role: "user", text: "I won't go unless you come with me." },
        { role: "grade", text: "Отлично — естественно и верно!" },
      ]
    : zh
    ? [
        { role: "coach", text: "先从 *unless* 开始——造一个短句。" },
        { role: "hint", text: "提示:I won't … *unless* …" },
        { role: "user", text: "I won't go unless you come with me." },
        { role: "grade", text: "很好——自然又正确!" },
      ]
    : [
        { role: "coach", text: "Let's start with *unless* — make a short sentence." },
        { role: "hint", text: "Hint: I won't … *unless* …" },
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
                    <Check className="h-2.5 w-2.5" strokeWidth={3} /> {ru ? "Верно" : zh ? "正确" : "Correct"}
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

// Interactive: really tap the highlighted words to see a gloss + add them.
function ReaderScene({ locale }: { locale: string }) {
  const ru = locale === "ru";
  const zh = locale === "zh";
  const glosses: Record<string, string> = {
    proved: ru ? "оказался, проявил себя" : zh ? "结果是,证明是" : "proved · turned out",
    remarkably: ru ? "удивительно, поразительно" : zh ? "显著地,异常地" : "remarkably",
    resilient: ru ? "устойчивый, стойкий" : zh ? "有韧性的,适应力强的" : "resilient · стойкий",
    flood: ru ? "наводнение" : zh ? "洪水" : "flood · наводнение",
  };
  const [open, setOpen] = useState<string | null>(null);

  const W = (word: string) => {
    const isOpen = open === word;
    return (
      <span className="relative inline-block">
        <button
          type="button"
          onClick={() => setOpen(isOpen ? null : word)}
          className={`rounded px-1 transition-colors ${
            isOpen
              ? "bg-news-hl text-sage-deep"
              : "underline decoration-dotted decoration-sage/50 underline-offset-[5px] hover:bg-news-hl hover:text-sage-deep"
          }`}
        >
          {word}
        </button>
        {isOpen && (
          <span className="anim-popover absolute left-1/2 top-full z-20 mt-2 w-[190px] -translate-x-1/2 rounded-[12px] border border-black/[0.08] bg-surface p-2.5 text-left font-sans shadow-[0_14px_36px_rgba(46,42,38,0.18)]">
            <span className="block text-[13px] font-semibold text-ink">{word}</span>
            <span className="mt-0.5 block text-[13px] text-sage-deep">{glosses[word]}</span>
          </span>
        )}
      </span>
    );
  };

  return (
    <DemoCard>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{ru ? "Чтение · тапни подчёркнутое слово" : zh ? "阅读 · 点击带下划线的词" : "Reader · tap an underlined word"}</div>
      <div className="relative">
        {open && <button type="button" aria-hidden className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(null)} />}
        <p className="relative z-0 min-h-[132px] rounded-[16px] border border-black/[0.06] bg-paper p-4 font-serif text-[17px] leading-relaxed text-ink">
          The city {W("proved")} {W("remarkably")} {W("resilient")} after the {W("flood")}.
        </p>
      </div>
      <div className="mt-3 text-[12px] leading-snug text-ink-faint">
        {ru ? "Перевод появляется прямо в тексте — не уходя со страницы." : zh ? "释义直接出现在文中——无需离开页面。" : "Meanings appear right in the text — without leaving the page."}
      </div>
    </DemoCard>
  );
}

function DeckScene({ locale }: { locale: string }) {
  const ru = locale === "ru";
  const zh = locale === "zh";
  const step = useStepper(4, 850);
  const cards: [string, string][] = ru
    ? [
        ["ubiquitous", "вездесущий"],
        ["curb", "сдерживать"],
        ["scalable", "масштабируемый"],
      ]
    : zh
    ? [
        ["ubiquitous", "无处不在的"],
        ["curb", "抑制"],
        ["scalable", "可扩展的"],
      ]
    : [
        ["ubiquitous", "omnipresent"],
        ["curb", "restrain"],
        ["scalable", "expandable"],
      ];
  return (
    <DemoCard>
      <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink-muted">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-paper px-2.5 py-1"><FileText className="h-3.5 w-3.5" /> PDF</span>
        <ArrowRight className="h-4 w-4 text-ink-faint" />
        <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-tint px-2.5 py-1 text-sage-deep"><Layers className="h-3.5 w-3.5" /> {ru ? "Колода" : zh ? "卡组" : "Deck"}</span>
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
        <div className="anim-fade-up mt-3 text-[12px] font-semibold text-sage-deep">{ru ? "12 карточек готовы к повторению" : zh ? "12 张卡片已可复习" : "12 cards ready to review"}</div>
      )}
    </DemoCard>
  );
}

function FlashcardScene({ locale }: { locale: string }) {
  const ru = locale === "ru";
  const zh = locale === "zh";
  const [flipped, setFlipped] = useState(false);
  useEffect(() => {
    const t = setInterval(() => setFlipped((f) => !f), 2600);
    return () => clearInterval(t);
  }, []);
  return (
    <DemoCard>
      <div className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{ru ? "Карточки · нажми, чтобы перевернуть" : zh ? "卡片 · 点击翻转" : "Flashcards · tap to flip"}</div>
      <div className="flip-scene cursor-pointer" onClick={() => setFlipped((f) => !f)}>
        <div className={`flip-card ${flipped ? "is-flipped" : ""}`}>
          <div className="flip-face flex min-h-[204px] flex-col items-center justify-center rounded-[16px] border border-black/[0.06] bg-paper p-6 text-center">
            <div className="font-serif text-[30px] font-semibold text-ink">resilient</div>
            <div className="mt-1 text-[13px] text-ink-faint">/rɪˈzɪl.i.ənt/</div>
            <div className="mt-4 text-[12px] text-ink-faint">{ru ? "вспомни значение…" : zh ? "回忆释义…" : "recall the meaning…"}</div>
          </div>
          <div className="flip-face flip-back flex min-h-[204px] flex-col justify-center rounded-[16px] border border-sage/30 bg-sage-tint/40 p-6">
            <div className="font-serif text-[22px] font-semibold text-ink">resilient</div>
            <div className="mt-1 text-[15px] font-medium text-sage-deep">{ru ? "устойчивый, стойкий" : zh ? "有韧性的,适应力强的" : "able to recover quickly"}</div>
            <div className="mt-3 font-serif text-[14px] italic leading-snug text-quote">“The city proved remarkably resilient after the flood.”</div>
          </div>
        </div>
      </div>
    </DemoCard>
  );
}

function MemoryScene({ locale }: { locale: string }) {
  const ru = locale === "ru";
  const zh = locale === "zh";
  const step = useStepper(3, 900);
  const rows = ru
    ? [
        { k: "Цель", v: "IELTS 7.0 через 3 месяца" },
        { k: "Интересы", v: "технологии, стартапы" },
        { k: "Замечено", v: "путает past simple и present perfect" },
      ]
    : zh
    ? [
        { k: "目标", v: "3 个月考到雅思 7.0" },
        { k: "兴趣", v: "科技、创业" },
        { k: "注意到", v: "常混淆一般过去时与现在完成时" },
      ]
    : [
        { k: "Goal", v: "IELTS 7.0 in 3 months" },
        { k: "Interests", v: "tech, startups" },
        { k: "Noticed", v: "mixes up past simple & present perfect" },
      ];
  return (
    <DemoCard>
      <div className="mb-3 flex items-center gap-2 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        <Brain className="h-4 w-4 text-sage-deep" /> {ru ? "Что наставник знает о тебе" : zh ? "导师对你的了解" : "What your coach knows about you"}
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

function SceneCard({ s }: { s: { img: string; title: string; teaser: string; words: string[] } }) {
  return (
    <div className="group flex h-full flex-col overflow-hidden rounded-[20px] border border-black/[0.07] bg-surface transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_18px_44px_rgba(46,42,38,0.1)]">
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-paper">
        <Image src={s.img} alt={s.title} fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
        <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
          <Clapperboard className="h-3 w-3" /> Scene
        </span>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <h3 className="font-serif text-[19px] font-semibold text-ink">{s.title}</h3>
        <p className="mt-1.5 flex-1 text-[13px] leading-snug text-ink-soft">{s.teaser}</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {s.words.map((w) => (
            <span key={w} className="rounded-full border border-sage/30 bg-sage-tint/50 px-2.5 py-0.5 text-[12px] font-medium text-sage-deep">
              {w}
            </span>
          ))}
        </div>
      </div>
    </div>
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

// Accordion FAQ item — expands smoothly, the + rotates into an ×.
function FaqItem({ q, a, link }: { q: string; a: string; link?: { text: string; href: string } }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-black/[0.07]">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between gap-4 py-5 text-left">
        <span className="font-serif text-[18px] font-semibold text-ink sm:text-[20px]">{q}</span>
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-ink-muted transition-transform duration-300 ${open ? "rotate-45 border-sage/50 text-sage-deep" : "border-black/[0.1]"}`}>
          <Plus className="h-4 w-4" />
        </span>
      </button>
      <div className={`grid transition-all duration-300 ease-out ${open ? "grid-rows-[1fr] pb-5 opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="overflow-hidden">
          <p className="max-w-[680px] text-[15px] leading-relaxed text-ink-soft">
            {a}
            {link && (
              <>
                {" "}
                <a href={link.href} className="font-semibold text-sage-deep hover:underline">{link.text}</a>.
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

export function LandingScreen({ onStart }: { onStart: () => void }) {
  const { locale } = useI18n();
  const L = locale === "ru" ? copy.ru : locale === "zh" ? copy.zh : copy.en;

  return (
    <main className="min-h-screen bg-paper text-ink">
      {/* top bar */}
      <header className="sticky top-0 z-30 border-b border-black/[0.05] bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between px-5 py-3.5 sm:px-8">
          <span className="bg-gradient-to-r from-sage-deep via-sage to-taupe bg-clip-text font-serif text-[22px] font-semibold tracking-[-0.01em] text-transparent">Onomika</span>
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

      {/* three pillars — cards + coach + memory, at a glance */}
      <section className="mx-auto max-w-[1080px] px-5 sm:px-8">
        <Reveal>
          <div className="grid gap-4 rounded-[22px] border border-black/[0.06] bg-surface p-5 sm:grid-cols-3 sm:p-6">
            {L.pillars.map((p, i) => {
              const Icon = [Layers, Compass, Brain][i] ?? Layers;
              return (
                <div key={p.t} className="flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-sage-tint text-sage-deep">
                    <Icon className="h-[22px] w-[22px]" />
                  </span>
                  <div>
                    <div className="font-serif text-[16px] font-semibold text-ink">{p.t}</div>
                    <div className="text-[12.5px] leading-snug text-ink-soft">{p.s}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </Reveal>
      </section>

      {/* feature rows — each with its own animated demo */}
      <section className="mx-auto flex max-w-[1080px] flex-col gap-16 px-5 py-10 sm:px-8 sm:gap-24 sm:py-16">
        <FeatureRow title={L.rowReaderTitle} text={L.rowReaderText} demo={<ReaderScene locale={locale} />} />
        <FeatureRow title={L.rowCardsTitle} text={L.rowCardsText} demo={<FlashcardScene locale={locale} />} flip />
        <FeatureRow title={L.rowDeckTitle} text={L.rowDeckText} demo={<DeckScene locale={locale} />} />
        <FeatureRow title={L.rowMemoryTitle} text={L.rowMemoryText} demo={<MemoryScene locale={locale} />} flip />
      </section>

      {/* scenes — the product's best demo: pick a situation, talk inside it */}
      <section className="mx-auto max-w-[1080px] px-5 py-10 sm:px-8 sm:py-16">
        <Reveal>
          <div className="flex items-center justify-center gap-2">
            <Clapperboard className="h-6 w-6 text-sage-deep" />
            <h2 className="text-center font-serif text-[27px] font-medium tracking-[-0.01em] sm:text-[34px]">{L.scenTitle}</h2>
          </div>
          <p className="mx-auto mt-2 max-w-[520px] text-center text-[15px] text-ink-soft">{L.scenSub}</p>
        </Reveal>

        {/* how a scene plays out — three steps */}
        <div className="mt-9 grid gap-3.5 sm:grid-cols-3">
          {L.scenSteps.map((s, i) => (
            <Reveal key={s.t} delay={i * 110}>
              <div className="flex h-full items-start gap-3 rounded-[18px] border border-black/[0.06] bg-surface p-4">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sage-tint font-serif text-[15px] font-bold text-sage-deep">
                  {i + 1}
                </span>
                <div>
                  <div className="font-serif text-[16px] font-semibold text-ink">{s.t}</div>
                  <div className="mt-0.5 text-[13px] leading-snug text-ink-soft">{s.s}</div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        {/* real scene presets — same images the app uses */}
        <div className="mt-4 grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {L.scenes.map((s, i) => (
            <Reveal key={s.title} delay={(i % 3) * 80}>
              <SceneCard s={s} />
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

      {/* FAQ */}
      <section className="mx-auto max-w-[820px] px-5 py-10 sm:px-8 sm:py-16">
        <Reveal>
          <h2 className="text-center font-serif text-[27px] font-medium tracking-[-0.01em] sm:text-[34px]">{L.faqTitle}</h2>
        </Reveal>
        <div className="mt-8">
          {L.faq.map((item) => (
            <Reveal key={item.q}>
              <FaqItem q={item.q} a={item.a} link={"link" in item ? item.link : undefined} />
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
          <span>© {new Date().getFullYear()} Onomika · {L.rights}</span>
          <div className="flex gap-4">
            <a href="/terms" className="font-semibold hover:text-ink">{L.terms}</a>
            <a href="/privacy" className="font-semibold hover:text-ink">{L.privacy}</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
