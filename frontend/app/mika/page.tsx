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
import { TutorThread } from "@/components/TutorThread";
import { GraduationCap, Tags, Scale, Layers, BookOpen, MessagesSquare, CalendarCheck, RotateCcw, Sparkles, type LucideIcon } from "lucide-react";

// Welcome-screen presets. Each fills the input (editable, not sent) and doubles as
// a tour: the blurb says which part of the app it relates to, `href` links there.
// `open` = the prompt ends where the learner types (a topic, two words): Send waits for it.
const PRESETS: { key: string; Icon: LucideIcon; href?: string; nav?: string; open?: boolean }[] = [
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
  const { pair, changePair, messages, input, setInput, send, reset, busy, unfinished } = chat;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // Due count, so "what should I study today?" gives Mika real context.
  const { data: words } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
    enabled: !!accountId,
  });
  const due = (words ?? []).filter(isDue).length;

  useEffect(() => {
    if (messages.length || busy) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  // Grow the textarea with its content (up to a cap).
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [input]);

  function applyPreset(key: string, open?: boolean) {
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
    <div className="mx-auto flex max-w-[760px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-serif text-[28px] font-medium text-ink sm:text-[32px]">
            <Sparkles className="h-6 w-6 text-sage-deep" />
            {t("mika.title")}
          </h1>
          <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{t("mika.subtitle")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[13px] text-ink-soft">
          <ChatPairPicker pair={pair} onChange={changePair} />
          {messages.length > 0 && (
            <button
              type="button"
              onClick={reset}
              aria-label={t("mika.newChat")}
              className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-ink-muted transition-colors hover:bg-black/[0.04] hover:text-ink"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t("mika.newChat")}
            </button>
          )}
        </div>
      </div>

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
        <section className="min-h-[40vh] space-y-4 rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
          <TutorThread chat={chat} large />
          <div ref={endRef} />
        </section>
      )}

      {/* composer — sticks above the mobile tab bar */}
      {unfinished && <p className="-mb-4 px-3 text-[13px] text-ink-muted">{t("tutor.finishTemplate")}</p>}
      <form
        className="sticky bottom-[calc(64px_+_env(safe-area-inset-bottom))] z-10 flex items-end gap-2 rounded-[22px] border border-black/[0.08] bg-surface p-2 shadow-[0_10px_30px_rgba(46,42,38,0.12)] md:bottom-6"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={inputRef}
          rows={1}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={t("tutor.placeholder")}
          disabled={busy}
          className="max-h-[180px] min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-[16px] leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none sm:text-[15px]"
        />
        <button
          type="submit"
          disabled={busy || !input.trim() || unfinished}
          className="shrink-0 rounded-full bg-sage px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sage-deep disabled:opacity-40"
        >
          {t("word.send")}
        </button>
      </form>
    </div>
  );
}
