"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useSheetDrag } from "@/lib/mobileNav";
import { cn } from "@/lib/utils";
import { X } from "lucide-react";

// Phone bottom sheet: scrim + panel docked to the bottom of the visible viewport
// (so the keyboard never covers it), with a grab bar and a close button. Swipe
// it down by the grab bar or title (or the content, when scrolled to the top) to
// close it.
//
// `composer` is quick add, whose word box sits at the top of the sheet. Docked
// to the visible viewport, the sheet rode up with the keyboard and bounced;
// with the box down low, iOS also panned the page to reach it. Pinned to the
// screen instead, the sheet stays where it is when the keyboard opens: the box
// is high enough that the keyboard doesn't reach it, and only the options
// under it are covered while typing.
export function MobileSheet({
  title,
  closing,
  onClose,
  composer,
  children,
}: {
  title: string;
  closing: boolean;
  onClose: () => void;
  composer?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const shade = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const grip = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useSheetDrag({ shade, panel, grip, body }, closing, onClose);
  // The slide starts two frames after mounting. The form's saved settings (pair,
  // mode, recent pairs) land in effects right after the first paint and change
  // its height; sliding from the first frame, the sheet jumped partway up.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setEntered(true));
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div
      data-closing={closing || undefined}
      className={cn(
        "anim-scrim z-40 flex flex-col justify-end md:hidden",
        composer ? "fixed inset-0 pt-[calc(12px+env(safe-area-inset-top))]" : "vv-overlay",
      )}
      onClick={onClose}
    >
      {/* the dim layer on its own, so a drag can fade it by opacity alone */}
      <div ref={shade} aria-hidden className="absolute inset-0 bg-black/35" />
      <div
        ref={panel}
        data-closing={closing || undefined}
        className={cn(
          "relative flex flex-col rounded-t-[24px] border-t border-black/[0.08] bg-surface shadow-[0_-12px_40px_rgba(46,42,38,0.25)]",
          entered ? "anim-sheet" : "invisible",
          // Quick add is its full height from the start: sized to its content, it
          // grew upward as the dictionary rows came in, carrying the field and the
          // draw pad up under the finger on every letter.
          composer ? "h-full" : "max-h-[calc(100%-12px)]",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* the grip: grab bar + title row, draggable to close */}
        <div ref={grip} className="shrink-0 touch-none">
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-black/15" />
          <div className="flex items-center justify-between px-5 pt-2 pb-1">
            <h2 className="font-serif text-[20px] font-semibold text-ink">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("nav.close")}
              className="-mr-2 flex h-9 w-9 items-center justify-center rounded-full text-ink-faint hover:bg-black/[0.04] hover:text-ink"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
        <div
          ref={body}
          className="min-h-0 overflow-y-auto overscroll-contain px-4 pt-2 pb-[calc(16px+env(safe-area-inset-bottom))]"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
