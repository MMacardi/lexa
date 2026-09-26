"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { History, Search, Trash2 } from "lucide-react";
import type { TutorChat } from "@/lib/useTutorChat";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { usePresence } from "@/lib/motion";

// A chat's timestamp: the clock for today, the date once it's older.
function when(at: number): string {
  const d = new Date(at);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString();
}

// Past chats are only worth searching once there are enough of them to scroll.
const SEARCH_FROM = 5;

// Mika's past conversations (kept in this browser). Opening one makes it the live
// chat again, so an old question can be picked up instead of retyped. `compact` is
// the chip that sits beside the language pair in the floating widget; `withLabel`
// the roomier pill on the /mika page.
export function ChatHistoryMenu({
  chat,
  withLabel = false,
  compact = false,
}: {
  chat: TutorChat;
  withLabel?: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const { history, chatId, openChat, removeChat } = chat;
  const [open, setOpen] = useState(false);
  const menu = usePresence(open);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Search reads the whole conversation, not just its opening line: a chat is
  // usually remembered by a word that came up in it.
  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => (needle ? history.filter((c) => c.hay.includes(needle) || c.title.toLowerCase().includes(needle)) : history),
    [history, needle],
  );

  if (history.length === 0) return null;
  const label = withLabel || compact;

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("mika.history")}
        title={t("mika.history")}
        className={cn(
          "inline-flex items-center gap-1.5 font-semibold text-ink-muted transition-colors hover:bg-black/[0.04] hover:text-ink",
          withLabel && "h-9 rounded-full px-2.5 text-[13px] sm:px-3",
          compact && "h-8 rounded-full border border-black/[0.08] bg-surface px-2.5 text-[12px] hover:border-sage/50",
          !label && "rounded-lg p-1.5 text-ink-faint",
          open && (compact ? "border-sage bg-sage-tint text-sage-deep" : "bg-black/[0.04] text-ink"),
        )}
      >
        <History className="h-3.5 w-3.5" />
        {/* on the /mika page the label hides on a phone, where the header needs the
            room more than the word does — the icon and the tooltip carry it there */}
        {compact && t("mika.history")}
        {withLabel && <span className="hidden sm:inline">{t("mika.history")}</span>}
      </button>

      {menu.mounted && (
        <div
          data-closing={menu.closing || undefined}
          className={cn(
            "anim-scale-in absolute top-full z-40 mt-2 w-[270px] overflow-hidden rounded-[16px] border border-black/[0.08] bg-surface shadow-[0_18px_44px_rgba(46,42,38,0.22)]",
            compact ? "left-0 [--drop-origin:top_left]" : "right-0 [--drop-origin:top_right]",
          )}
        >
          {history.length >= SEARCH_FROM && (
            <div className="flex items-center gap-2 border-b border-black/[0.06] px-3 py-2">
              <Search className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t("mika.searchChats")}
                className="min-w-0 flex-1 bg-transparent text-[16px] text-ink placeholder:text-ink-faint focus:outline-none sm:text-[13px]"
              />
            </div>
          )}
          <ul className="max-h-[280px] overflow-y-auto p-1.5">
            {shown.map((c) => (
              <li key={c.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => {
                    openChat(c.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "min-w-0 flex-1 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-sage-tint/60",
                    c.id === chatId && "bg-sage-tint/50",
                  )}
                >
                  <span className="block truncate text-[13px] font-medium text-ink">{c.title || t(c.photo ? "tutor.photoChat" : "mika.untitledChat")}</span>
                  <span className="mt-0.5 block text-[11px] text-ink-faint">{when(c.at)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => removeChat(c.id)}
                  aria-label={t("mika.deleteChat")}
                  title={t("mika.deleteChat")}
                  className="shrink-0 rounded-lg p-1.5 text-ink-faint opacity-0 transition-opacity hover:bg-black/[0.04] hover:text-warn-text focus:opacity-100 group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {shown.length === 0 && <li className="px-2.5 py-3 text-[13px] text-ink-faint">{t("mika.noChatsFound")}</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
