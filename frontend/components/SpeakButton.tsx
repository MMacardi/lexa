"use client";

import { useEffect, useId, useState } from "react";
import { canSpeak, speak, stopSpeech, useSpeechLoading, useSpeechState, useSentenceRate, setSentenceRate } from "@/lib/speak";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { langLabel } from "@/lib/langs";
import { HoverTip } from "@/components/ui/HoverTip";
import { cn } from "@/lib/utils";
import { CircleAlert, Loader2, Square, Volume2 } from "lucide-react";

/** Automatic review/quiz speech needs the same visible failure as manual play. */
export function useSpeechNotice() {
  const { t } = useI18n();
  const { show } = useToast();
  return (lang: string) => show({ icon: "🔇", title: lang === "zh" || lang === "zh-Hant"
    ? t("speak.serverError") : t("speak.noVoice", { lang: langLabel(lang) }) });
}

/** A speaker icon that spins while `text` is being fetched to be spoken (the first play of a new clip). */
export function SpeakingIcon({ text, className }: { text: string; className?: string }) {
  const loading = useSpeechLoading(text);
  return loading ? <Loader2 className={cn(className, "animate-spin")} /> : <Volume2 className={className} />;
}

// 🔊 pronunciation button. Renders nothing if the browser has no speech engine;
// says so when the device has no voice for the language.
export function SpeakButton({
  text,
  lang = "en",
  size = "md",
  className,
  sentence = false,
}: {
  text: string;
  lang?: string;
  // "inline": a bare icon in running text (the Reader's play after each sentence).
  size?: "inline" | "sm" | "md";
  className?: string;
  sentence?: boolean;
}) {
  const { t } = useI18n();
  const notice = useSpeechNotice();
  const [ok, setOk] = useState(false);
  const owner = useId();
  const status = useSpeechState(text, lang);
  const rate = useSentenceRate();
  const active = status === "loading" || status === "playing";
  const failed = status === "error";
  useEffect(() => setOk(canSpeak()), []);
  useEffect(() => () => stopSpeech(owner), [owner, text, lang]);
  if (!ok) return null;

  const frame = "border border-black/[0.08] bg-surface text-sage-deep hover:bg-sage-tint";
  const dim =
    size === "inline"
      ? "h-6 w-6 text-[14px] text-ink-faint hover:bg-sage-tint/60 hover:text-sage-deep"
      : size === "sm"
        ? cn("h-7 w-7 text-[13px]", frame)
        : cn("h-9 w-9 text-[16px]", frame);
  const label = t(active ? "speak.stop" : failed ? "speak.retry" : "speak.play");
  const noVoice = () => notice(lang);
  return (
    // The group shares the final word's baseline and stays on the same line.
    <span data-sentence-audio={sentence ? "" : undefined} data-speech-state={status}
      className={cn("inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap align-baseline leading-none", className)}>
      <HoverTip title={label} className="inline-flex">
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (active) stopSpeech();
            else if (!speak(text, lang, { sentence, owner, onUnavailable: noVoice })) noVoice();
          }}
          aria-label={label}
          aria-busy={status === "loading"}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-full transition-colors active:scale-95",
            dim,
            failed && "text-warn-text",
          )}
        >
          {status === "loading" ? <span className="relative inline-flex h-[1em] w-[1em]">
            <Loader2 className="absolute inset-0 h-full w-full animate-spin" />
            <Square className="m-auto h-[0.4em] w-[0.4em] fill-current" />
          </span> : active ? <Square className="h-[0.8em] w-[0.8em] fill-current" /> : failed ? <CircleAlert className="h-[1em] w-[1em]" /> : <Volume2 className="h-[1em] w-[1em]" />}
        </button>
      </HoverTip>
      {sentence && <button type="button" aria-label={t("speak.speed", { rate: rate === 1 ? "1" : "0.75" })}
        title={t(rate === 1 ? "speak.slower" : "speak.normal")}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setSentenceRate(rate === 1 ? 0.75 : 1); }}
        className="inline-flex h-6 min-w-9 items-center justify-center rounded-full px-1 font-sans text-[11px] font-semibold tabular-nums text-ink-faint transition-colors hover:bg-sage-tint hover:text-sage-deep">
        {rate === 1 ? "1×" : "0.75×"}
      </button>}
    </span>
  );
}
