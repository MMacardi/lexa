"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Word } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { EditWordForm } from "@/components/EditWordForm";

// A portal modal wrapping EditWordForm, so a card can be edited without leaving
// a Study / Quiz session. `onUpdated` fires whenever the word changes (save or
// example regenerate) so the caller can refresh the card it's showing.
export function EditWordModal({
  word,
  onClose,
  onUpdated,
}: {
  word: Word;
  onClose: () => void;
  onUpdated?: (updated: Word) => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="anim-fade-in fixed inset-0 z-[120] flex items-start justify-center overflow-y-auto bg-onyx/45 p-4 backdrop-blur-sm sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="anim-scale-in w-full max-w-2xl">
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="font-serif text-[20px] font-semibold text-white">{t("edit.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          >
            ×
          </button>
        </div>
        <EditWordForm word={word} onDone={onClose} onSaved={onUpdated} />
      </div>
    </div>,
    document.body,
  );
}
