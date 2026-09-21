"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Lets a dialog/sheet play its exit animation before it unmounts.
 *
 * Without this every overlay in the app simply vanished on close, which is the
 * part that reads as unfinished — the panel arrives with motion and then blinks
 * out. Components render `data-closing={closing || undefined}` on the scrim and
 * the panel (globals.css has the matching exit keyframes) and call `close()`
 * wherever they used to call `onClose()` directly.
 *
 * `open` is the caller's own visibility flag; it resets the hook when the same
 * overlay is opened again without unmounting in between. Pass `true` from a
 * component the parent mounts and unmounts.
 */
export function useClosing(open: boolean, onClose: () => void, ms = 170) {
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cb = useRef(onClose);
  cb.current = onClose;

  useEffect(() => {
    if (open) {
      setClosing(false);
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    }
  }, [open]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const close = useCallback(() => {
    if (timer.current) return; // already leaving — don't restart the timer
    if (prefersReducedMotion()) {
      cb.current();
      return;
    }
    setClosing(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      cb.current();
    }, ms);
  }, [ms]);

  return { closing, close };
}

/**
 * Keeps a menu/popover mounted for a moment after `open` turns false, so it can
 * play its exit instead of disappearing. Render while `mounted`, and put
 * `data-closing={closing || undefined}` on its root. Unlike useClosing, nothing
 * about how the caller closes it changes — every existing setOpen(false) path
 * (outside click, Esc, picking an option) gets the exit for free.
 */
export function usePresence(open: boolean, ms = 130) {
  const [prev, setPrev] = useState(open);
  const [lingering, setLingering] = useState(false);
  // Derived during render, not in an effect: an effect would commit one frame
  // with the menu unmounted before bringing it back to animate out.
  if (prev !== open) {
    setPrev(open);
    setLingering(!open && !prefersReducedMotion());
  }
  useEffect(() => {
    if (!lingering) return;
    const id = setTimeout(() => setLingering(false), ms);
    return () => clearTimeout(id);
  }, [lingering, ms]);
  return { mounted: open || lingering, closing: !open && lingering };
}
