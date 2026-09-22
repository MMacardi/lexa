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
// and the swipe starts downward, so scrolling the form still scrolls it.
//
// Every frame of the drag only moves compositor layers: the panel through
// `translate` (the open/close animations own `transform`, and an animation beats
// an inline style) and the shade behind it through `opacity`. Fading the scrim by
// its background colour instead repainted the whole page under it on each touch
// move, which is what made the drag stutter. Writes are batched to one per frame
// and the panel is measured once, when the drag starts.
//
// Let go past a third of the panel's height, or with a flick, and it is thrown
// off the screen at the speed the finger left it, then closed; otherwise it
// settles back.
export function useSheetDrag(
  refs: {
    shade: RefObject<HTMLElement | null>;
    panel: RefObject<HTMLElement | null>;
    grip: RefObject<HTMLElement | null>;
    body: RefObject<HTMLElement | null>;
  },
  closing: boolean,
  onDismiss: () => void,
) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const { shade, panel, grip, body } = refs;

  const clear = () => {
    for (const el of [panel.current, shade.current]) {
      if (!el) continue;
      for (const prop of ["transition", "translate", "opacity", "will-change"]) el.style.removeProperty(prop);
    }
  };

  // Opened again while still sliding away: start from a clean panel.
  useEffect(() => {
    if (!closing) clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  useEffect(() => {
    const p = panel.current;
    if (!p) return;
    let mode: null | "pending" | "drag" | "thrown" = null;
    let fromGrip = false;
    let startX = 0;
    let startY = 0;
    let dy = 0;
    let height = 1;
    let frame = 0;
    let samples: { y: number; t: number }[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const paint = () => {
      frame = 0;
      p.style.translate = `0 ${dy}px`;
      if (shade.current) shade.current.style.opacity = String(Math.max(0, 1 - dy / height));
    };
    const animateTo = (y: number, ms: number, curve: string) => {
      const tr = `${ms}ms ${curve}`;
      p.style.transition = `translate ${tr}`;
      if (shade.current) shade.current.style.transition = `opacity ${tr}`;
      dy = y;
      paint();
    };

    const onStart = (e: TouchEvent) => {
      if (mode === "thrown") return;
      mode = null;
      if (e.touches.length !== 1) return;
      const target = e.target as Node;
      fromGrip = !!grip.current?.contains(target);
      const b = body.current;
      if (!fromGrip && !(b?.contains(target) && b.scrollTop <= 0)) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      mode = "pending";
    };
    const onMove = (e: TouchEvent) => {
      if (mode !== "pending" && mode !== "drag") return;
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
        clearTimeout(timer);
        height = p.offsetHeight || 1; // the only read: before any write this drag
        // Pick the panel up where it is (it may still be settling back).
        const current = parseFloat(getComputedStyle(p).translate.split(" ")[1] ?? "0") || 0;
        startY = y - current;
        samples = [];
        p.style.transition = "none";
        p.style.willChange = "transform, translate";
        if (shade.current) {
          shade.current.style.transition = "none";
          shade.current.style.willChange = "opacity";
        }
      }
      if (e.cancelable) e.preventDefault();
      dy = Math.max(0, y - startY);
      samples.push({ y, t: e.timeStamp });
      if (samples.length > 8) samples.shift();
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const onEnd = () => {
      if (mode !== "drag") {
        if (mode === "pending") mode = null;
        return;
      }
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      // Speed over the last ~80ms of the swipe, in px/ms (down is positive).
      const last = samples[samples.length - 1];
      const first = samples.find((s) => last && s.t >= last.t - 80);
      const v = first && last && last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
      if (dy > height / 3 || (v > 0.45 && dy > 16)) {
        mode = "thrown";
        // Leave at the finger's speed: an ease-out curve starts at ~2x its average
        // speed, so the duration that matches the release speed is 2 * distance / v.
        const distance = height + 24 - dy; // + the shadow
        const ms = Math.round(Math.min(320, Math.max(140, (2 * distance) / Math.max(v, 0.6))));
        animateTo(height + 24, ms, "cubic-bezier(0.25, 0.5, 0.35, 1)");
        timer = setTimeout(() => {
          mode = null;
          dismiss.current();
        }, ms);
        return;
      }
      mode = null;
      animateTo(0, 300, "var(--ease-out)");
      timer = setTimeout(clear, 320);
    };

    p.addEventListener("touchstart", onStart, { passive: true });
    p.addEventListener("touchmove", onMove, { passive: false });
    p.addEventListener("touchend", onEnd);
    p.addEventListener("touchcancel", onEnd);
    return () => {
      clearTimeout(timer);
      if (frame) cancelAnimationFrame(frame);
      p.removeEventListener("touchstart", onStart);
      p.removeEventListener("touchmove", onMove);
      p.removeEventListener("touchend", onEnd);
      p.removeEventListener("touchcancel", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
