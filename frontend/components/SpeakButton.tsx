"use client";

import { useEffect, useState } from "react";
import { canSpeak, speak } from "@/lib/speak";
import { cn } from "@/lib/utils";

// 🔊 pronunciation button. Renders nothing if the browser has no speech engine.
export function SpeakButton({
  text,
  lang = "en",
  size = "md",
  className,
}: {
  text: string;
  lang?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(canSpeak()), []);
  if (!ok) return null;

  const dim = size === "sm" ? "h-7 w-7 text-[13px]" : "h-9 w-9 text-[16px]";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        speak(text, lang);
      }}
      aria-label="Play pronunciation"
      title="Play pronunciation"
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full border border-black/[0.08] bg-surface text-sage-deep transition-colors hover:bg-sage-tint active:scale-95",
        dim,
        className,
      )}
    >
      🔊
    </button>
  );
}
