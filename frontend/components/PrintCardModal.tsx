"use client";

import { useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import type { Word } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { X } from "lucide-react";
import {
  CARD_FIELDS,
  CARD_PRESETS,
  setCardLayout,
  useCardLayout,
  type CardField,
  type CardLayout,
} from "@/lib/learnPrefs";
import { renderPrintableCard, downloadDataUrl } from "@/lib/shareCard";
import { cn } from "@/lib/utils";
import { useClosing } from "@/lib/motion";
import { Segmented } from "@/components/ui/Segmented";

function presetIdOf(layout: CardLayout): string {
  const eq = (a: CardField[], b: CardField[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  return CARD_PRESETS.find((p) => eq(p.front, layout.front) && eq(p.back, layout.back))?.id ?? "custom";
}

// Print/share a card as a two-face PNG. Reuses the same front/back layout the
// flashcards use, so choosing here also tunes review (kept consistent on purpose).
export function PrintCardModal({ word, onClose }: { word: Word; onClose: () => void }) {
  const { t } = useI18n();
  const layout = useCardLayout();
  const activePreset = presetIdOf(layout);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const labels = useMemo(
    () => ({
      front: t("layout.front"),
      back: t("layout.back"),
      synonyms: t("field.synonyms"),
      antonyms: t("field.antonyms"),
      collocations: t("field.collocations"),
    }),
    [t],
  );

  const preview = useMemo(() => renderPrintableCard(word, layout, labels), [word, layout, labels]);
  const { closing, close } = useClosing(true, onClose);

  const toggleField = (side: "front" | "back", f: CardField) => {
    const cur = layout[side];
    const next = cur.includes(f) ? cur.filter((x) => x !== f) : [...cur, f];
    if (next.length === 0) return;
    setCardLayout({ ...layout, [side]: next });
  };

  return createPortal(
    <div
      data-closing={closing || undefined}
      className="anim-scrim vv-overlay z-[90] flex items-center justify-center bg-black/40 p-4"
      onClick={close}
    >
      <div
        data-closing={closing || undefined}
        className="anim-pop flex max-h-[94vh] w-full max-w-[520px] flex-col overflow-hidden rounded-[22px] border border-black/[0.08] bg-surface p-4 shadow-[0_24px_60px_rgba(46,42,38,0.34)] sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-serif text-[19px] font-medium text-ink">{t("print.title")}</h2>
          <button type="button" onClick={close} aria-label={t("common.cancel")} className="rounded-lg p-1.5 text-ink-faint hover:bg-black/[0.05] hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* preview */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview} alt="card preview" className="mb-3 max-h-[38vh] w-full rounded-[14px] border border-black/[0.06] object-contain" />

        {/* presets */}
        <Segmented
          className="mb-2 w-fit"
          scroll
          size="sm"
          value={activePreset}
          onChange={(id) => {
            const p = CARD_PRESETS.find((c) => c.id === id);
            if (p) setCardLayout({ front: p.front, back: p.back });
          }}
          options={[
            ...CARD_PRESETS.map((p) => ({ value: p.id, label: t(`layout.${p.id}`) })),
            // "Custom" isn't a preset you can pick — it appears, and takes the
            // pill, once the field toggles below no longer match one.
            ...(activePreset === "custom" ? [{ value: "custom", label: t("layout.custom") }] : []),
          ]}
        />

        {/* per-side field toggles */}
        <div className="space-y-1.5 overflow-y-auto">
          {(["front", "back"] as const).map((side) => (
            <div key={side} className="flex flex-wrap items-center gap-1.5">
              <span className="w-11 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t(`layout.${side}`)}</span>
              {CARD_FIELDS.map((f) => {
                const on = layout[side].includes(f);
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => toggleField(side, f)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-[12px] font-medium transition-colors",
                      on ? "border-sage bg-sage-tint text-sage-deep" : "border-black/[0.08] bg-surface text-ink-faint hover:border-sage/60",
                    )}
                  >
                    {t(`field.${f}`)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => downloadDataUrl(preview, `onomika-${word.word}.png`)}
          className="mt-3 w-full shrink-0 rounded-full bg-sage px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sage-deep"
        >
          ↓ {t("print.download")}
        </button>
      </div>
    </div>,
    document.body,
  );
}
