"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, GraduationCap, MessageSquare } from "lucide-react";
import { LangSelect } from "@/components/LangSelect";
import { useI18n } from "@/lib/i18n";
import { displayCode, langLabel } from "@/lib/langs";
import { cn } from "@/lib/utils";

// The chat's language pair, collapsed into one chip. Two labelled dropdowns side
// by side wrapped onto two lines in the Mika widget and ate a third of a phone
// panel before any message showed, so the pair now reads as a chip and the full
// labelled selects appear only when it's tapped. The chip stays labelled by icon
// (learning / replies in) rather than a bare "A → B", which people read as
// "translate from A to B" and flipped.
//
// The selects open as a popover, not inline: unfolded in the header row they
// shoved the History pill sideways, and History's own menu — absolute, as menus
// are — then dropped straight through them. Each field sits under its own label
// rather than beside it, so "Учу" and "Отвечает на" can't leave the two boxes
// starting at different places.
export function ChatPairPicker({
  pair,
  onChange,
  className,
}: {
  pair: { source: string; target: string };
  onChange: (pair: { source: string; target: string }) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // Close on an outside click, which also means opening History closes this.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      // A language menu renders in a portal, outside this box — picking from one
      // must not unmount the select before its click lands.
      if (boxRef.current?.contains(el as Node) || el?.closest?.("[data-lang-menu]")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("mika.pairLabel")}
        title={`${t("first.learn")} ${langLabel(pair.source)} · ${t("mika.answersIn")} ${langLabel(pair.target)}`}
        className={cn(
          "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-semibold transition-colors",
          open ? "border-sage bg-sage-tint text-sage-deep" : "border-black/[0.08] bg-surface text-ink-muted hover:border-sage/50",
        )}
      >
        <GraduationCap className="h-3.5 w-3.5 shrink-0 text-sage-deep" />
        <span className="uppercase">{displayCode(pair.source)}</span>
        <MessageSquare className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
        <span className="uppercase">{displayCode(pair.target)}</span>
        <ChevronDown className={cn("h-3 w-3 shrink-0 text-ink-faint transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="anim-scale-in absolute left-0 top-full z-50 mt-2 w-[264px] max-w-[calc(100vw-32px)] space-y-2.5 rounded-[16px] border border-black/[0.08] bg-surface p-3 shadow-[0_18px_44px_rgba(46,42,38,0.22)]">
          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-ink-faint">
              <GraduationCap className="h-3.5 w-3.5 text-sage-deep" />
              {t("first.learn")}
            </span>
            <LangSelect value={pair.source} onChange={(v) => onChange({ source: v, target: pair.target })} />
          </label>
          <label className="block">
            <span className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-ink-faint">
              <MessageSquare className="h-3.5 w-3.5" />
              {t("mika.answersIn")}
            </span>
            <LangSelect value={pair.target} onChange={(v) => onChange({ source: pair.source, target: v })} />
          </label>
        </div>
      )}
    </div>
  );
}
