"use client";

import Link from "next/link";
import { ArrowRight, Clapperboard, Dumbbell, MessageCircle, type LucideIcon } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// Practice lives with Mika (the author, 2026-10-14, "option 1"): one AI, one place. The
// chat in Chinese, the scenes and the word drill were a "Практика" section under More,
// three taps deep, each speaking as Mika too — five chat screens and no telling which
// was which. Now Mika's sheet and her page offer them beside "ask", and their pages
// lead back to Mika. Titles are the pages' own, so an entry and its page always match.
const PRACTICE: { href: string; Icon: LucideIcon; title: string; desc: string }[] = [
  { href: "/coach/chat", Icon: MessageCircle, title: "chat.title", desc: "mika.pr.chat" },
  { href: "/coach/scene", Icon: Clapperboard, title: "scene.heroTitle", desc: "mika.pr.scene" },
  { href: "/coach/practice", Icon: Dumbbell, title: "coach.practiceTitle", desc: "mika.pr.drill" },
];

// The page: three rows with a line each.
export function MikaPracticeCards() {
  const { t } = useI18n();
  return (
    <section className="space-y-3">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-faint">{t("mika.practiceGroup")}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {PRACTICE.map(({ href, Icon, title, desc }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-start gap-3 rounded-[18px] border border-sage/25 bg-surface p-4 transition-colors hover:border-sage/60 sm:flex-col"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sage text-white">
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] font-semibold text-ink group-hover:text-sage-deep">{t(title)}</span>
              <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-soft">{t(desc)}</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

// The sheet: one row of links under the "ask" chips — they leave the chat, so they
// read as links (an arrow), not as chips that fill the input.
// `page`: on Mika's page at phone width, where the label matches "Спросить" below it.
export function MikaPracticeLinks({ onGo, page }: { onGo?: () => void; page?: boolean }) {
  const { t } = useI18n();
  return (
    <div className={page ? "space-y-3" : "space-y-1.5"}>
      <p className={cn("font-semibold uppercase tracking-wide text-ink-faint", page ? "text-[13px]" : "text-[11px]")}>
        {t("mika.practiceGroup")}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {PRACTICE.map(({ href, Icon, title }) => (
          <Link
            key={href}
            href={href}
            onClick={onGo}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink transition-colors hover:border-sage/50 hover:text-sage-deep"
          >
            <Icon className="h-3.5 w-3.5 text-sage-deep" />
            {t(title)}
            <ArrowRight className="h-3 w-3 text-ink-faint" />
          </Link>
        ))}
      </div>
    </div>
  );
}
