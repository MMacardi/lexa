"use client";

import { useLayoutEffect, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// Keep document coordinates so page scrolling carries the popup with its word.
// Measure again when the loaded meaning, viewport or available space changes.
export function ReaderWordPopup({ anchor, popupRef, onClose, label, className, children }: {
  anchor: HTMLElement | null;
  popupRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  label: string;
  className: string;
  children: ReactNode;
}) {
  useLayoutEffect(() => {
    const box = popupRef.current;
    if (!box || !anchor) return;
    const measure = () => {
      if (!anchor.isConnected) return onClose();
      const rect = anchor.getBoundingClientRect();
      const vv = window.visualViewport;
      const left = vv?.offsetLeft ?? 0, top = vv?.offsetTop ?? 0;
      const width = vv?.width ?? document.documentElement.clientWidth;
      const height = vv?.height ?? window.innerHeight;
      if (rect.bottom < top || rect.top > top + height) return onClose();
      box.style.maxWidth = `${Math.max(0, Math.min(240, width - 16))}px`;
      box.style.maxHeight = `${Math.max(0, height - 16)}px`;
      const x = Math.max(left + 8, Math.min(left + width - box.offsetWidth - 8, rect.left + (rect.width - box.offsetWidth) / 2));
      const belowSpace = Math.max(0, top + height - rect.bottom - 16);
      const aboveSpace = Math.max(0, rect.top - top - 16);
      const below = box.offsetHeight <= belowSpace || (box.offsetHeight > aboveSpace && belowSpace >= aboveSpace);
      box.style.maxHeight = `${below ? belowSpace : aboveSpace}px`;
      const y = Math.max(top + 8, Math.min(top + height - box.offsetHeight - 8,
        below ? rect.bottom + 8 : rect.top - box.offsetHeight - 8));
      box.style.left = `${window.scrollX + x}px`;
      box.style.top = `${window.scrollY + y}px`;
      box.style.visibility = "visible";
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("scroll", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("scroll", measure);
    };
  }, [anchor, popupRef, onClose]);

  return createPortal(
    <div ref={popupRef} role="dialog" aria-label={label}
      className={`absolute z-[90] w-[240px] overflow-y-auto overscroll-contain break-words ${className}`}
      style={{ visibility: "hidden" }}>
      {children}
    </div>, document.body,
  );
}
