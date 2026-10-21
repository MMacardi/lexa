"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, isDue } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { getLearnerLevel, levelName, usesHsk } from "@/lib/learnPrefs";
import { useSharedTutorChat, useTutorLastPath } from "@/components/TutorChatProvider";
import { ChatPairPicker } from "@/components/ChatPairPicker";
import { FIXED_PAIR } from "@/lib/langs";
import { ChatHistoryMenu } from "@/components/ChatHistoryMenu";
import { MikaMemoryLink } from "@/components/MikaMemoryLink";
import { MikaPinyinToggle } from "@/components/MikaPinyinToggle";
import { TutorThread } from "@/components/TutorThread";
import { TutorComposer, useImageDrop, DropHint } from "@/components/TutorComposer";
import { MikaPracticeCards, MikaPracticeLinks } from "@/components/MikaPractice";
import { useDragDownDismiss, useIsMobile, useLockScroll } from "@/lib/mobileNav";
import { useChatScroll } from "@/lib/chatScroll";
import { JumpToLatest } from "@/components/JumpToLatest";
import { cn } from "@/lib/utils";
import { GraduationCap, Tags, Scale, Layers, BookOpen, CalendarCheck, RotateCcw, Sparkles, Camera, ArrowLeft, type LucideIcon } from "lucide-react";

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
  { key: "today", Icon: CalendarCheck, href: "/", nav: "nav.today" },
];

export default function MikaPage() {
  const { t } = useI18n();
  const { accountId } = useAccount();
  const chat = useSharedTutorChat();
  const { pair, changePair, messages, setInput, reset, busy, unfinished, card } = chat;
  const lastPath = useTutorLastPath();
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

  // The conversation scrolls inside its own panel, so the composer stays put. Kept
  // the way a messenger keeps it: opens on the newest line, follows an answer only
  // while it is read at the bottom, holds that bottom when the keyboard or the
  // composer takes room (lib/chatScroll.ts).
  const { away, toLatest } = useChatScroll(scrollRef, messages, true, busy);

  // On a phone the page is the chat itself (the author, 2026-10-15: "like in
  // messengers"): over the whole screen and sized to what the keyboard leaves
  // (.mika-chat, globals.css), its own slim bar in place of the app's, the input
  // box docked at the bottom — above the tab bar, or right on the keyboard while
  // typing. The page under it stays put, and a drag down across the input box puts
  // the keyboard away, as in Telegram.
  const mobile = useIsMobile();
  useLockScroll(mobile);
  const pageRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  useDragDownDismiss(pageRef, barRef, mobile);
  // Where the tab bar starts, measured (its height carries the home indicator's room).
  const [tabBar, setTabBar] = useState<number | null>(null);
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>("[data-tabbar]");
    if (!bar) return;
    const read = () => setTabBar(bar.getBoundingClientRect().height);
    read();
    const ro = new ResizeObserver(read);
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);
  const back = card ? `/word/${card.id}` : lastPath;

  function applyPreset(key: string, open?: boolean) {
    if (key === "photo") return fileRef.current?.click();
    const text = t(`mika.p.${key}.prompt`, { level: levelName(pair.source, getLearnerLevel(pair.source) ?? (usesHsk(pair.source) ? "3" : "B1")), due });
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
    <div
      {...drop.props}
      ref={pageRef}
      style={tabBar === null ? undefined : ({ "--mika-bar": `${tabBar}px` } as React.CSSProperties)}
      className="mika-chat relative mx-auto flex min-h-0 min-w-0 max-w-[760px] flex-col max-md:bg-surface md:h-[calc(100dvh-88px)]"
    >
      {drop.dragging && <DropHint />}
      {/* Phones: a messenger's bar — back, her name (and the card a card chat is
          about), past chats, a new one. */}
      <div className="shrink-0 border-b border-black/[0.06] bg-gradient-to-br from-sage-tint/70 to-transparent pt-[env(safe-area-inset-top)] md:hidden">
        <div className="flex h-14 items-center gap-1 px-1.5">
          {back ? (
            <Link
              href={back}
              aria-label={t("common.back")}
              title={t("common.back")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-black/[0.04] hover:text-ink"
            >
              <ArrowLeft className="h-5 w-5" />
            </Link>
          ) : (
            <span className="w-2.5 shrink-0" />
          )}
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sage to-sage-deep text-white">
            <Sparkles className="h-[18px] w-[18px]" />
          </span>
          <div className="ml-1.5 min-w-0 flex-1">
            <p className="truncate font-serif text-[18px] font-semibold leading-tight text-ink">{t("mika.title")}</p>
            {card && <p className="truncate text-[12px] font-semibold text-sage-deep">{card.word}</p>}
          </div>
          <ChatHistoryMenu chat={chat} withLabel />
          <MikaMemoryLink lang={pair.source} compact />
          {messages.length > 0 && (
            <button
              type="button"
              onClick={reset}
              aria-label={t("mika.newChat")}
              title={t("mika.newChat")}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-black/[0.04] hover:text-ink"
            >
              <RotateCcw className="h-[18px] w-[18px]" />
            </button>
          )}
        </div>
        <div className="px-4 pb-2"><MikaPinyinToggle lang={pair.source} /></div>
        {!FIXED_PAIR && (
          <div className="px-4 pb-2">
            <ChatPairPicker pair={pair} onChange={changePair} className="inline-block" />
          </div>
        )}
      </div>
      {/* Title on the left, the session actions against the right edge, the pair on
          its own line below. All three pills used to sit in one left-hugging huddle
          under the subtitle, which left the header lopsided — and History's menu
          (right-aligned, as menus are) dropped straight over the pair chip next to
          it. */}
      <div className="mb-4 shrink-0 max-md:hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-[220px]">
            <h1 className="flex items-center gap-2 font-serif text-[28px] font-medium text-ink sm:text-[32px]">
              <Sparkles className="h-6 w-6 text-sage-deep" />
              {t("mika.title")}
            </h1>
            <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{t("mika.subtitle")}</p>
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-1 pt-1.5 text-[13px] text-ink-soft">
            <ChatHistoryMenu chat={chat} withLabel />
            <MikaMemoryLink lang={pair.source} />
            <MikaPinyinToggle lang={pair.source} />
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
        {/* The way back: a chat about a card returns to that card (expanded from
            Explain on a word page), anything else to the page Mika was opened on. */}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {card ? (
            <Link
              href={`/word/${card.id}`}
              title={t("tutor.aboutCard", { word: card.word })}
              className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-sage/40 bg-sage-tint/60 px-2.5 text-[12px] font-semibold text-sage-deep transition-colors hover:bg-sage-tint"
            >
              <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{card.word}</span>
            </Link>
          ) : lastPath ? (
            <Link
              href={lastPath}
              aria-label={t("common.back")}
              title={t("common.back")}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-black/[0.08] px-2.5 text-[12px] font-semibold text-ink-muted transition-colors hover:bg-black/[0.04] hover:text-ink"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              {t("common.back")}
            </Link>
          ) : null}
          {!FIXED_PAIR && <ChatPairPicker pair={pair} onChange={changePair} className="inline-block" />}
        </div>
      </div>

      {/* the conversation (or the welcome presets) — the only scrolling part. A short
          conversation sits at the bottom, by the input box, as in a messenger. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain max-md:px-4 max-md:py-4",
          messages.length > 0 && "md:rounded-[20px] md:border md:border-black/[0.06] md:bg-surface md:p-6",
        )}
      >
        {messages.length === 0 ? (
          <div className="space-y-6">
          {/* Practice first: it is what a learner can't find anywhere else (they leave
              the chat), and the ask presets below it are a long list on a phone */}
          <div className="sm:hidden">
            <MikaPracticeLinks page />
          </div>
          <div className="hidden sm:block">
            <MikaPracticeCards />
          </div>
          <section className="space-y-3">
            <p className="text-[13px] font-semibold uppercase tracking-wide text-ink-faint">{t("mika.askGroup")}</p>
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
          </div>
        ) : (
          <div className="flex min-h-full flex-col justify-end space-y-4">
            <TutorThread chat={chat} large />
          </div>
        )}
      </div>
      <JumpToLatest show={away} onClick={toLatest} />
      </div>

      {/* composer — pinned under the thread, so it sits in the same place whether
          the conversation is two lines or twenty */}
      <div ref={barRef} className="mt-3 shrink-0 max-md:mt-0 max-md:border-t max-md:border-black/[0.06] max-md:px-3 max-md:py-2">
        {unfinished && <p className="mb-1.5 px-3 text-[13px] text-ink-muted">{t("tutor.finishTemplate")}</p>}
        <TutorComposer chat={chat} inputRef={inputRef} fileRef={fileRef} large />
      </div>
    </div>
  );
}
