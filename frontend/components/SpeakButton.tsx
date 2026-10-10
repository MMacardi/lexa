"use client";

import { useEffect, useState } from "react";
import { canSpeak, speak } from "@/lib/speak";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { langLabel } from "@/lib/langs";
import { HoverTip } from "@/components/ui/HoverTip";
import { cn } from "@/lib/utils";
import { Volume2 } from "lucide-react";

// 🔊 pronunciation button. Renders nothing if the browser has no speech engine;
// says so when the device has no voice for the language.
export function SpeakButton({
  text,
  lang = "en",
  size = "md",
  className,
}: {
  text: string;
  lang?: string;
  // "inline": a bare icon in running text (the Reader's play after each sentence).
  size?: "inline" | "sm" | "md";
  className?: string;
}) {
  const { t } = useI18n();
  const { show } = useToast();
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(canSpeak()), []);
  if (!ok) return null;

  const frame = "border border-black/[0.08] bg-surface text-sage-deep hover:bg-sage-tint";
  const dim =
    size === "inline"
      ? "h-6 w-6 text-[14px] text-ink-faint hover:bg-sage-tint/60 hover:text-sage-deep"
      : size === "sm"
        ? cn("h-7 w-7 text-[13px]", frame)
        : cn("h-9 w-9 text-[16px]", frame);
  const label = t("speak.play");
  return (
    <HoverTip title={label} className={cn("inline-flex shrink-0", size === "inline" && "mx-0.5 align-[-0.3em]", className)}>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!speak(text, lang)) show({ icon: "🔇", title: t("speak.noVoice", { lang: langLabel(lang) }) });
        }}
        aria-label={label}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full transition-colors active:scale-95",
          dim,
        )}
      >
        <Volume2 className="h-[1em] w-[1em]" />
      </button>
    </HoverTip>
  );
}
