"use client";

import { useEffect, useState } from "react";

// Tiny localStorage-backed boolean (no provider needed). Used for the review /
// quiz "flip direction" toggle (show target side first instead of source).
export function useFlip(key: string) {
  const [flip, setFlipState] = useState(false);

  useEffect(() => {
    const v = localStorage.getItem(key);
    if (v) setFlipState(v === "1");
  }, [key]);

  function setFlip(v: boolean) {
    localStorage.setItem(key, v ? "1" : "0");
    setFlipState(v);
  }

  return [flip, setFlip] as const;
}
