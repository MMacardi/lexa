"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { TutorCardCtx } from "./useTutorChat";
import { dragFollower } from "./dragFollow";
import { FOCUS } from "./focus";

// Mobile shell helpers: the customizable bottom-bar slots, the "open X" events
// the bar/header fire at always-mounted overlays (Mika, bug report), and the
// visual-viewport CSS vars that keep sheets above the on-screen keyboard.

export const OPEN_MIKA = "onomika:open-mika";
export const OPEN_BUG = "onomika:open-bug";
export const OPEN_ADD = "onomika:open-add";
let pendingMika: { card?: TutorCardCtx; reader?: boolean } | null = null;
export const takeMikaOpen = () => { const pending = pendingMika; pendingMika = null; return pending; };

export const open = (event: string) => {
  if (event === OPEN_MIKA) pendingMika = {};
  return window.dispatchEvent(new Event(event));
};

export const openMikaOnReader = () => {
  pendingMika = { reader: true };
  window.dispatchEvent(new CustomEvent(OPEN_MIKA, { detail: pendingMika }));
};

// Open Mika on a chat about one card ("Explain with Onomika" on the word page).
// The answer lands in the widget instead of a panel wedged into the page, so it
// stays readable while the card is scrolled and joins the chat history.
export const openMikaOnCard = (card: TutorCardCtx) => {
  pendingMika = { card };
  return window.dispatchEvent(new CustomEvent(OPEN_MIKA, { detail: { card } }));
};

// Three user-picked tabs around the fixed centre Mika button (two left, one right).
// Focused, the bar is the focused nav itself (Today · Words · Capture); the full
// build keeps its old default, with the Reader one tap away under "More".
export const SLOT_COUNT = 3;
export const DEFAULT_SLOTS = FOCUS ? ["/", "/words", "/reader"] : ["/", "/review", "/words"];
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

// A touch screen with no mouse (phones, tablets, whatever their width): there a
// press-and-drag gesture on the page fights the finger scrolling it.
export function useTouchOnly() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(hover: none) and (pointer: coarse)");
    const on = () => setTouch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return touch;
}

// iOS Safari doesn't shrink the layout viewport when the keyboard opens, so a
// `fixed inset-0` modal ends up under the keyboard. Mirror the *visual* viewport
// into --vv-top / --vv-h; the `.vv-overlay` class (globals.css) sizes overlays by it.
// Written only when a value changes: this runs on every viewport scroll event, and
// an inherited custom property set on <html> restyles the whole page — on a long
// Reader text that is enough to leave blank tiles behind a fast swipe.
//
// The keyboard. iOS reports the final viewport as the keyboard *starts* to rise,
// then pans the page up to it over the keyboard's own animation. Snapped to those
// numbers at once, a sheet shrank and dropped to the bottom of the screen, then
// rode up with the pan: the jump the author saw on Mika's sheet (2026-10-14). So
// when the height changes by a keyboard's worth, <html> gets `data-vv-anim` for
// the length of that animation and the overlay glides to its new box (globals.css)
// in step with the pan: its top edge holds still while its bottom follows the
// keyboard. `data-kb` says the keyboard is up, so a composer can drop the
// home-indicator room under it (--safe-bottom), which the keyboard covers anyway.
//
// Closing is told in advance. iOS slides the page back down with the keyboard but
// reports the full viewport only once it has gone (and sends nothing at all for
// "Done"), so the sheet rode down with the page and then glided back up to fill
// the screen: the close the author found rough (2026-10-15). A field losing focus
// to no other field means the keyboard is leaving now, so the overlay glides to the
// viewport it had before the keyboard straight away, in step with it, and readings
// that still show the keyboard are skipped meanwhile; focus landing in a field
// again calls that off.
const isField = (t: EventTarget | null) =>
  t instanceof HTMLElement &&
  (t.isContentEditable || t.matches("textarea, select, input:not([type=checkbox], [type=radio], [type=range], [type=button], [type=submit], [type=file])"));

const selectingText = () => window.getSelection()?.isCollapsed === false;

export function useViewportVars() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const html = document.documentElement;
    const root = html.style;
    let top = "";
    let h = "";
    let lastH = vv.height;
    // The viewport with no keyboard up, which a close glides back to.
    let restTop = vv.offsetTop;
    let restH = vv.height;
    let holdUntil = 0;
    let animTimer: ReturnType<typeof setTimeout> | undefined;
    // The layout viewport keeps its height under the keyboard; a pinch zoom
    // shrinks the visual one too, but by its scale.
    const keyboardUp = () => Math.max(window.innerHeight, html.clientHeight) - vv.height * vv.scale > 150;
    const write = (offsetTop: number, height: number, kb: boolean) => {
      if (Math.abs(height - lastH) > 100) {
        html.dataset.vvAnim = "";
        clearTimeout(animTimer);
        animTimer = setTimeout(() => delete html.dataset.vvAnim, 450);
      }
      lastH = height;
      if (kb !== ("kb" in html.dataset)) {
        if (kb) html.dataset.kb = "";
        else delete html.dataset.kb;
      }
      const nextTop = `${offsetTop}px`;
      const nextH = `${height}px`;
      if (nextTop !== top) root.setProperty("--vv-top", (top = nextTop));
      if (nextH !== h) root.setProperty("--vv-h", (h = nextH));
    };
    const sync = () => {
      const kb = keyboardUp();
      if (!kb) {
        // Safari can leave the document panned after Done, even with overflow
        // hidden. A pinned training screen has no way to scroll back by hand.
        if (pins > 0 && vv.scale === 1 && (window.scrollY || vv.offsetTop)) window.scrollTo(0, 0);
        restTop = vv.offsetTop;
        restH = vv.height;
      } else if (performance.now() < holdUntil) return; // the keyboard on its way out
      write(vv.offsetTop, vv.height, kb);
    };
    // iOS can send its last viewport event before the keyboard has finished
    // moving, and none at all when it is dismissed with "Done": the vars kept the
    // keyboard-open height and a dialog's scrim stopped halfway down the screen.
    // So after any sign of change, keep reading for a moment and let the final
    // value land (writes still happen only when a value differs).
    let raf = 0;
    let until = 0;
    const tick = () => {
      sync();
      raf = performance.now() < until ? requestAnimationFrame(tick) : 0;
    };
    const settle = () => {
      until = performance.now() + 700;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onFocusIn = (e: FocusEvent) => {
      if (isField(e.target)) holdUntil = 0;
      settle();
    };
    const onFocusOut = (e: FocusEvent) => {
      settle();
      if (!("kb" in html.dataset) || isField(e.relatedTarget)) return;
      holdUntil = performance.now() + 600;
      write(restTop, restH, false);
    };
    sync();
    vv.addEventListener("resize", settle);
    vv.addEventListener("scroll", settle);
    window.addEventListener("resize", settle);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(animTimer);
      vv.removeEventListener("resize", settle);
      vv.removeEventListener("scroll", settle);
      window.removeEventListener("resize", settle);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
    };
  }, []);
}

// A sheet or dialog (.vv-overlay, and Mika's page on a phone, .mika-chat) keeps a
// swipe to itself: one on it scrolls what
// it is on, or nothing. With the keyboard up the visible screen is shorter than the
// page, and iOS panned it under the finger — the sheet slid down behind the
// keyboard or up off the screen, with the page showing past it (the author's
// screenshots, 2026-10-15). A swipe where no scroller can move that way (none
// under the finger, or one already at its end) is cancelled on its first move,
// the only one a browser lets a page cancel. Fields keep theirs (iOS drags the
// caret with them), as does what handles its own touches (the draw pad, a slider).
export function useOverlayTouchGuard() {
  useEffect(() => {
    let x0 = 0;
    let y0 = 0;
    let overlay: Element | null = null;
    let first = false;
    const canScroll = (from: Element, axis: "x" | "y", forward: boolean) => {
      for (let n: Element | null = from; n; n = n === overlay ? null : n.parentElement) {
        const s = getComputedStyle(n);
        if (!/(auto|scroll)/.test(axis === "y" ? s.overflowY : s.overflowX)) continue;
        const [pos, size, view] = axis === "y" ? [n.scrollTop, n.scrollHeight, n.clientHeight] : [Math.abs(n.scrollLeft), n.scrollWidth, n.clientWidth];
        if (size <= view + 1) continue;
        if (forward ? pos + view < size - 1 : pos > 0) return true;
      }
      return false;
    };
    const onStart = (e: TouchEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      overlay = t?.closest(".vv-overlay, .mika-chat") ?? null;
      if (overlay && (isField(t) || t?.closest("[data-own-touch], input[type=range]"))) overlay = null;
      first = true;
      x0 = e.touches[0]?.clientX ?? 0;
      y0 = e.touches[0]?.clientY ?? 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!first) return;
      first = false;
      // Selection handles belong to the browser, including at a scroller's edge.
      if (selectingText()) return;
      if (!overlay || e.touches.length !== 1 || !e.cancelable || !(e.target instanceof Element)) return;
      const dx = e.touches[0].clientX - x0;
      const dy = e.touches[0].clientY - y0;
      if (!dx && !dy) return;
      // A finger moving up scrolls forward (towards the end).
      const ok = Math.abs(dx) > Math.abs(dy) ? canScroll(e.target, "x", dx < 0) : canScroll(e.target, "y", dy < 0);
      if (!ok) e.preventDefault();
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
    };
  }, []);
}

// Telegram's way out of the keyboard: drag down across the input box and it goes.
// A page can't hand the keyboard to the finger, so a downward drag on `area` that
// reaches the top of `bar` (the composer) takes the focus from the field in it, and
// the keyboard slides away with the sheet following (useViewportVars). `on` = mounted.
export function useDragDownDismiss(area: RefObject<HTMLElement | null>, bar: RefObject<HTMLElement | null>, on = true) {
  useEffect(() => {
    const el = area.current;
    if (!on || !el) return;
    let startY = 0;
    let lastY = 0;
    const onStart = (e: TouchEvent) => {
      startY = lastY = e.touches[0]?.clientY ?? 0;
    };
    const onMove = (e: TouchEvent) => {
      const y = e.touches[0]?.clientY ?? 0;
      const down = y > lastY;
      lastY = y;
      if (!down || y - startY < 24 || selectingText() || !("kb" in document.documentElement.dataset)) return;
      const field = document.activeElement;
      if (!(field instanceof HTMLElement) || !bar.current?.contains(field)) return;
      if (y >= bar.current.getBoundingClientRect().top) field.blur();
    };
    el.addEventListener("touchstart", onStart, { passive: true });
    el.addEventListener("touchmove", onMove, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onStart);
      el.removeEventListener("touchmove", onMove);
    };
  }, [area, bar, on]);
}

// A chat's scroller keeps its bottom edge in place when it changes size, the way a
// messenger does. The keyboard shrinks Mika's sheet from below; keeping its
// scrollTop instead, the list slid the newest lines under the composer and showed
// the start of the answer. Run in a ResizeObserver, so the new scroll position is
// painted in the same frame as the new size, every frame of the keyboard's glide.
// `on` = the scroller is mounted (a sheet that is open).
export function useKeepBottom(ref: RefObject<HTMLElement | null>, on = true, pinned?: RefObject<boolean>) {
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    let top = el.scrollTop;
    let h = el.clientHeight;
    const onScroll = () => {
      // WebKit may clamp scrollTop and emit scroll before the resize observer.
      // Keep the pre-resize position until the observer has adjusted it once.
      if (el.clientHeight === h) top = el.scrollTop;
    };
    const ro = new ResizeObserver(() => {
      const next = el.clientHeight;
      if (next === h) return;
      // The browser may already have clamped scrollTop to the smaller range;
      // `top` is where it was before the resize.
      el.scrollTop = pinned?.current ? el.scrollHeight : top + (h - next);
      top = el.scrollTop;
      h = next;
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
    };
  }, [ref, on, pinned]);
}

let scrollLock: {
  count: number; x: number; y: number; frozen: boolean;
  styles: { name: string; value: string; priority: string }[];
} | undefined;

// Overflow alone still lets iOS move the background behind Mika. Fix the body
// at its existing scroll offset before paint; keep that freeze until every
// overlapping overlay releases its lock, then restore the page in one frame.
export function useLockScroll(active: boolean, freezePage = false) {
  useLayoutEffect(() => {
    if (!active) return;
    const style = document.body.style;
    const lock = scrollLock ??= {
      count: 0, x: window.scrollX, y: window.scrollY, frozen: false,
      styles: ["overflow", "position", "top", "left", "width", "--page-lock-header-top"].map((name) => ({
        name, value: style.getPropertyValue(name), priority: style.getPropertyPriority(name),
      })),
    };
    lock.count++;
    if (freezePage && !lock.frozen) {
      const headerTop = document.querySelector<HTMLElement>("[data-mobile-header]")?.getBoundingClientRect().top ?? 0;
      lock.frozen = true;
      style.position = "fixed";
      style.top = `${-lock.y}px`;
      style.left = `${-lock.x}px`;
      style.width = "100%";
      // Fixing the body changes the sticky header's scroll reference too.
      style.setProperty("--page-lock-header-top", `${headerTop}px`);
    }
    style.overflow = "hidden";
    return () => {
      if (--lock.count) return;
      for (const { name, value, priority } of lock.styles) {
        if (value) style.setProperty(name, value, priority);
        else style.removeProperty(name);
      }
      window.scrollTo({ left: lock.x, top: lock.y, behavior: "instant" });
      scrollLock = undefined;
    };
  }, [active, freezePage]);
}

// A training screen that fits a phone's screen is pinned while it's up: the page
// can't scroll, so no drag beside the card or the writing square, or anywhere on
// a setup, moves it (the author, 2026-10-10: no scrolling in any mode or setup).
// iOS rubber-bands even a page that can't scroll, so touch scrolling is cancelled
// too, except inside an area whose own content overflows (a sheet, a dialog),
// checked once per touch. Counted, so a setup handing over to its session (both
// pinned, in either order) never leaves the page locked or unlocked by mistake.
let pins = 0;
export function usePinnedPage(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const html = document.documentElement;
    if (pins++ === 0) {
      window.scrollTo(0, 0);
      html.style.overflow = "hidden";
      html.style.overscrollBehavior = "none";
    }
    let allow = false;
    const onStart = (e: TouchEvent) => {
      allow = false;
      const target = e.target instanceof Element ? e.target : null;
      // Overlays have their own touch guard; fields and native selection must
      // keep caret/selection gestures even when the chat has nothing to scroll.
      if (target?.closest(".vv-overlay, .mika-chat, [data-own-touch]") || isField(target)) {
        allow = true;
        return;
      }
      for (let n = e.target as Element | null; n && n !== document.body; n = n.parentElement) {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight + 1) {
          allow = true;
          return;
        }
      }
    };
    const onMove = (e: TouchEvent) => {
      if (!allow && !selectingText() && e.cancelable) e.preventDefault();
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    return () => {
      if (--pins === 0) {
        html.style.overflow = "";
        html.style.overscrollBehavior = "";
      }
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
    };
  }, [on]);
}

// Pins a phone screen (usePinnedPage) while the element given to the returned ref
// ends above the tab bar: a setup, an end screen, a quiz question. Measured again
// whenever it changes size (a hint dismissed, a list picked) and on resize; a
// screen too tall for the phone scrolls as before.
export function useFitPinned(on = true) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [fits, setFits] = useState(false);
  useEffect(() => {
    if (!on || !el) return setFits(false);
    const measure = () => {
      if (!window.matchMedia("(max-width: 639px)").matches) return setFits(false);
      const view = window.visualViewport?.height ?? window.innerHeight;
      const bar = document.querySelector("[data-tabbar]")?.getBoundingClientRect().height ?? 0;
      setFits(el.getBoundingClientRect().bottom + window.scrollY <= view - bar - 8);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [el, on]);
  usePinnedPage(on && !!el && fits);
  return setEl;
}

// Swipe a bottom sheet down to close it, the way iOS sheets go. The grip (grab
// bar + title row) drags it any time; the body only when it's scrolled to the top
// and the swipe starts downward, so scrolling the form still scrolls it. Nothing
// marked data-own-touch starts a drag: the draw pad's strokes go down too, and
// each one used to pull the sheet away mid-character.
//
// Every frame of the drag only moves compositor layers: the panel through
// `translate` (the open/close animations own `transform`, and an animation beats
// an inline style) and the shade behind it through `opacity`. Fading the scrim by
// its background colour instead repainted the whole page under it on each touch
// move, which is what made the drag stutter. The panel follows a smoothed finger
// (see dragFollow.ts), written once per frame, and is measured once, when the
// drag starts.
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
  on = true,
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
    if (!on || !p) return;
    let mode: null | "pending" | "drag" | "thrown" = null;
    let fromGrip = false;
    let startX = 0;
    let startY = 0;
    let dy = 0;
    let height = 1;
    let samples: { y: number; t: number }[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;

    const paint = (y: number) => {
      p.style.translate = `0 ${y}px`;
      if (shade.current) shade.current.style.opacity = String(Math.max(0, 1 - y / height));
    };
    const follow = dragFollower((_, y) => paint(y));
    const animateTo = (y: number, ms: number, curve: string) => {
      const tr = `${ms}ms ${curve}`;
      p.style.transition = `translate ${tr}`;
      if (shade.current) shade.current.style.transition = `opacity ${tr}`;
      paint(y);
    };

    const onStart = (e: TouchEvent) => {
      if (mode === "thrown") return;
      mode = null;
      if (e.touches.length !== 1) return;
      const target = e.target as Node;
      if (target instanceof Element && target.closest("[data-own-touch]")) return;
      fromGrip = !!grip.current?.contains(target);
      if (!fromGrip && selectingText()) return;
      const b = body.current;
      if (!fromGrip && !(b?.contains(target) && b.scrollTop <= 0)) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      mode = "pending";
    };
    const onMove = (e: TouchEvent) => {
      if (mode !== "pending" && mode !== "drag") return;
      if (!fromGrip && selectingText()) { mode = null; return; }
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
        paint(current);
        follow.start(0, current);
      }
      if (e.cancelable) e.preventDefault();
      dy = Math.max(0, y - startY);
      follow.to(0, dy);
      samples.push({ y, t: e.timeStamp });
      if (samples.length > 8) samples.shift();
    };
    const onEnd = () => {
      if (mode !== "drag") {
        if (mode === "pending") mode = null;
        return;
      }
      // The transitions below start from where the panel was last painted.
      const shown = follow.stop().y;
      // Speed over the last ~80ms of the swipe, in px/ms (down is positive).
      const last = samples[samples.length - 1];
      const first = samples.find((s) => last && s.t >= last.t - 80);
      const v = first && last && last.t > first.t ? (last.y - first.y) / (last.t - first.t) : 0;
      if (dy > height / 3 || (v > 0.45 && dy > 16)) {
        mode = "thrown";
        // Leave at the finger's speed: an ease-out curve starts at ~2x its average
        // speed, so the duration that matches the release speed is 2 * distance / v.
        const distance = height + 24 - shown; // + the shadow
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
      follow.stop();
      p.removeEventListener("touchstart", onStart);
      p.removeEventListener("touchmove", onMove);
      p.removeEventListener("touchend", onEnd);
      p.removeEventListener("touchcancel", onEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
}
