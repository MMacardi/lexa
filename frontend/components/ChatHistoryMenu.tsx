"use client";

import { useEffect, useRef, useState } from "react";
import { History, Trash2 } from "lucide-react";
import type { TutorChat } from "@/lib/useTutorChat";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

// A chat's timestamp: the clock for today, the date once it's older.
function when(at: number): string {
  const d = new Date(at);
  const sameDay = new Date().toDateString() === d.toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString();
}

// Mika's past conversations (kept in this browser). Opening one makes it the live
// chat again, so an old question can be picked up instead of retyped.
export function ChatHistoryMenu({ chat, withLabel = false }: { chat: TutorChat; withLabel?: boolean }) {
  const { t } = useI18n();
  const { history, chatId, openChat, removeChat } = chat;
  const [open, setOpen] = useState(false);
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

  if (history.length === 0) return null;

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
          withLabel ? "h-9 rounded-full px-3 text-[13px]" : "rounded-lg p-1.5 text-ink-faint",
          open && "bg-black/[0.04] text-ink",
        )}
      >
        <History className="h-3.5 w-3.5" />
        {withLabel && t("mika.history")}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[270px] overflow-hidden rounded-[16px] border border-black/[0.08] bg-surface shadow-[0_18px_44px_rgba(46,42,38,0.22)]">
          <ul className="max-h-[280px] overflow-y-auto p-1.5">
            {history.map((c) => (
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
                  <span className="block truncate text-[13px] font-medium text-ink">{c.title || t("mika.untitledChat")}</span>
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
          </ul>
        </div>
      )}
    </div>
  );
}
