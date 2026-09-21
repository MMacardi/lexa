"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import type { CardField, CardLayout } from "@/lib/learnPrefs";
import { Eye, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePresence } from "@/lib/motion";

// An inline preview of how the flashcard will look with the current front/back
// layout, using a sample English word translated into the interface language.
// The button toggles it open/closed (in the page flow, so it never spills out of
// its container); it auto-flips (toggleable) and can be flipped by hand.

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
  const [open, setOpen] = useState(false);
  const menu = usePresence(open);
  const [flipped, setFlipped] = useState(false);
  const [auto, setAuto] = useState(true);
  // Bumped on every manual flip so the auto interval restarts — otherwise a hand
  // flip right before the next tick gets an auto flip on top of it mid-animation.
  const [flipNonce, setFlipNonce] = useState(0);
  const manualFlip = () => {
    setFlipped((f) => !f);
    setFlipNonce((n) => n + 1);
  };

  useEffect(() => {
    if (!open || !auto) return;
    const id = setInterval(() => setFlipped((f) => !f), 2400);
    return () => clearInterval(id);
  }, [open, auto, flipNonce]);

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors",
          open ? "border-sage/50 bg-sage-tint/50 text-sage-deep" : "border-black/[0.1] text-ink-muted hover:border-sage/50 hover:text-sage-deep",
        )}
      >
        <Eye className="h-3.5 w-3.5" /> {t("preview.want")}
      </button>

      {menu.mounted && (
        <div data-closing={menu.closing || undefined} className="anim-popover mt-2 w-full max-w-[320px] rounded-[18px] border border-black/[0.08] bg-surface p-3 shadow-[0_12px_30px_rgba(46,42,38,0.12)]">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("preview.title")}</p>

          <div className="flip-scene cursor-pointer" onClick={manualFlip}>
            <div className={cn("flip-card", flipped && "is-flipped")}>
              <Face fields={layout.front} w={w} t={t} />
              <Face fields={layout.back} w={w} t={t} back />
            </div>
          </div>

          <div className="mt-2.5 flex items-center justify-between">
            <button type="button" onClick={manualFlip} className="inline-flex items-center gap-1 text-[12px] font-semibold text-ink-muted hover:text-sage-deep">
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
