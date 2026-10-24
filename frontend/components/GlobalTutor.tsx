"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useI18n } from "@/lib/i18n";
import { useClosing } from "@/lib/motion";
import { getLearnerLevel, levelName, usesHsk } from "@/lib/learnPrefs";
import { type TutorCardCtx } from "@/lib/useTutorChat";
import { useSharedTutorChat, useReportPanelOpen } from "@/components/TutorChatProvider";
import { ChatPairPicker } from "@/components/ChatPairPicker";
import { FIXED_PAIR } from "@/lib/langs";
import { MikaPracticeLinks } from "@/components/MikaPractice";
import { ChatHistoryMenu } from "@/components/ChatHistoryMenu";
import { MikaMemoryLink } from "@/components/MikaMemoryLink";
import { MikaPinyinToggle } from "@/components/MikaPinyinToggle";
import { TutorThread } from "@/components/TutorThread";
import { TutorComposer, useImageDrop, DropHint } from "@/components/TutorComposer";
import { HoverTip } from "@/components/ui/HoverTip";
import { OPEN_MIKA, takeMikaOpen, useDragDownDismiss, useIsMobile, useLockScroll, useSheetDrag } from "@/lib/mobileNav";
import { useChatScroll } from "@/lib/chatScroll";
import { JumpToLatest } from "@/components/JumpToLatest";
import { cn } from "@/lib/utils";
import { Sparkles, RotateCcw, X, LocateFixed, GripHorizontal, Maximize2, BookOpen, PenLine } from "lucide-react";

export function GlobalTutor() {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // Phones get a bottom sheet opened from the tab bar's centre button; desktop
  // keeps the floating, draggable panel.
  const mobile = useIsMobile();
  // The phone sheet slides back off the edge and the desktop panel shrinks into
  // its corner before either unmounts.
  const { closing, close: animateClose } = useClosing(open, () => setOpen(false), mobile ? 200 : 150);
  useLockScroll(open && mobile);
  useReportPanelOpen(open);
  useEffect(() => {
    const onReader = () => setOpen(false);
    window.addEventListener("onomika:reader-open", onReader);
    return () => window.removeEventListener("onomika:reader-open", onReader);
  }, []);
  const chat = useSharedTutorChat();
  const { pair, changePair, messages, send, reset, busy, unfinished, card, startCard } = chat;
  const drop = useImageDrop(chat);
  // The word page opens Mika on a card ("Explain with Onomika"); the tab bar opens
  // it plain. Kept in a ref so the listener is registered once.
  const startRef = useRef(startCard);
  startRef.current = startCard;
  const readerResetRef = useRef(() => {});
  readerResetRef.current = () => { if (card) reset(); };
  useEffect(() => {
    const on = (e: Event) => {
      const queued = takeMikaOpen();
      const detail = (e as CustomEvent<{ card?: TutorCardCtx; reader?: boolean }>).detail ?? queued;
      const ctx = detail?.card;
      setOpen(true);
      if (detail?.reader) readerResetRef.current();
      if (ctx) startRef.current(ctx);
    };
    window.addEventListener(OPEN_MIKA, on);
    const queued = takeMikaOpen();
    if (queued) { setOpen(true); if (queued.reader) readerResetRef.current(); if (queued.card) startRef.current(queued.card); }
    return () => window.removeEventListener(OPEN_MIKA, on);
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  function close() {
    inputRef.current?.blur();
    animateClose();
  }
  const fileRef = useRef<HTMLInputElement>(null);
  // Draggable panel: offset from its docked corner, remembered across opens and
  // page reloads (localStorage). The "reset position" button clears it.
  const [offset, setOffset] = useState<{ x: number; y: number }>(() => {
    try {
      const r = localStorage.getItem("lexa.tutorPos");
      if (r) {
        const p = JSON.parse(r);
        if (typeof p?.x === "number" && typeof p?.y === "number") return p;
      }
    } catch {
      /* ignore */
    }
    return { x: 0, y: 0 };
  });
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try {
      localStorage.setItem("lexa.tutorPos", JSON.stringify(offset));
    } catch {
      /* ignore */
    }
  }, [offset]);
  // Keep the panel fully on screen — so it can never be dragged off and lost, and
  // a stored position from a bigger window is pulled back in.
  function clampToViewport() {
    const el = panelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    setOffset((o) => {
      let x = o.x;
      let y = o.y;
      if (r.left < pad) x += pad - r.left;
      else if (r.right > window.innerWidth - pad) x -= r.right - (window.innerWidth - pad);
      if (r.top < pad) y += pad - r.top;
      else if (r.bottom > window.innerHeight - pad) y -= r.bottom - (window.innerHeight - pad);
      return x === o.x && y === o.y ? o : { x, y };
    });
  }
  function startDrag(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("button, a, input, select, [role='button']")) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y };
  }
  function moveDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    setOffset({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
  }
  function endDrag() {
    dragRef.current = null;
    clampToViewport();
  }
  // Re-clamp when the panel opens, the window resizes, or the panel itself grows.
  // It's docked by its bottom edge, so a panel dragged up while the chat was
  // empty grew upward with every message until its header — the drag handle and
  // the reset button with it — was above the screen and it couldn't be moved.
  useEffect(() => {
    const el = panelRef.current;
    if (!open || mobile || !el) return;
    const onResize = () => clampToViewport();
    // Fires once when observing starts, after the panel has laid out.
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    window.addEventListener("resize", onResize);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [open, mobile]);
  const moved = offset.x !== 0 || offset.y !== 0;

  // Opens on the newest line, follows an answer only while it is being read at the
  // bottom, and keeps that bottom through the keyboard (lib/chatScroll.ts).
  const { away, toLatest } = useChatScroll(scrollRef, messages, open, busy);
  // Dragging down across the input box puts the keyboard away, as in Telegram.
  const sheetRef = useRef<HTMLDivElement>(null);
  const shadeRef = useRef<HTMLDivElement>(null);
  const gripRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  useDragDownDismiss(sheetRef, footerRef, open && mobile);
  useSheetDrag({ shade: shadeRef, panel: sheetRef, grip: gripRef, body: scrollRef }, closing, close, open && mobile);

  function fillTemplate(template: string) {
    chat.fillTemplate(template);
    inputRef.current?.focus();
  }

  return (
    <>
      {/* floating action button */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("tutor.open")}
          className="fixed bottom-6 right-4 z-50 hidden h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-sage to-sage-deep text-white shadow-[0_12px_32px_rgba(46,42,38,0.32)] transition-transform hover:scale-105 active:scale-95 md:flex"
        >
          <Sparkles className="h-6 w-6" />
        </button>
      )}

      {/* chat panel — a bottom sheet over a scrim on phones */}
      {open && (
        <SheetScrim mobile={mobile} closing={closing} onClose={close} shadeRef={shadeRef}>
        <div
          data-closing={closing || undefined}
          ref={mobile ? sheetRef : panelRef}
          className={cn(
            "z-[60] flex min-h-0 flex-col overflow-hidden bg-surface",
            mobile
              ? "anim-sheet relative max-h-[calc(100%-12px)] min-h-[min(420px,calc(100%-12px))] rounded-t-[24px] border-t border-black/[0.08] shadow-[0_-12px_40px_rgba(46,42,38,0.25)]"
              : "anim-panel fixed right-4 bottom-6 max-h-[75vh] w-[400px] rounded-[22px] border border-black/[0.08] shadow-[0_24px_60px_rgba(46,42,38,0.34)]",
          )}
          style={mobile ? undefined : { transform: `translate(${offset.x}px, ${offset.y}px)` }}
          // The open animation starts it scaled down; measure it again at full size.
          onAnimationEnd={mobile ? undefined : clampToViewport}
          onClick={(e) => e.stopPropagation()}
          {...drop.props}
        >
          {drop.dragging && <DropHint />}
          {/* header — title, centered drag handle, clickable language pair, actions.
              On a phone the grab bar sits inside it, under the same tint: above it,
              it left a white strip across the top of the sheet. */}
          <div ref={gripRef} className={cn("shrink-0 border-b border-black/[0.06] bg-gradient-to-br from-sage-tint/70 to-transparent px-4 pb-4", mobile ? "touch-none pt-2" : "pt-3")}>
            {mobile && <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-black/15" />}
            <div className="relative flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-serif text-[17px] font-semibold text-ink">
                <Sparkles className="h-[18px] w-[18px] text-sage-deep" />
                {t("tutor.title")}
              </div>
              {!mobile && <div
                onPointerDown={startDrag}
                onPointerMove={moveDrag}
                onPointerUp={endDrag}
                aria-label={t("common.drag")}
                className="absolute left-1/2 flex -translate-x-1/2 cursor-grab touch-none select-none items-center px-6 py-1 text-ink-faint transition-colors hover:text-ink-muted active:cursor-grabbing"
              >
                <GripHorizontal className="h-4 w-4" />
              </div>}
              <div className="flex items-center gap-1.5">
                {moved && !mobile && (
                  <HoverTip title={t("tutor.resetPos")} className="inline-flex">
                    <button
                      type="button"
                      onClick={() => setOffset({ x: 0, y: 0 })}
                      aria-label={t("tutor.resetPos")}
                      className="rounded-lg p-1.5 text-ink-faint hover:bg-black/[0.04] hover:text-ink"
                    >
                      <LocateFixed className="h-3.5 w-3.5" />
                    </button>
                  </HoverTip>
                )}
                {messages.length > 0 && (
                  <HoverTip title={t("mika.newChat")} className="inline-flex">
                    <button
                      type="button"
                      onClick={reset}
                      aria-label={t("mika.newChat")}
                      className="rounded-lg p-1.5 text-ink-faint hover:bg-black/[0.04] hover:text-ink"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </HoverTip>
                )}
                <HoverTip title={t("tutor.openPage")} className="inline-flex">
                  <Link
                    href="/mika"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={close}
                    aria-label={t("tutor.openPage")}
                    className="rounded-lg p-1.5 text-ink-faint hover:bg-black/[0.04] hover:text-ink"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Link>
                </HoverTip>
                <button
                  type="button"
                  // Keep focus until click: Safari otherwise dismisses the keyboard
                  // on pointerdown and moves this button before the tap finishes.
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={close}
                  aria-label={t("common.cancel")}
                  className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-black/[0.05] hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {!FIXED_PAIR && <ChatPairPicker pair={pair} onChange={changePair} />}
              {/* Past chats sit next to the pair, where the eye already is, rather
                  than as one more grey icon among the window controls. */}
              <ChatHistoryMenu chat={chat} compact />
              <MikaPinyinToggle lang={pair.source} />
              <MikaMemoryLink lang={pair.source} onClick={close} />
              {card && (
                <Link
                  href={`/word/${card.id}`}
                  onClick={close}
                  title={t("tutor.aboutCard", { word: card.word })}
                  className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full border border-sage/40 bg-sage-tint/60 px-2.5 text-[12px] font-semibold text-sage-deep transition-colors hover:bg-sage-tint"
                >
                  <BookOpen className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{card.word}</span>
                </Link>
              )}
            </div>
          </div>

          {/* conversation / welcome */}
          <div className="relative flex min-h-0 flex-1 flex-col">
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-[14px] leading-relaxed text-ink-soft">{t("tutor.welcome")}</p>
                <div className="flex flex-wrap gap-1.5">
                  <Chip onClick={() => fileRef.current?.click()}>{t("tutor.suggestPhoto")}</Chip>
                  <Chip onClick={() => fillTemplate(t("tutor.topicTemplate"))}>{t("tutor.suggestTopic")}</Chip>
                  <Chip onClick={() => send(t("tutor.levelTemplate", { level: levelName(pair.source, getLearnerLevel(pair.source) ?? (usesHsk(pair.source) ? "3" : "B1")) }))}>
                    {t("tutor.suggestLevel")}
                  </Chip>
                  <Chip onClick={() => fillTemplate(t("tutor.explainTemplate"))}>{t("tutor.suggestExplain")}</Chip>
                </div>
                {/* Practice, beside asking — not when the chat is about one card */}
                {!card && <MikaPracticeLinks onGo={close} />}
              </div>
            )}

            <TutorThread chat={chat} />
          </div>
          <JumpToLatest show={away} onClick={toLatest} />
          </div>

          {/* footer: input (collection choice appears with the "create cards" action) */}
          <div ref={footerRef} className={cn("shrink-0 border-t border-black/[0.06] px-3 py-2.5", mobile && "kb-pad pb-[calc(10px+var(--safe-bottom))]")}>
            {/* free recall, right in the chat: write what you remember, Mika grades it */}
            {card && messages.length > 0 && !busy && (
              <button
                type="button"
                onClick={() => send(t("word.testMeSeed"))}
                className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-sage/50 bg-surface px-3 py-1.5 text-[12px] font-semibold text-sage-deep transition-colors hover:bg-sage-tint/60"
              >
                <PenLine className="h-3.5 w-3.5" /> {t("word.testMe")}
              </button>
            )}
            {unfinished && <p className="mb-1.5 px-1 text-[13px] text-ink-muted">{t("tutor.finishTemplate")}</p>}
            <TutorComposer chat={chat} inputRef={inputRef} fileRef={fileRef} />
          </div>
        </div>
        </SheetScrim>
      )}
    </>
  );
}

// Phones: dim the page and dock the panel to the bottom of the visible viewport
// (above the keyboard). Desktop: render the floating panel as-is.
function SheetScrim({ mobile, closing, onClose, shadeRef, children }: { mobile: boolean; closing: boolean; onClose: () => void; shadeRef: React.RefObject<HTMLDivElement | null>; children: React.ReactNode }) {
  if (!mobile) return <>{children}</>;
  return (
    <div
      data-closing={closing || undefined}
      className="vv-overlay anim-scrim z-[60] flex flex-col justify-end"
      onClick={onClose}
    >
      <div ref={shadeRef} aria-hidden className="absolute inset-0 bg-black/35" />
      {children}
    </div>
  );
}

function Chip({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-full border border-sage/40 bg-sage-tint/50 px-3 py-1.5 text-[12px] font-semibold text-sage-deep transition-colors hover:bg-sage-tint"
    >
      {children}
    </button>
  );
}
