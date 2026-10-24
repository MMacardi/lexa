"use client";

import { useLayoutEffect, type RefObject } from "react";

// Safari pans the layout viewport while its keyboard moves. Compensate for that
// pan immediately: easing offsetTop again lets the header leave the screen.
// Chat uses measured geometry, including on blur, rather than the general
// dialog's predicted keyboard-close position and CSS transition.
export function useChatViewport(ref: RefObject<HTMLElement | null>, on: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!on || !el || !vv) return;
    let raf = 0;
    let until = 0;
    const sync = () => {
      const keyboard = Math.max(innerHeight, document.documentElement.clientHeight) - vv.height * vv.scale > 150;
      const values = {
        "--vv-top": `${vv.offsetTop}px`,
        "--vv-h": `${vv.height}px`,
        "--safe-bottom": keyboard ? "0px" : "env(safe-area-inset-bottom, 0px)",
      };
      for (const [name, value] of Object.entries(values)) {
        if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
      }
      if (el.hasAttribute("data-chat-keyboard") !== keyboard) el.toggleAttribute("data-chat-keyboard", keyboard);
    };
    const tick = () => {
      sync();
      raf = performance.now() < until ? requestAnimationFrame(tick) : 0;
    };
    const settle = () => {
      sync();
      // Safari can finish its pan without delivering another viewport event.
      until = performance.now() + 700;
      if (!raf) raf = requestAnimationFrame(tick);
    };
    sync();
    vv.addEventListener("resize", settle);
    vv.addEventListener("scroll", settle);
    window.addEventListener("resize", settle);
    window.addEventListener("focusin", settle);
    window.addEventListener("focusout", settle);
    return () => {
      cancelAnimationFrame(raf);
      vv.removeEventListener("resize", settle);
      vv.removeEventListener("scroll", settle);
      window.removeEventListener("resize", settle);
      window.removeEventListener("focusin", settle);
      window.removeEventListener("focusout", settle);
      for (const name of ["--vv-top", "--vv-h", "--safe-bottom"]) el.style.removeProperty(name);
      el.removeAttribute("data-chat-keyboard");
    };
  }, [ref, on]);
}
