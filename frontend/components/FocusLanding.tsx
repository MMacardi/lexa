"use client";

import { useI18n } from "@/lib/i18n";
import { LangMenu, ThemeToggle, Reveal } from "@/components/LandingChrome";
import { Camera, Layers, MessageSquareQuote, Eye, GraduationCap, ArrowRight, Send, Check } from "lucide-react";

// The landing a stranger reads (BACKLOG F10). One page, one promise: the HSK
// readiness mark, then the loop that moves it — photo the lesson list, review,
// use one of the words. The picture is the mark itself, drawn from fixed sample
// numbers (no requests, no tokens). Localized ru / en / zh, Russian first.
//
// The rule from F4 holds here: this is *vocabulary* coverage and the copy says
// so. Nothing on this page may read as a predicted exam score.

const copy = {
  ru: {
    beta: "Закрытая бета",
    eyebrow: "HSK для русскоязычных",
    heroTitle: "Слова HSK, которые ты действительно можешь использовать.",
    heroSub:
      "Сначала честная отметка: сколько слов из официального списка ты узнаёшь и сколько реально умеешь употребить. Потом — этот список и слова из учебника на эту неделю, превращённые в то, что ты можешь сказать сам.",
    ctaMain: "Войти по коду",
    ctaHint: "Это закрытая бета — нужен код приглашения. Вход через Telegram, Google или email.",
    mark: {
      title: "Готовность к HSK",
      sub: "Охват официального списка слов — это не прогноз балла на экзамене.",
      ofTotal: "742 из 1200 слов уровня HSK 4",
      canUseLine: "из них 318 умеете использовать",
      legendCanUse: "умеете использовать",
      legendRecognise: "узнаёте",
      legendGap: "не начато",
      byLevel: "По уровням",
    },
    gapTitle: "Между «узнаю» и «умею сказать» — пропасть",
    gapSub:
      "Списки слов учат первому. Экзамен и живой разговор требуют второго. Поэтому отметка — это два числа, а приложение занято тем, чтобы поднять второе.",
    gapCards: [
      { t: "Узнаёшь", s: "слово всплывает, когда ты его видишь" },
      { t: "Умеешь использовать", s: "ты сам поставил его в предложение — и оно было верным" },
    ],
    notScore:
      "Балл за экзамен мы не предсказываем: откалибровать такое предсказание нам не на чем. Отметка показывает только охват словаря — и меняется от твоих повторений, а не от нашего оптимизма.",
    loopTitle: "Один цикл, три шага",
    loopSub: "Каждый день одно и то же — и это сознательно.",
    loop: [
      {
        n: "01",
        t: "Сфотографируй список с урока",
        s: "Фото тетради или страницы учебника — слова становятся карточками в паре китайский → русский, со значением из твоего текста. Или возьми недостающие слова прямо из официального списка.",
      },
      {
        n: "02",
        t: "Повтори их",
        s: "Интервальные повторения (FSRS): каждое слово возвращается тогда, когда ты вот-вот его забудешь. Несколько минут в день, не час.",
      },
      {
        n: "03",
        t: "Употреби одно из них",
        s: "Наставник просит сказать слово в предложении и проверяет ответ. Получилось — слово переходит из «узнаю» в «умею использовать», и отметка сдвигается.",
      },
    ],
    demoPrompt: "Скажи 提供 в предложении.",
    demoAnswer: "公司提供免费的午饭。",
    demoGrade: "Верно — естественное употребление.",
    tgTitle: "И то же самое в Telegram",
    tgText: "Бот @onomikabot — тот же аккаунт и тот же дневной цикл в чате: слова, повторение, шаг употребления.",
    honestTitle: "Честно про стадию",
    honest: [
      "Это закрытая бета: 30–50 человек, вход по коду.",
      "Пока один экзамен — HSK, и одна пара: китайский с объяснениями на русском (английский тоже работает).",
      "Бесплатно на время беты. Свои слова и прогресс можно выгрузить в любой момент.",
      "Что-то будет ломаться. Кнопка «сообщить о проблеме» есть внутри, и отвечает на неё автор.",
    ],
    finalTitle: "Посмотри, где ты сейчас",
    finalSub: "Проверка занимает около пяти минут.",
    rights: "Все права защищены.",
    terms: "Условия",
    privacy: "Конфиденциальность",
  },
  en: {
    beta: "Closed beta",
    eyebrow: "HSK, for Russian speakers",
    heroTitle: "HSK words you can actually use.",
    heroSub:
      "First an honest mark: how much of the official list you recognise, and how much of it you can really put in a sentence. Then that list — and this week's textbook words — turned into something you can say yourself.",
    ctaMain: "Enter your code",
    ctaHint: "This is a closed beta — you need an invite code. Sign in with Telegram, Google or email.",
    mark: {
      title: "HSK readiness",
      sub: "Vocabulary coverage of the official list — not a predicted exam score.",
      ofTotal: "742 of 1200 words at HSK 4",
      canUseLine: "318 of those you can use",
      legendCanUse: "can use",
      legendRecognise: "recognise",
      legendGap: "not started",
      byLevel: "By level",
    },
    gapTitle: "“I recognise it” and “I can say it” are far apart",
    gapSub:
      "Word lists teach the first. The exam and a real conversation want the second. So the mark is two numbers, and the app's whole job is raising the second one.",
    gapCards: [
      { t: "Recognise", s: "the word lands when you see it" },
      { t: "Can use", s: "you put it in a sentence yourself — and it was right" },
    ],
    notScore:
      "We don't predict your exam score: we have nothing to calibrate such a prediction against. The mark shows vocabulary coverage only — and it moves on your reviews, not on our optimism.",
    loopTitle: "One loop, three steps",
    loopSub: "The same thing every day, on purpose.",
    loop: [
      {
        n: "01",
        t: "Photograph the list from your lesson",
        s: "A photo of your notebook or a textbook page — the words become cards in Chinese → Russian, with the sense you met them in. Or take the missing words straight from the official list.",
      },
      {
        n: "02",
        t: "Review them",
        s: "Spaced repetition (FSRS): each word comes back just as you're about to forget it. A few minutes a day, not an hour.",
      },
      {
        n: "03",
        t: "Use one of them",
        s: "The coach asks you to say the word in a sentence and checks the answer. Get it right and the word moves from “recognise” to “can use” — and the mark moves with it.",
      },
    ],
    demoPrompt: "Say 提供 in a sentence.",
    demoAnswer: "公司提供免费的午饭。",
    demoGrade: "Correct — natural usage.",
    tgTitle: "And the same thing in Telegram",
    tgText: "The @onomikabot bot is the same account and the same daily loop in a chat: words, review, use-step.",
    honestTitle: "Honestly, where this is",
    honest: [
      "It's a closed beta: 30–50 people, entry by code.",
      "One exam for now — HSK — and one pair: Chinese explained in Russian (English works too).",
      "Free during the beta. Your words and progress export any time.",
      "Things will break. The report-a-problem button is inside the app, and the author answers it.",
    ],
    finalTitle: "See where you actually are",
    finalSub: "The check takes about five minutes.",
    rights: "All rights reserved.",
    terms: "Terms",
    privacy: "Privacy",
  },
  zh: {
    beta: "内测中",
    eyebrow: "面向俄语母语者的 HSK",
    heroTitle: "真正用得出来的 HSK 词。",
    heroSub:
      "先给你一个诚实的结果：官方词表里你认识多少，又有多少真能放进句子里。然后把这份词表和本周课本上的生词，变成你自己说得出来的话。",
    ctaMain: "输入邀请码",
    ctaHint: "这是封闭内测——需要邀请码。可用 Telegram、Google 或邮箱登录。",
    mark: {
      title: "HSK 准备度",
      sub: "这是对官方词表的覆盖率，不是考试分数预测。",
      ofTotal: "HSK 4 的 1200 个词中已掌握 742 个",
      canUseLine: "其中 318 个你会用",
      legendCanUse: "会用",
      legendRecognise: "认识",
      legendGap: "尚未开始",
      byLevel: "按等级",
    },
    gapTitle: "「认识」和「说得出」之间隔着一道坎",
    gapSub: "词表教会你前者，考试和真实对话要的是后者。所以这个结果是两个数字，而这个应用要做的就是把第二个数字抬上去。",
    gapCards: [
      { t: "认识", s: "看到它时你能想起意思" },
      { t: "会用", s: "你自己把它放进了句子——而且是对的" },
    ],
    notScore:
      "我们不预测你的考试分数：这样的预测我们无从校准。这个结果只显示词汇覆盖率——它随你的复习而变，而不是随我们的乐观而变。",
    loopTitle: "一个循环，三个步骤",
    loopSub: "每天都是同一件事——这是刻意的。",
    loop: [
      {
        n: "01",
        t: "拍下课上的生词表",
        s: "拍一张笔记本或课本的照片——这些词会变成中文 → 俄语的卡片，并采用你遇到的那个义项。也可以直接从官方词表里取你还缺的词。",
      },
      {
        n: "02",
        t: "复习它们",
        s: "间隔重复（FSRS）：每个词都会在你快要忘记时回来。每天几分钟，不是一小时。",
      },
      {
        n: "03",
        t: "用其中一个造句",
        s: "导师让你用这个词说一句话，并检查你的回答。答对了，这个词就从「认识」进到「会用」——结果也随之变化。",
      },
    ],
    demoPrompt: "用 提供 造一个句子。",
    demoAnswer: "公司提供免费的午饭。",
    demoGrade: "正确——用得很自然。",
    tgTitle: "在 Telegram 里也一样",
    tgText: "@onomikabot 机器人用的是同一个账号、同一个每日循环：选词、复习、运用。",
    honestTitle: "坦白说说现在的阶段",
    honest: [
      "这是封闭内测：30–50 人，凭码进入。",
      "目前只有一门考试——HSK，一个语言对：中文，用俄语讲解（英语也可以）。",
      "内测期间免费。你的单词和进度随时可以导出。",
      "东西会出问题。应用里有「反馈问题」按钮，回复你的就是作者本人。",
    ],
    finalTitle: "看看你现在到哪儿了",
    finalSub: "这个自测大约五分钟。",
    rights: "版权所有。",
    terms: "条款",
    privacy: "隐私",
  },
};

// The sample mark. HSK 2.0 cumulative totals to level 4 (150 + 150 + 300 + 600),
// so the level rows add up to the headline numbers rather than merely looking
// like they might.
const SAMPLE = { total: 1200, recognise: 742, canUse: 318, learning: 96 };
const SAMPLE_LEVELS = [
  { level: 1, total: 150, recognise: 148, canUse: 120 },
  { level: 2, total: 150, recognise: 145, canUse: 96 },
  { level: 3, total: 300, recognise: 246, canUse: 78 },
  { level: 4, total: 600, recognise: 203, canUse: 24 },
];

type Copy = (typeof copy)["ru"];

// A still of the real readiness card (components/HskReadiness.tsx) — same two
// numbers, same track, same disclaimer under the title.
function ReadinessMark({ L }: { L: Copy }) {
  const pct = (n: number) => (n / SAMPLE.total) * 100;
  return (
    <div className="mx-auto w-full max-w-[420px] rounded-[24px] border border-black/[0.06] bg-surface p-6 shadow-[0_30px_70px_rgba(46,42,38,0.14)]">
      <div className="flex items-center gap-2">
        <h3 className="font-serif text-[22px] font-medium text-ink">{L.mark.title}</h3>
        <GraduationCap className="h-5 w-5 text-ink-faint" />
      </div>
      <p className="mt-1 text-[13px] text-ink-faint">{L.mark.sub}</p>

      <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-serif text-[34px] font-bold leading-none text-ink">{SAMPLE.recognise}</span>
        <span className="text-[15px] text-ink-soft">{L.mark.ofTotal}</span>
      </div>
      <p className="mt-1 text-[15px] font-medium text-sage-deep">{L.mark.canUseLine}</p>

      <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-track">
        <div className="bg-sage-deep" style={{ width: `${pct(SAMPLE.canUse)}%` }} />
        <div className="bg-sage" style={{ width: `${pct(SAMPLE.recognise - SAMPLE.canUse)}%` }} />
        <div className="bg-sage-tint" style={{ width: `${pct(SAMPLE.learning)}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-faint">
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-sage-deep" /> {L.mark.legendCanUse} {SAMPLE.canUse}
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-sage" /> {L.mark.legendRecognise} {SAMPLE.recognise}
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-sage-tint" /> {L.mark.legendGap} {SAMPLE.total - SAMPLE.recognise - SAMPLE.learning}
        </span>
      </div>

      <div className="mt-6">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">{L.mark.byLevel}</p>
        <div className="space-y-1.5">
          {SAMPLE_LEVELS.map((l) => (
            <div key={l.level} className="flex items-center gap-3 rounded-[12px] bg-paper px-2 py-1.5">
              <span className="w-[52px] shrink-0 text-[12px] font-semibold text-ink-soft">HSK {l.level}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-track">
                <span className="block h-full bg-sage" style={{ width: `${(l.recognise / l.total) * 100}%` }} />
              </span>
              <span className="shrink-0 text-[11px] text-ink-faint">
                {l.recognise}/{l.total} · {l.canUse}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// The use-step, in one exchange — the third loop card's picture.
function UseStepStill({ L }: { L: Copy }) {
  return (
    <div className="mt-4 space-y-2 rounded-[16px] border border-black/[0.06] bg-paper p-3">
      <div className="rounded-[12px] rounded-bl-sm border border-black/[0.06] bg-surface px-3 py-2 text-[13px] leading-snug text-ink">
        {L.demoPrompt}
      </div>
      <div className="flex justify-end">
        <span className="max-w-[85%] rounded-[12px] rounded-br-sm bg-sage px-3 py-2 text-[13px] leading-snug text-white">
          {L.demoAnswer}
        </span>
      </div>
      <div className="flex items-center gap-1.5 text-[12px] font-semibold text-sage-deep">
        <Check className="h-3.5 w-3.5" strokeWidth={3} /> {L.demoGrade}
      </div>
    </div>
  );
}

// Cards appearing from a photographed list — the first loop card's picture.
function CaptureStill() {
  return (
    <div className="mt-4 space-y-1.5 rounded-[16px] border border-black/[0.06] bg-paper p-3">
      {[
        ["提供", "предоставлять"],
        ["积极", "активный"],
        ["安排", "устраивать"],
      ].map(([w, m]) => (
        <div key={w} className="flex items-center justify-between rounded-[10px] bg-surface px-3 py-1.5">
          <span className="text-[15px] font-semibold text-ink">{w}</span>
          <span className="text-[12.5px] text-sage-deep">{m}</span>
        </div>
      ))}
    </div>
  );
}

// A card at its grading moment — the second loop card's picture. The grade
// labels are the app's own, so they never drift apart from the review screen.
function ReviewStill() {
  const { t } = useI18n();
  return (
    <div className="mt-4 rounded-[16px] border border-black/[0.06] bg-paper p-3 text-center">
      <div className="font-serif text-[26px] font-semibold text-ink">提供</div>
      <div className="mt-0.5 text-[12px] text-ink-faint">tígōng</div>
      <div className="mt-3 flex gap-1.5">
        {(["review.again", "review.hard", "review.good", "review.easy"] as const).map((k, i) => (
          <span
            key={k}
            className={`flex-1 rounded-[9px] py-1.5 text-[11px] font-semibold ${
              i === 2 ? "bg-sage text-white" : "bg-surface text-ink-faint"
            }`}
          >
            {t(k)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function FocusLanding({ onStart }: { onStart: () => void }) {
  const { locale } = useI18n();
  const L = locale === "en" ? copy.en : locale === "zh" ? copy.zh : copy.ru;
  const stills = [<CaptureStill key="c" />, <ReviewStill key="r" />, <UseStepStill key="u" L={L} />];

  return (
    <main className="min-h-screen bg-paper text-ink">
      {/* top bar */}
      <header className="sticky top-0 z-30 border-b border-black/[0.05] bg-paper/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between px-5 py-3.5 sm:px-8">
          <span className="bg-gradient-to-r from-sage-deep via-sage to-taupe bg-clip-text font-serif text-[22px] font-semibold tracking-[-0.01em] text-transparent">
            Onomika
          </span>
          <div className="flex items-center gap-2">
            <LangMenu />
            <ThemeToggle />
            <button type="button" onClick={onStart} className="rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sage-deep">
              {L.ctaMain}
            </button>
          </div>
        </div>
      </header>

      {/* hero — the promise on the left, the mark itself on the right */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0">
          <div className="aurora-blob absolute -top-32 left-[15%] h-[420px] w-[420px] rounded-full bg-sage/25 blur-[120px]" />
          <div className="aurora-blob slow absolute -top-10 right-[12%] h-[380px] w-[380px] rounded-full bg-taupe/25 blur-[120px]" />
        </div>
        <div className="relative mx-auto grid max-w-[1080px] items-center gap-10 px-5 pb-16 pt-14 sm:px-8 sm:pb-24 sm:pt-20 lg:grid-cols-2">
          <div className="text-center lg:text-left">
            <div className="anim-fade-up flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sage/25 bg-sage-tint/60 px-3.5 py-1.5 text-[13px] font-semibold text-sage-deep backdrop-blur">
                <GraduationCap className="h-3.5 w-3.5" /> {L.eyebrow}
              </span>
              <span className="inline-flex items-center rounded-full border border-black/[0.1] px-3 py-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-faint">
                {L.beta}
              </span>
            </div>
            <h1 className="anim-fade-up mx-auto mt-6 max-w-[560px] font-serif text-[36px] font-medium leading-[1.06] tracking-[-0.02em] sm:text-[50px] lg:mx-0 lg:max-w-none" style={{ animationDelay: "60ms" }}>
              {L.heroTitle}
            </h1>
            <p className="anim-fade-up mx-auto mt-6 max-w-[500px] text-[16px] leading-relaxed text-ink-soft sm:text-[18px] lg:mx-0" style={{ animationDelay: "120ms" }}>
              {L.heroSub}
            </p>
            <div className="anim-fade-up mt-9 flex flex-col items-center gap-3 lg:items-start" style={{ animationDelay: "180ms" }}>
              <button type="button" onClick={onStart} className="group inline-flex items-center gap-2 rounded-full bg-sage px-8 py-4 text-[17px] font-semibold text-white shadow-[0_16px_40px_rgba(124,152,133,0.4)] transition-all hover:bg-sage-deep hover:shadow-[0_20px_50px_rgba(124,152,133,0.5)] active:scale-[0.98]">
                {L.ctaMain} <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-0.5" />
              </button>
              <span className="max-w-[420px] text-[13px] leading-snug text-ink-faint">{L.ctaHint}</span>
            </div>
          </div>
          <div className="anim-fade-up" style={{ animationDelay: "240ms" }}>
            <ReadinessMark L={L} />
          </div>
        </div>
      </section>

      {/* the gap the two numbers measure */}
      <section className="mx-auto max-w-[1080px] px-5 py-10 sm:px-8 sm:py-14">
        <Reveal>
          <h2 className="text-center font-serif text-[27px] font-medium tracking-[-0.01em] sm:text-[34px]">{L.gapTitle}</h2>
          <p className="mx-auto mt-3 max-w-[620px] text-center text-[15px] leading-relaxed text-ink-soft">{L.gapSub}</p>
        </Reveal>
        <div className="mt-8 grid gap-3.5 sm:grid-cols-2">
          {L.gapCards.map((c, i) => {
            const Icon = [Eye, MessageSquareQuote][i] ?? Eye;
            return (
              <Reveal key={c.t} delay={i * 110}>
                <div className="flex h-full items-start gap-3 rounded-[20px] border border-black/[0.06] bg-surface p-5">
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] ${i === 1 ? "bg-sage text-white" : "bg-sage-tint text-sage-deep"}`}>
                    <Icon className="h-[22px] w-[22px]" />
                  </span>
                  <div>
                    <div className="font-serif text-[17px] font-semibold text-ink">{c.t}</div>
                    <div className="mt-0.5 text-[13.5px] leading-snug text-ink-soft">{c.s}</div>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
        <Reveal>
          <p className="mx-auto mt-6 max-w-[620px] text-center text-[13px] leading-relaxed text-ink-faint">{L.notScore}</p>
        </Reveal>
      </section>

      {/* the loop, three steps, each with its own still */}
      <section className="mx-auto max-w-[1080px] px-5 py-10 sm:px-8 sm:py-14">
        <Reveal>
          <h2 className="text-center font-serif text-[27px] font-medium tracking-[-0.01em] sm:text-[34px]">{L.loopTitle}</h2>
          <p className="mx-auto mt-2 max-w-[520px] text-center text-[15px] text-ink-soft">{L.loopSub}</p>
        </Reveal>
        <div className="mt-9 grid gap-3.5 lg:grid-cols-3">
          {L.loop.map((s, i) => {
            const Icon = [Camera, Layers, MessageSquareQuote][i] ?? Camera;
            return (
              <Reveal key={s.n} delay={i * 110}>
                <div className="flex h-full flex-col rounded-[22px] border border-black/[0.07] bg-surface p-6">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-sage-tint text-sage-deep">
                      <Icon className="h-[19px] w-[19px]" />
                    </span>
                    <span className="font-serif text-[22px] font-bold text-sage-deep">{s.n}</span>
                  </div>
                  <h3 className="mt-3 font-serif text-[18px] font-semibold">{s.t}</h3>
                  <p className="mt-1.5 flex-1 text-[14px] leading-relaxed text-ink-soft">{s.s}</p>
                  {stills[i]}
                </div>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* the same loop in the bot */}
      <section className="mx-auto max-w-[1080px] px-5 py-6 sm:px-8 sm:py-10">
        <Reveal>
          <div className="flex flex-col items-start gap-3 rounded-[22px] border border-black/[0.06] bg-surface p-6 sm:flex-row sm:items-center sm:gap-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-sage-tint text-sage-deep">
              <Send className="h-[21px] w-[21px]" />
            </span>
            <div>
              <div className="font-serif text-[18px] font-semibold text-ink">{L.tgTitle}</div>
              <p className="mt-0.5 text-[14px] leading-relaxed text-ink-soft">{L.tgText}</p>
            </div>
          </div>
        </Reveal>
      </section>

      {/* the honest line about the stage this is at */}
      <section className="mx-auto max-w-[820px] px-5 py-10 sm:px-8 sm:py-14">
        <Reveal>
          <div className="rounded-[24px] border border-black/[0.07] bg-surface p-7 sm:p-9">
            <h2 className="font-serif text-[24px] font-medium tracking-[-0.01em] sm:text-[28px]">{L.honestTitle}</h2>
            <ul className="mt-5 space-y-3">
              {L.honest.map((line) => (
                <li key={line} className="flex items-start gap-2.5 text-[15px] leading-relaxed text-ink-soft">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-sage-deep" strokeWidth={2.5} />
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </section>

      {/* final CTA */}
      <section className="mx-auto max-w-[1080px] px-5 py-10 sm:px-8 sm:py-16">
        <Reveal>
          <div className="relative overflow-hidden rounded-[28px] border border-sage/25 bg-gradient-to-br from-sage-tint/70 via-surface to-surface p-8 text-center sm:p-16">
            <div className="pointer-events-none absolute inset-0">
              <div className="aurora-blob absolute -bottom-24 left-1/3 h-[300px] w-[300px] rounded-full bg-sage/20 blur-[110px]" />
            </div>
            <div className="relative">
              <h2 className="font-serif text-[30px] font-medium tracking-[-0.01em] sm:text-[40px]">{L.finalTitle}</h2>
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
