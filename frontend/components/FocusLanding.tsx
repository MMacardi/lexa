"use client";

import Image from "next/image";
import { useI18n } from "@/lib/i18n";
import { LangMenu, ThemeToggle, Reveal } from "@/components/LandingChrome";
import { ArrowDown, ArrowRight, BookOpen, CalendarDays, Check, GraduationCap, Layers, MessageSquare, PenLine, Send } from "lucide-react";
import { TESTERS_CHAT_URL } from "@/lib/links";

// Real local demo-account screens, regenerated with scripts/landing-shots.mjs.
// The primary copy is Russian; each locale gets its own screenshots too.
const FEATURES = [
  { shot: "plan", Icon: GraduationCap },
  { shot: "today", Icon: CalendarDays },
  { shot: "reader", Icon: BookOpen },
  { shot: "review", Icon: Layers },
  { shot: "write", Icon: PenLine },
  { shot: "mika", Icon: MessageSquare },
] as const;

function AppScreen({ shot, priority = false }: { shot: string; priority?: boolean }) {
  const { locale, t } = useI18n();
  return (
    <figure className="mx-auto w-full max-w-[300px]">
      <div className="overflow-hidden rounded-[28px] border border-black/10 bg-[#f4f1ec] shadow-[0_20px_60px_rgba(46,42,38,0.14)]">
        <Image
          src={`/landing/${shot}-${locale}.webp`}
          alt={t(`landing.${shot}.alt`)}
          width={600}
          height={1022}
          sizes="(max-width: 360px) 260px, 300px"
          priority={priority}
          className="h-auto w-full"
        />
      </div>
      <figcaption className="mt-3 text-center text-[13px] text-ink-faint">{t("landing.screenCaption")}</figcaption>
    </figure>
  );
}

export function FocusLanding({ onStart, onSignIn }: { onStart: () => void; onSignIn: () => void }) {
  const { t } = useI18n();
  return (
    <main className="min-h-screen bg-paper text-ink">
      <header className="sticky top-0 z-30 border-b border-black/[0.05] bg-paper/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-2 px-4 py-3 sm:px-8">
          <span className="font-serif text-[22px] font-semibold tracking-[-0.01em] text-sage-deep">Onomika</span>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <LangMenu compact />
            <ThemeToggle />
            <button type="button" onClick={onSignIn} className="rounded-full border border-black/10 bg-surface px-3 py-2 text-sm font-semibold transition-colors hover:border-sage hover:text-sage-deep sm:px-4">
              {t("landing.signIn")}
            </button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute -right-32 top-20 h-[480px] w-[480px] rounded-full bg-sage/15 blur-[100px]" />
        <div className="relative mx-auto grid max-w-[1080px] items-center gap-12 px-5 py-12 sm:px-8 sm:py-20 lg:grid-cols-[1.15fr_1fr]">
          <div className="text-center lg:text-left">
            <p className="text-[13px] font-semibold uppercase tracking-[0.1em] text-sage-deep">{t("landing.eyebrow")}</p>
            <h1 className="mx-auto mt-5 max-w-[580px] text-balance font-serif text-[38px] font-medium leading-[1.1] tracking-[-0.025em] sm:text-[54px] lg:mx-0">
              {t("landing.title")}
            </h1>
            <p className="mx-auto mt-6 max-w-[500px] text-[17px] leading-relaxed text-ink-soft sm:text-[19px] lg:mx-0">{t("landing.sub")}</p>
            <div className="mt-8 flex flex-col items-center gap-3 lg:items-start">
              <button type="button" data-cta onClick={onStart} className="group inline-flex max-w-full items-center justify-center gap-2 rounded-full bg-sage-deep px-7 py-4 text-[17px] font-semibold text-white transition-colors hover:bg-sage">
                {t("landing.cta")} <ArrowRight className="h-5 w-5 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </button>
              <p className="max-w-[400px] text-[14px] leading-relaxed text-ink-soft">{t("landing.ctaHint")}</p>
              <a href="#features" className="mt-2 inline-flex items-center gap-2 py-2 text-[14px] font-semibold text-sage-deep hover:underline">
                {t("landing.seeHow")} <ArrowDown className="h-4 w-4" />
              </a>
            </div>
          </div>
          <AppScreen shot="today" priority />
        </div>
      </section>

      <section id="features" className="mx-auto max-w-[1080px] scroll-mt-24 px-5 py-10 sm:px-8">
        <Reveal>
          <h2 className="text-center font-serif text-[30px] font-medium leading-tight sm:text-[40px]">{t("landing.featuresTitle")}</h2>
          <p className="mx-auto mt-4 max-w-[560px] text-center text-[17px] leading-relaxed text-ink-soft">{t("landing.featuresSub")}</p>
        </Reveal>
        <div className="mt-12 space-y-16 sm:mt-16 sm:space-y-24">
          {FEATURES.map(({ shot, Icon }, i) => (
            <Reveal key={shot}>
              <article className="grid items-center gap-8 rounded-[28px] border border-black/[0.06] bg-surface px-5 py-8 sm:px-10 sm:py-12 md:grid-cols-2 md:gap-12">
                <div className={i % 2 ? "md:order-2" : ""}>
                  <div className="flex items-center gap-3 text-sage-deep">
                    <Icon className="h-6 w-6" aria-hidden="true" />
                    <span className="text-[13px] font-semibold tracking-[0.12em]">{String(i + 1).padStart(2, "0")} / 06</span>
                  </div>
                  <p className="mt-5 text-[14px] font-semibold text-sage-deep">{t(`landing.${shot}.label`)}</p>
                  <h3 className="mt-2 text-balance font-serif text-[28px] font-medium leading-[1.15] tracking-[-0.01em] sm:text-[36px]">{t(`landing.${shot}.title`)}</h3>
                  <p className="mt-5 text-[17px] leading-relaxed text-ink-soft">{t(`landing.${shot}.body`)}</p>
                  <p className="mt-4 text-[14px] leading-relaxed text-ink-faint">{t(`landing.${shot}.note`)}</p>
                </div>
                <div className={i % 2 ? "md:order-1" : ""}><AppScreen shot={shot} /></div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-[1080px] px-5 py-12 sm:px-8 sm:py-16">
        <Reveal>
          <div className="grid gap-8 md:grid-cols-2 md:gap-16">
            <div>
              <Send className="h-7 w-7 text-sage-deep" aria-hidden="true" />
              <h2 className="mt-4 font-serif text-[26px] font-medium">{t("landing.telegramTitle")}</h2>
              <p className="mt-3 text-[16px] leading-relaxed text-ink-soft">{t("landing.telegramBody")}</p>
            </div>
            <div>
              <h2 className="font-serif text-[26px] font-medium">{t("landing.betaTitle")}</h2>
              <ul className="mt-4 space-y-3">
                {["access", "data", "feedback"].map((key) => (
                  <li key={key} className="flex items-start gap-2.5 text-[16px] leading-relaxed text-ink-soft">
                    <Check className="mt-1 h-4 w-4 shrink-0 text-sage-deep" aria-hidden="true" />
                    <span>{t(`landing.beta.${key}`)}</span>
                  </li>
                ))}
              </ul>
              {TESTERS_CHAT_URL && <a href={TESTERS_CHAT_URL} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex items-center gap-2 py-2 font-semibold text-sage-deep hover:underline"><Send className="h-4 w-4" />{t("landing.chat")}</a>}
            </div>
          </div>
        </Reveal>
      </section>

      <section className="mx-auto max-w-[1080px] px-5 pb-12 sm:px-8 sm:pb-20">
        <Reveal>
          <div className="rounded-[28px] border border-sage/25 bg-sage-tint/50 px-5 py-12 text-center sm:p-16">
            <h2 className="font-serif text-[30px] font-medium leading-tight sm:text-[40px]">{t("landing.finalTitle")}</h2>
            <p className="mx-auto mt-4 max-w-[500px] text-[17px] leading-relaxed text-ink-soft">{t("landing.finalSub")}</p>
            <button type="button" onClick={onStart} className="mt-7 inline-flex max-w-full items-center justify-center gap-2 rounded-full bg-sage-deep px-7 py-4 text-[17px] font-semibold text-white transition-colors hover:bg-sage">
              {t("landing.cta")} <ArrowRight className="h-5 w-5 shrink-0" />
            </button>
          </div>
        </Reveal>
      </section>

      <footer className="mx-auto max-w-[1080px] px-5 py-8 sm:px-8">
        <div className="flex flex-col items-center justify-between gap-3 border-t border-black/[0.07] pt-6 text-[13px] text-ink-faint sm:flex-row">
          <span>© {new Date().getFullYear()} Onomika</span>
          <div className="flex flex-wrap justify-center gap-x-5 gap-y-2">
            <a href="/terms" className="py-2 font-semibold hover:text-ink">{t("landing.terms")}</a>
            <a href="/privacy" className="py-2 font-semibold hover:text-ink">{t("landing.privacy")}</a>
            {TESTERS_CHAT_URL && <a href={TESTERS_CHAT_URL} target="_blank" rel="noopener noreferrer" className="py-2 font-semibold hover:text-ink">{t("landing.chat")}</a>}
          </div>
        </div>
      </footer>
    </main>
  );
}
