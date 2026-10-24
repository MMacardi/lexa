"use client";

import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { useKeepBottom } from "./mobileNav";

/**
 * A chat's scroller, kept the way a messenger keeps one (Mika's sheet and page).
 * It opens on the newest line instead of riding down from the top; while the
 * reader is at the bottom, a growing answer stays in view, token by token; once
 * they scroll back to read, it leaves them there — the old "scroll to the end on
 * every change" yanked them down mid-sentence — until they come back down or send
 * something. Through a resize (the keyboard, the composer growing) the bottom
 * edge holds (useKeepBottom). `away` = far enough back to offer the way down.
 * `on` = the scroller is mounted (a sheet that is open); `busy` = Mika is answering
 * (her typing dots come before the first word).
 */
export function useChatScroll(ref: RefObject<HTMLElement | null>, messages: { role: string }[], on = true, busy = false) {
  const [away, setAway] = useState(false);
  const pinned = useRef(true);
  const opened = useRef(false);
  const count = useRef(messages.length);
  // Suggestions read from the top; only a conversation anchors its bottom.
  useKeepBottom(ref, on && messages.length > 0, pinned);

  // Ruby readings and images can finish laying out after the message update.
  // Follow that growth only while reading the newest reply; an older passage
  // the learner scrolled to must stay put.
  useEffect(() => {
    const el = ref.current;
    if (!on || !el || !messages.length) return;
    const ro = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    for (const child of el.children) ro.observe(child);
    return () => ro.disconnect();
  }, [ref, on, messages.length]);

  // Only the reader's own scrolling unpins: a finger or a wheel, and the momentum
  // a flick leaves behind. The scrolls made here keep the pin as it is.
  useEffect(() => {
    const el = ref.current;
    if (!on || !el) return;
    let touching = false;
    let lastGesture = -Infinity;
    const onTouchStart = () => {
      touching = true;
    };
    const onTouchEnd = () => {
      touching = false;
      lastGesture = performance.now();
    };
    const onWheel = () => {
      lastGesture = performance.now();
    };
    const onScroll = () => {
      const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
      if (touching || performance.now() - lastGesture < 1500) pinned.current = gap < 80;
      setAway(gap > 240);
    };
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", onScroll);
    };
  }, [ref, on]);

  // Before paint, so a new line never shows a frame below the fold first.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!on || !el) {
      opened.current = false;
      return;
    }
    const grew = messages.length > count.current;
    count.current = messages.length;
    // The welcome screen (no messages) reads from its top.
    if (!messages.length) {
      el.scrollTop = 0;
      pinned.current = true;
      opened.current = true;
      return;
    }
    if (!opened.current) {
      opened.current = true;
      pinned.current = true;
      el.scrollTop = el.scrollHeight;
      return;
    }
    // Something they just sent brings them down to it, wherever they were.
    if (grew && messages[messages.length - 1]?.role === "user") {
      pinned.current = true;
      el.scrollTop = el.scrollHeight;
    } else if (pinned.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, busy, on, ref]);

  const toLatest = () => {
    const el = ref.current;
    if (!el) return;
    pinned.current = true;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  };
  return { away, toLatest };
}
