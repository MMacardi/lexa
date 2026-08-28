"use client";

import { useEffect, useState } from "react";
import { canSpeak, speak } from "@/lib/speak";
import { useI18n } from "@/lib/i18n";
import { HoverTip } from "@/components/ui/HoverTip";
import { cn } from "@/lib/utils";
import { Volume2 } from "lucide-react";

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
  const { t } = useI18n();
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(canSpeak()), []);
  if (!ok) return null;

  const dim = size === "sm" ? "h-7 w-7 text-[13px]" : "h-9 w-9 text-[16px]";
  const label = t("speak.play");
  return (
    <HoverTip title={label} className={cn("inline-flex shrink-0", className)}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          speak(text, lang);
        }}
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full border border-black/[0.08] bg-surface text-sage-deep transition-colors hover:bg-sage-tint active:scale-95",
          dim,
        )}
      >
        <Volume2 className="h-[1em] w-[1em]" />
      </button>
    </HoverTip>
  );
}
