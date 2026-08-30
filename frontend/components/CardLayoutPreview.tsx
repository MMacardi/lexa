"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { CardField, CardLayout } from "@/lib/learnPrefs";
import { Eye, Pin, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { HoverTip } from "@/components/ui/HoverTip";

// A hover-preview of how the flashcard will look with the current front/back
// layout, using a sample English word translated into the interface language.
// It auto-flips (toggleable), can be flipped by hand, and can be pinned so it
// stays open while the learner keeps tweaking the layout.

type Sample = Record<CardField, React.ReactNode>;

function sampleWord(locale: string): Sample {
  const ru = locale === "ru";
  const zh = locale === "zh";
  const meaning = ru ? "устойчивый, стойкий" : zh ? "有韧性的，坚强的" : "quick to recover";
  const exampleTr = ru
    ? "Город оказался удивительно стойким после наводнения."
    : zh
      ? "洪水过后，这座城市展现出惊人的韧性。"
      : "The city bounced back fast after the flood.";
  return {
    word: "resilient",
    phonetic: "/rɪˈzɪl.i.ənt/",
    pos: ru ? "прил." : zh ? "形容词" : "adj.",
    meaning,
    example: "The city proved remarkably resilient after the flood.",
    exampleTr,
    synonyms: "tough, hardy",
    antonyms: "fragile",
    collocations: "resilient economy",
    notes: ru ? "от re- + salire («прыгать»)" : zh ? "词根：跳回" : "root: to jump back",
  };
}

function FieldView({ field, w, primary, t }: { field: CardField; w: Sample; primary: boolean; t: (k: string) => string }) {
  const v = w[field];
  switch (field) {
    case "word":
      return <div className={cn("font-serif font-semibold leading-tight text-ink", primary ? "text-[24px]" : "text-[17px]")}>{v}</div>;
    case "phonetic":
      return <div className="text-[12px] text-ink-faint">{v}</div>;
    case "pos":
      return <span className="rounded-full bg-black/[0.05] px-2 py-0.5 text-[11px] font-medium text-ink-muted">{v}</span>;
    case "meaning":
      return <div className="text-[15px] font-medium text-sage-deep">{v}</div>;
    case "example":
      return <div className="font-serif text-[13px] italic leading-snug text-quote">“{v}”</div>;
    case "exampleTr":
      return <div className="text-[12px] leading-snug text-ink-soft">{v}</div>;
    default:
      return (
        <div className="text-[12px] leading-snug text-ink-soft">
          <span className="font-semibold text-ink-muted">{t(`field.${field}`)}:</span> {v}
        </div>
      );
  }
}

function Face({ fields, w, t, back }: { fields: CardField[]; w: Sample; t: (k: string) => string; back?: boolean }) {
  return (
    <div className={cn("flip-face flex min-h-[150px] flex-col items-center justify-center gap-1.5 rounded-[14px] border p-4 text-center", back ? "flip-back border-sage/25 bg-sage-tint/25" : "border-black/[0.06] bg-paper")}>
      {fields.length === 0 ? <span className="text-[12px] text-ink-faint">—</span> : fields.map((f) => <FieldView key={f} field={f} w={w} primary={f === fields[0]} t={t} />)}
    </div>
  );
}

export function CardLayoutPreview({ layout }: { layout: CardLayout }) {
  const { t, locale } = useI18n();
  const w = sampleWord(locale);
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [auto, setAuto] = useState(true);
  const open = hover || pinned;

  useEffect(() => {
    if (!open || !auto) return;
    const id = setInterval(() => setFlipped((f) => !f), 2400);
    return () => clearInterval(id);
  }, [open, auto]);

  return (
    <div className="relative mt-3 inline-block" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <button
        type="button"
        onClick={() => setPinned((p) => !p)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors",
          open ? "border-sage/50 bg-sage-tint/50 text-sage-deep" : "border-black/[0.1] text-ink-muted hover:border-sage/50 hover:text-sage-deep",
        )}
      >
        <Eye className="h-3.5 w-3.5" /> {t("preview.want")}
      </button>

      {open && (
        <div className="anim-popover absolute left-0 top-full z-30 mt-2 w-[264px] rounded-[18px] border border-black/[0.08] bg-surface p-3 shadow-[0_20px_50px_rgba(46,42,38,0.2)] sm:left-full sm:top-0 sm:ml-3 sm:mt-0">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("preview.title")}</span>
            <HoverTip title={t("preview.pin")} className="inline-flex">
              <button
                type="button"
                onClick={() => setPinned((p) => !p)}
                aria-label={t("preview.pin")}
                className={cn("rounded-full p-1 transition-colors", pinned ? "bg-sage-tint text-sage-deep" : "text-ink-faint hover:text-ink")}
              >
                <Pin className="h-3.5 w-3.5" />
              </button>
            </HoverTip>
          </div>

          <div className="flip-scene cursor-pointer" onClick={() => setFlipped((f) => !f)}>
            <div className={cn("flip-card", flipped && "is-flipped")}>
              <Face fields={layout.front} w={w} t={t} />
              <Face fields={layout.back} w={w} t={t} back />
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-between">
            <button type="button" onClick={() => setFlipped((f) => !f)} className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-muted hover:text-sage-deep">
              <RotateCw className="h-3.5 w-3.5" /> {t("preview.flip")}
            </button>
            <button
              type="button"
              onClick={() => setAuto((a) => !a)}
              className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold transition-colors", auto ? "bg-sage text-white" : "bg-black/[0.05] text-ink-muted")}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", auto ? "bg-white" : "bg-ink-faint")} /> {t("preview.auto")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
