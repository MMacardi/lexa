"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, ChevronDown } from "lucide-react";
import { LangSelect } from "@/components/LangSelect";
import { useI18n } from "@/lib/i18n";
import { langLabel } from "@/lib/langs";
import { cn } from "@/lib/utils";
import { prefersReducedMotion, usePresence } from "@/lib/motion";

// The study pair as one labelled chip, with the pickers behind it (BACKLOG "Stop
// asking which language"). The app is one pair — Chinese, explained in what you
// already speak — yet the add form, the Reader, the Coach and the import dialog
// each opened on two dropdowns, asking a question the account already answered.
// The chip states the pair; a tap opens the labelled pickers for the rare change.
// Both sides stay labelled in words (Learning / I know), never a bare "A → B":
// that reads as a translation direction and people really did set it backwards
// (BACKLOG 3g). ChatPairPicker is the same idea, sized for a chat header.
export function PairChip({
  source,
  target,
  onSource,
  onTarget,
  onSwap,
  allowAuto,
  autoLabel,
  menuClassName,
  className,
}: {
  source: string;
  target: string;
  onSource: (lang: string) => void;
  onTarget: (lang: string) => void;
  onSwap?: () => void;
  allowAuto?: boolean;
  autoLabel?: string;
  menuClassName?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const menu = usePresence(open);
  const boxRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape. A language menu renders in a portal,
  // outside this box — picking from one must not close the popover first.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
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

  // Low in a sheet, the panel opened past the bottom of the screen with the
  // "I know" picker out of reach; scroll just enough to show all of it. Only
  // once its entrance ends (onAnimationEnd below): mid-animation it is lifted
  // and shrunk, and the scroll fell short. Reduced motion has no entrance.
  const reveal = () => panelRef.current?.scrollIntoView({ block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  useEffect(() => {
    if (open && prefersReducedMotion()) reveal();
  }, [open]);

  const sourceName = source === "auto" ? (autoLabel ?? source) : langLabel(source);

  return (
    <div ref={boxRef} className={cn("relative min-w-0", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={t("pair.change")}
        className={cn(
          "inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-0.5 rounded-full border px-3 py-1.5 text-[13px] transition-colors",
          open ? "border-sage bg-sage-tint" : "border-black/[0.08] bg-surface hover:border-sage/50",
        )}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("first.learn")}</span>
        <span className="font-semibold text-ink">{sourceName}</span>
        <span className="text-ink-faint">·</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("first.know")}</span>
        <span className="font-semibold text-ink">{langLabel(target)}</span>
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform", open && "rotate-180")} />
      </button>

      {menu.mounted && (
        <div
          ref={panelRef}
          data-closing={menu.closing || undefined}
          onAnimationEnd={(e) => open && e.target === e.currentTarget && reveal()}
          className="anim-scale-in absolute left-0 top-full z-50 mt-2 w-[280px] max-w-[calc(100vw-32px)] space-y-2.5 rounded-[16px] border border-black/[0.08] bg-surface p-3 shadow-[0_18px_44px_rgba(46,42,38,0.22)]"
        >
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-ink-faint">{t("first.learn")}</span>
            <LangSelect value={source} onChange={onSource} allowAuto={allowAuto} autoLabel={autoLabel} menuClassName={menuClassName} />
          </label>
          {onSwap && (
            <button
              type="button"
              onClick={onSwap}
              disabled={source === "auto"}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-muted transition-colors hover:text-sage-deep disabled:opacity-40"
            >
              <ArrowRightLeft className="h-3.5 w-3.5" /> {t("add.swap")}
            </button>
          )}
          <label className="block">
            <span className="mb-1 block text-[12px] font-semibold text-ink-faint">{t("first.know")}</span>
            <LangSelect value={target} onChange={onTarget} menuClassName={menuClassName} />
          </label>
        </div>
      )}
    </div>
  );
}
