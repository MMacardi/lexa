"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type Word } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { getExampleStyle, getExampleSource, getLevel } from "@/lib/learnPrefs";
import { langLabel } from "@/lib/langs";
import { Input } from "@/components/ui/input";
import { Plus, Sparkles, X } from "lucide-react";

// A little "+ add example" affordance under a card's examples: type one in (with
// its translation) or have the AI compose a fresh one and append it.
export function AddExampleInline({ word }: { word: Word }) {
  const { t } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [en, setEn] = useState("");
  const [tr, setTr] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["word", word.id] });
    qc.invalidateQueries({ queryKey: ["words"] });
  };

  async function saveManual() {
    if (!en.trim() || busy) return;
    setBusy(true);
    try {
      await api.addManualExample(word.id, en.trim(), tr.trim());
      show({ icon: "🌱", title: t("word.exampleAdded") });
      setEn("");
      setTr("");
      setOpen(false);
      refresh();
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  async function genAi() {
    if (busy) return;
    setBusy(true);
    try {
      await api.addExample(word.id, {
        exampleStyle: getExampleStyle(),
        exampleSource: getExampleSource(),
        level: getLevel(word.sourceLang) ?? undefined,
      });
      show({ icon: "🌱", title: t("word.exampleAdded") });
      setOpen(false);
      refresh();
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-black/[0.14] px-3.5 py-2 text-[13px] font-semibold text-ink-muted transition-colors hover:border-sage/60 hover:text-sage-deep"
      >
        <Plus className="h-4 w-4" /> {t("word.addExampleBtn")}
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-[18px] border border-black/[0.08] bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("word.addExampleBtn")}</span>
        <button type="button" onClick={() => setOpen(false)} aria-label={t("common.cancel")} className="rounded-md p-1 text-ink-faint hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>
      <Input value={en} onChange={(e) => setEn(e.target.value)} placeholder={t("add.examplePlaceholder", { lang: langLabel(word.sourceLang) })} autoFocus />
      <Input value={tr} onChange={(e) => setTr(e.target.value)} placeholder={t("add.exampleTrPlaceholder", { lang: langLabel(word.targetLang) })} />
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <button
          type="button"
          onClick={saveManual}
          disabled={busy || !en.trim()}
          className="rounded-full bg-sage px-4 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-sage-deep disabled:opacity-50"
        >
          {t("common.save")}
        </button>
        <button
          type="button"
          onClick={genAi}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-full border border-sage/50 bg-sage-tint/40 px-3.5 py-1.5 text-[13px] font-semibold text-sage-deep transition-colors hover:bg-sage-tint disabled:opacity-50"
        >
          <Sparkles className="h-3.5 w-3.5" /> {busy ? t("edit.fetching") : t("word.aiExample")}
        </button>
      </div>
    </div>
  );
}
