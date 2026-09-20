"use client";

import { useEffect, useState } from "react";
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
