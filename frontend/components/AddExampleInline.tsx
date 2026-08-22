"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, type Word } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import {
  CEFR_LEVELS,
  EXAMPLE_STYLES,
  LEVEL_HINT,
  getExampleStyle,
  getExampleSource,
  getLevel,
  type CefrLevel,
  type ExampleStyle,
} from "@/lib/learnPrefs";
import { langLabel } from "@/lib/langs";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/Select";
import { cn } from "@/lib/utils";
import { Plus, Sparkles, Globe, X } from "lucide-react";

// A little "+ add example" affordance under a card's examples: type one in (with
// its translation) or have the AI compose a fresh one and append it. The AI path
// exposes the same register/level/source knobs as the add-word form, seeded from
// the saved defaults but tweakable per-example here.
export function AddExampleInline({ word }: { word: Word }) {
  const { t } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [en, setEn] = useState("");
  const [tr, setTr] = useState("");
  const [busy, setBusy] = useState(false);

  // AI-example knobs (local: tweaking here doesn't change the add-word default).
  const [src, setSrc] = useState<"ai" | "web">(() => getExampleSource());
  const [style, setStyle] = useState<ExampleStyle>(() => {
    const s = getExampleStyle();
    return s === "none" ? "casual" : s;
  });
  const [level, setLevelState] = useState<CefrLevel | "">(() => getLevel(word.sourceLang) ?? "");

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
        exampleStyle: style,
        exampleSource: src,
        level: level || undefined,
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
    <div className="space-y-3 rounded-[18px] border border-black/[0.08] bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("word.addExampleBtn")}</span>
        <button type="button" onClick={() => setOpen(false)} aria-label={t("common.cancel")} className="rounded-md p-1 text-ink-faint hover:text-ink">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* manual entry */}
      <Input value={en} onChange={(e) => setEn(e.target.value)} placeholder={t("add.examplePlaceholder", { lang: langLabel(word.sourceLang) })} autoFocus />
      <Input value={tr} onChange={(e) => setTr(e.target.value)} placeholder={t("add.exampleTrPlaceholder", { lang: langLabel(word.targetLang) })} />
      <button
        type="button"
        onClick={saveManual}
        disabled={busy || !en.trim()}
        className="rounded-full bg-sage px-4 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-sage-deep disabled:opacity-50"
      >
        {t("common.save")}
      </button>

      {/* divider */}
      <div className="flex items-center gap-2 pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
        <span className="h-px flex-1 bg-black/[0.07]" />
        {t("word.aiExample")}
        <span className="h-px flex-1 bg-black/[0.07]" />
      </div>

      {/* AI knobs: source · register (AI only) · level */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full bg-black/[0.05] p-0.5 text-xs font-semibold">
          {([
            ["ai", Sparkles],
            ["web", Globe],
          ] as const).map(([m, Icon]) => (
            <button
              key={m}
              type="button"
              onClick={() => setSrc(m)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1 transition-colors",
                src === m ? "bg-sage text-white" : "text-ink-muted hover:text-ink",
              )}
            >
              <Icon className="h-3.5 w-3.5" /> {t(`exmode.${m}`)}
            </button>
          ))}
        </div>
        {src === "ai" && (
          <Select
            value={style}
            onChange={(v) => setStyle(v as ExampleStyle)}
            ariaLabel={t("style.label")}
            className="w-[144px]"
            options={EXAMPLE_STYLES.filter((s) => s !== "none").map((s) => ({ value: s, label: t(`style.${s}`), hint: t(`style.hint.${s}`) }))}
          />
        )}
        <Select
          value={level}
          onChange={(v) => setLevelState(v as CefrLevel)}
          ariaLabel={t("level.title")}
          placeholder={t("level.pick")}
          className="w-[128px]"
          options={CEFR_LEVELS.map((l) => ({ value: l, label: l, hint: LEVEL_HINT[l] }))}
        />
      </div>

      <button
        type="button"
        onClick={genAi}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-full border border-sage/50 bg-sage-tint/40 px-3.5 py-1.5 text-[13px] font-semibold text-sage-deep transition-colors hover:bg-sage-tint disabled:opacity-50"
      >
        <Sparkles className="h-3.5 w-3.5" /> {busy ? t("edit.fetching") : t("word.aiExample")}
      </button>
    </div>
  );
}
