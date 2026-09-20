"use client";

import { useState } from "react";
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

  return (
    <div className={cn("min-w-0", className)}>
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
        <div className="mt-2 space-y-2 rounded-[14px] border border-black/[0.08] bg-paper/60 p-2.5">
          <label className="flex items-center justify-between gap-2 text-[13px] text-ink-faint">
            {t("first.learn")}
            <LangSelect
              value={pair.source}
              onChange={(v) => onChange({ source: v, target: pair.target })}
              className="h-8 min-w-0 flex-1"
            />
          </label>
          <label className="flex items-center justify-between gap-2 text-[13px] text-ink-faint">
            {t("mika.answersIn")}
            <LangSelect
              value={pair.target}
              onChange={(v) => onChange({ source: pair.source, target: v })}
              className="h-8 min-w-0 flex-1"
            />
          </label>
        </div>
      )}
    </div>
  );
}
