"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

// Where a portaled dropdown sits relative to its trigger.
//
// The menus used to be `position: fixed` and re-measured on every scroll event.
// A phone scrolls on the compositor and delivers those events late, so the menu
// visibly slid away from its button and caught up after the swipe. Now a menu
// on a normal page is `position: absolute` in document coordinates: the page's
// own scroll carries it together with the trigger, with no JS in between. Only a
// trigger inside a fixed or sticky layer (a sheet, a dialog, the top bar), which
// doesn't move with the page, keeps a `fixed` menu that follows it by measuring.
export type Anchor = {
  position: "fixed" | "absolute";
  /** Trigger box in the menu's own coordinate space. */
  left: number;
  top: number;
  bottom: number;
  width: number;
  /** Room between the trigger and the visible viewport's edges. */
  spaceAbove: number;
  spaceBelow: number;
};

function inFixedLayer(el: HTMLElement) {
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const p = getComputedStyle(n).position;
    if (p === "fixed" || p === "sticky") return true;
  }
  return false;
}

export function useAnchor(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [shift, setShift] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const fixed = inFixedLayer(el);
    const measure = () => {
      const r = el.getBoundingClientRect();
      const sx = fixed ? 0 : window.scrollX;
      const sy = fixed ? 0 : window.scrollY;
      const vv = window.visualViewport;
      const viewTop = vv?.offsetTop ?? 0;
      const viewBottom = viewTop + (vv?.height ?? window.innerHeight);
      const next: Anchor = {
        position: fixed ? "fixed" : "absolute",
        left: r.left + sx,
        top: r.top + sy,
        bottom: r.bottom + sy,
        width: r.width,
        spaceAbove: r.top - viewTop,
        spaceBelow: viewBottom - r.bottom,
      };
      // Same numbers keep the same object, so an unmoved menu doesn't re-render.
      setAnchor((p) => (p && (Object.keys(next) as (keyof Anchor)[]).every((k) => p[k] === next[k]) ? p : next));
    };
    measure();
    // The page's own scroll moves a document-anchored menu for free; an inner
    // scroller (a sheet body, a sideways row) still moves the trigger alone.
    const onScroll = (e: Event) => {
      if (!fixed && (e.target === document || e.target === document.documentElement)) return;
      measure();
    };
    const vv = window.visualViewport;
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", measure);
    // The phone keyboard resizes the visual viewport, and sheets follow it.
    vv?.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", measure);
      vv?.removeEventListener("resize", measure);
    };
  }, [open, ref]);

  // A menu wider than the room right of its trigger is pulled back inside the
  // screen. A fixed one would only be cut off there, but an absolute one would
  // widen the page and let a phone scroll it sideways.
  useLayoutEffect(() => {
    const m = menuRef.current;
    if (!anchor || !m) return;
    const sx = anchor.position === "absolute" ? window.scrollX : 0;
    const right = sx + document.documentElement.clientWidth - 8;
    const next = Math.min(0, right - (anchor.left + m.offsetWidth));
    setShift((s) => (s === next ? s : next));
  });

  // Kept after closing, so the menu can play its exit where it stood.
  if (!anchor) return null;
  const minLeft = (anchor.position === "absolute" ? window.scrollX : 0) + 8;
  return { ...anchor, left: Math.max(minLeft, anchor.left + shift) };
}

// Search boxes in a menu grab focus on desktop, where typing is the fast path.
// On a touch screen that pops the keyboard over the list you opened, and iOS
// scrolls the page to make room for it; there you tap the field when you want it.
export const focusOnOpen = () =>
  typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
