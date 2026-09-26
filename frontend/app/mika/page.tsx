"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, isDue } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { getLevel } from "@/lib/learnPrefs";
import { useTutorChat } from "@/lib/useTutorChat";
import { ChatPairPicker } from "@/components/ChatPairPicker";
import { ChatHistoryMenu } from "@/components/ChatHistoryMenu";
import { TutorThread } from "@/components/TutorThread";
import { TutorComposer, useImageDrop, DropHint } from "@/components/TutorComposer";
import { cn } from "@/lib/utils";
import { GraduationCap, Tags, Scale, Layers, BookOpen, MessagesSquare, CalendarCheck, RotateCcw, Sparkles, Camera, type LucideIcon } from "lucide-react";

// Welcome-screen presets. Each fills the input (editable, not sent) and doubles as
// a tour: the blurb says which part of the app it relates to, `href` links there.
// `open` = the prompt ends where the learner types (a topic, two words): Send waits for it.
// "photo" has no prompt: it opens the photo picker (a textbook page, a sign, a menu).
const PRESETS: { key: string; Icon: LucideIcon; href?: string; nav?: string; open?: boolean }[] = [
  { key: "photo", Icon: Camera },
  { key: "level", Icon: GraduationCap },
  { key: "topic", Icon: Tags, open: true, href: "/collections", nav: "nav.collections" },
  { key: "compare", Icon: Scale, open: true },
  { key: "reviews", Icon: Layers, href: "/review", nav: "nav.flashcards" },
  { key: "reader", Icon: BookOpen, href: "/reader", nav: "nav.reader" },
  { key: "scene", Icon: MessagesSquare, href: "/coach/scene", nav: "scene.heroTitle" },
  { key: "today", Icon: CalendarCheck, href: "/", nav: "nav.today" },
];

export default function MikaPage() {
  const { t } = useI18n();
  const { accountId } = useAccount();
  const chat = useTutorChat();
  const { pair, changePair, messages, setInput, reset, busy, unfinished } = chat;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const drop = useImageDrop(chat);

  // Due count, so "what should I study today?" gives Mika real context.
  const { data: words } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
    enabled: !!accountId,
  });
  const due = (words ?? []).filter(isDue).length;

  // The conversation scrolls inside its own panel, so the composer stays put.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && (messages.length || busy)) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  function applyPreset(key: string, open?: boolean) {
    if (key === "photo") return fileRef.current?.click();
    const text = t(`mika.p.${key}.prompt`, { level: getLevel(pair.source) ?? "B1", due });
    if (open) chat.fillTemplate(text);
    else setInput(text);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
  }

  return (
    <div {...drop.props} className="relative mx-auto flex h-[calc(100dvh-176px)] max-w-[760px] flex-col md:h-[calc(100dvh-140px)]">
      {drop.dragging && <DropHint />}
      {/* Title on the left, the session actions against the right edge, the pair on
          its own line below. All three pills used to sit in one left-hugging huddle
          under the subtitle, which left the header lopsided — and History's menu
          (right-aligned, as menus are) dropped straight over the pair chip next to
          it. The actions go icon-only on a phone so both edges stay anchored
          without the row wrapping back on itself. */}
      <div className="mb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 font-serif text-[28px] font-medium text-ink sm:text-[32px]">
              <Sparkles className="h-6 w-6 text-sage-deep" />
              {t("mika.title")}
            </h1>
            <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{t("mika.subtitle")}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1 pt-1.5 text-[13px] text-ink-soft">
            <ChatHistoryMenu chat={chat} withLabel />
            {messages.length > 0 && (
              <button
                type="button"
                onClick={reset}
                aria-label={t("mika.newChat")}
                title={t("mika.newChat")}
                className="inline-flex h-9 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold text-ink-muted transition-colors hover:bg-black/[0.04] hover:text-ink sm:px-3"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t("mika.newChat")}</span>
              </button>
            )}
          </div>
        </div>
        <ChatPairPicker pair={pair} onChange={changePair} className="mt-3 inline-block" />
      </div>

      {/* the conversation (or the welcome presets) — the only scrolling part */}
      <div
        ref={scrollRef}
        className={cn(
          "flex-1 overflow-y-auto",
          messages.length > 0 && "space-y-4 rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6",
        )}
      >
        {messages.length === 0 ? (
          <section className="space-y-3">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-faint">{t("mika.tryThese")}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {PRESETS.map(({ key, Icon, href, nav, open }) => (
                <div
                  key={key}
                  className="group flex flex-col rounded-[18px] border border-black/[0.06] bg-surface transition-colors hover:border-sage/50"
                >
                  <button type="button" onClick={() => applyPreset(key, open)} className="flex flex-1 items-start gap-3 p-4 text-left">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-sage-tint text-sage-deep">
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold text-ink">{t(`mika.p.${key}.title`)}</span>
                      <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-soft">{t(`mika.p.${key}.desc`)}</span>
                    </span>
                  </button>
                  {href && nav && (
                    <Link href={href} className="mx-4 mb-3 -mt-1 self-start pl-12 text-[12px] font-semibold text-sage hover:text-sage-deep">
                      {t(nav)} →
                    </Link>
                  )}
                </div>
              ))}
            </div>
          </section>
        ) : (
          <TutorThread chat={chat} large />
        )}
      </div>

      {/* composer — pinned under the thread, so it sits in the same place whether
          the conversation is two lines or twenty */}
      <div className="mt-3">
        {unfinished && <p className="mb-1.5 px-3 text-[13px] text-ink-muted">{t("tutor.finishTemplate")}</p>}
        <TutorComposer chat={chat} inputRef={inputRef} fileRef={fileRef} large />
      </div>
    </div>
  );
}
