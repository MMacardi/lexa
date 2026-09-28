"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// Every title="" in the app, drawn as the app's own tooltip (HoverTip's dark bubble)
// instead of the browser's grey box. Some forty icon buttons, badges and chips carry
// a title; rather than wrap each in <HoverTip> (and miss the next one), this lifts the
// title off whatever the mouse is over while it's there and puts it back on the way
// out, so screen readers and the next hover still find it. Touch never showed titles,
// so only the mouse is handled.
export function TitleTips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  // Near a screen edge, slide the bubble back inside it (measured once it's drawn).
  const [shift, setShift] = useState(0);
  useLayoutEffect(() => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return setShift(0);
    setShift(r.left < 8 ? 8 - r.left : r.right > window.innerWidth - 8 ? window.innerWidth - 8 - r.right : 0);
  }, [tip]);

  useEffect(() => {
    let el: Element | null = null;
    let text = "";
    const leave = () => {
      // React may have rendered a new title meanwhile; that one wins.
      if (el && !el.hasAttribute("title")) el.setAttribute("title", text);
      el = null;
      setTip(null);
    };
    const over = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const at = e.target as Element;
      if (el && el.contains(at)) return; // still inside the element that has the tip
      if (el) leave();
      const target = at.closest?.("[title]");
      const t = target?.getAttribute("title")?.trim();
      if (!target || !t) return;
      el = target;
      text = target.getAttribute("title") ?? "";
      target.removeAttribute("title");
      const r = target.getBoundingClientRect();
      // Above the element as HoverTip does, unless that would leave the screen.
      const below = r.top < 48;
      setShift(0);
      setTip({ text: t, x: r.left + r.width / 2, y: below ? r.bottom : r.top, below });
    };
    const out = (e: PointerEvent) => {
      if (!el) return;
      const to = e.relatedTarget as Node | null;
      if (to && el.contains(to)) return;
      leave();
    };
    // A click or a scroll hides the bubble; the title comes back once the mouse leaves,
    // so the browser's own tooltip doesn't pop up under a finger that's still there.
    const hide = () => setTip(null);
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("pointerdown", hide);
    window.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("pointerdown", hide);
      window.removeEventListener("scroll", hide, true);
      leave();
    };
  }, []);

  if (!tip) return null;
  return createPortal(
    <div
      ref={box}
      role="tooltip"
      className={
        "pointer-events-none fixed z-[95] max-w-[260px] -translate-x-1/2 rounded-[10px] bg-onyx px-2.5 py-1.5 text-center text-[12px] font-semibold text-white shadow-[0_10px_28px_rgba(0,0,0,0.28)] " +
        (tip.below ? "" : "-translate-y-full")
      }
      style={{ left: tip.x + shift, top: tip.below ? tip.y + 8 : tip.y - 8 }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
