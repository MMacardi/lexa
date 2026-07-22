"use client";

import { useEffect, useState } from "react";

const COLORS = ["#7c9885", "#3f5a4a", "#c9b8a8", "#c09180", "#e4ebe4", "#a9c6b0"];

// Lightweight, dependency-free confetti burst. Mount it once (e.g. on a
// completion screen) and it rains for ~2.6s then cleans itself up.
export function Confetti({ count = 90 }: { count?: number }) {
  const [on, setOn] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setOn(false), 2800);
    return () => clearTimeout(t);
  }, []);

  if (!on) return null;

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {Array.from({ length: count }).map((_, i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.6;
        const duration = 1.8 + Math.random() * 1.1;
        const color = COLORS[i % COLORS.length];
        const size = 6 + Math.random() * 8;
        return (
          <span
            key={i}
            className="confetti-piece"
            style={{
              left: `${left}vw`,
              width: `${size}px`,
              height: `${size * 1.5}px`,
              background: color,
              animationDelay: `${delay}s`,
              animationDuration: `${duration}s`,
            }}
          />
        );
      })}
    </div>
  );
}
