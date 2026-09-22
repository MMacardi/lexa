"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { TutorCardCtx } from "./useTutorChat";

// Mobile shell helpers: the customizable bottom-bar slots, the "open X" events
// the bar/header fire at always-mounted overlays (Mika, bug report), and the
// visual-viewport CSS vars that keep sheets above the on-screen keyboard.

export const OPEN_MIKA = "onomika:open-mika";
export const OPEN_BUG = "onomika:open-bug";
export const OPEN_ADD = "onomika:open-add";

export const open = (event: string) => window.dispatchEvent(new Event(event));

// Open Mika on a chat about one card ("Explain with Onomika" on the word page).
// The answer lands in the widget instead of a panel wedged into the page, so it
// stays readable while the card is scrolled and joins the chat history.
export const openMikaOnCard = (card: TutorCardCtx) =>
  window.dispatchEvent(new CustomEvent(OPEN_MIKA, { detail: { card } }));

// Three user-picked tabs around the fixed centre Mika button (two left, one right).
export const SLOT_COUNT = 3;
export const DEFAULT_SLOTS = ["/", "/review", "/words"];
const SLOTS_KEY = "onomika.navSlots";

export function useNavSlots(allowed: string[]) {
  const [slots, setSlotsState] = useState<string[]>(DEFAULT_SLOTS);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(SLOTS_KEY) ?? "null");
      if (Array.isArray(v) && v.length === SLOT_COUNT && v.every((h) => allowed.includes(h))) setSlotsState(v);
    } catch {
      /* ignore */
    }
    // `allowed` is a static list; read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function setSlots(next: string[]) {
    setSlotsState(next);
    try {
      localStorage.setItem(SLOTS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }
  return [slots, setSlots] as const;
}

// Phone layout = below Tailwind's `md` breakpoint.
export function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const on = () => setMobile(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return mobile;
}

// iOS Safari doesn't shrink the layout viewport when the keyboard opens, so a
// `fixed inset-0` modal ends up under the keyboard. Mirror the *visual* viewport
// into --vv-top / --vv-h; the `.vv-overlay` class (globals.css) sizes overlays by it.
export function useViewportVars() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement.style;
    const sync = () => {
      root.setProperty("--vv-top", `${vv.offsetTop}px`);
      root.setProperty("--vv-h", `${vv.height}px`);
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);
}

// Freeze the page behind an open sheet so a swipe inside it doesn't scroll the page.
export function useLockScroll(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [active]);
}

// Swipe a bottom sheet down to close it, the way iOS sheets go. The grip (grab
// bar + title row) drags it any time; the body only when it's scrolled to the top
// and the swipe starts downward, so scrolling the form still scrolls it. The
// panel follows the finger through `translate`, since the open/close animations
// own `transform` and an animation beats an inline style. Let go past a third of
// its height, or with a flick, and it closes from where it is; otherwise it
// springs back. The scrim thins as the panel travels.
export function useSheetDrag(
  refs: {
    scrim: RefObject<HTMLElement | null>;
    panel: RefObject<HTMLElement | null>;
    grip: RefObject<HTMLElement | null>;
    body: RefObject<HTMLElement | null>;
  },
  closing: boolean,
  onDismiss: () => void,
) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const { scrim, panel, grip, body } = refs;

  const place = (y: number, animate: boolean) => {
    const p = panel.current;
    const s = scrim.current;
    if (!p || !s) return;
    const ease = "0.32s var(--ease-out)";
    p.style.transition = animate ? `translate ${ease}` : "none";
    s.style.transition = animate ? `background-color ${ease}` : "none";
    p.style.translate = `0 ${y}px`;
    const fade = Math.max(0, 1 - y / (p.offsetHeight || 1));
    s.style.backgroundColor = `rgba(0, 0, 0, ${(0.35 * fade).toFixed(3)})`;
  };
  const reset = () => {
    for (const el of [panel.current, scrim.current]) {
      el?.style.removeProperty("transition");
      el?.style.removeProperty("translate");
      el?.style.removeProperty("background-color");
    }
  };

  // Opened again while still sliding away: start from a clean panel.
  useEffect(() => {
    if (!closing) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  useEffect(() => {
    const p = panel.current;
    if (!p) return;
    let mode: null | "pending" | "drag" = null;
    let fromGrip = false;
    let startX = 0;
    let startY = 0;
    let dy = 0;
    let samples: { y: number; t: number }[] = [];
    let settle: ReturnType<typeof setTimeout> | undefined;

    const onStart = (e: TouchEvent) => {
      mode = null;
      if (e.touches.length !== 1) return;
      const target = e.target as Node;
      fromGrip = !!grip.current?.contains(target);
      const b = body.current;
      if (!fromGrip && !(b?.contains(target) && b.scrollTop <= 0)) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      dy = 0;
      mode = "pending";
    };
    const onMove = (e: TouchEvent) => {
      if (!mode) return;
      const { clientX: x, clientY: y } = e.touches[0];
      if (mode === "pending") {
        const ddx = x - startX;
        const ddy = y - startY;
        // The grip has touch-action: none, so it can wait for a clear gesture.
        // The body must decide on its first move: once the browser starts
        // scrolling it, the swipe can't be taken over any more.
        if (fromGrip && Math.abs(ddx) < 4 && Math.abs(ddy) < 4) return;
        if (Math.abs(ddy) < Math.abs(ddx) || (!fromGrip && ddy <= 0)) {
          mode = null;
          return;
        }
        mode = "drag";
        clearTimeout(settle);
        startY = y; // follow from here, so the panel doesn't jump the threshold
        samples = [];
      }
      if (e.cancelable) e.preventDefault();
      dy = Math.max(0, y - startY);
      samples.push({ y, t: e.timeStamp });
      place(dy, false);
    };
    const onEnd = () => {
      if (mode !== "drag") {
        mode = null;
        return;
      }
      mode = null;
      // Speed over the last ~100ms of the swipe, in px/ms.
      const last = samples[samples.length - 1];
      const recent = samples.filter((s) => last && s.t >= last.t - 100);
      const first = recent[0];
      const v = first && last && last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
      const h = p.offsetHeight;
      if (dy > h / 3 || (v > 0.5 && dy > 24)) {
        dismiss.current(); // the close animation carries on from the current offset
        return;
      }
      place(0, true);
      settle = setTimeout(reset, 340);
    };

    p.addEventListener("touchstart", onStart, { passive: true });
    p.addEventListener("touchmove", onMove, { passive: false });
    p.addEventListener("touchend", onEnd);
    p.addEventListener("touchcancel", onEnd);
    return () => {
      clearTimeout(settle);
      p.removeEventListener("touchstart", onStart);
      p.removeEventListener("touchmove", onMove);
      p.removeEventListener("touchend", onEnd);
      p.removeEventListener("touchcancel", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
