"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Word } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { EXAMPLE_STYLES, getExampleSource, getExampleStyle, getLevel, type ExampleStyle } from "@/lib/learnPrefs";
import { useEnsureLevel } from "@/lib/useEnsureLevel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/Select";
import { LangSelect } from "@/components/LangSelect";
import { cn } from "@/lib/utils";

const csv = (a: string[]) => a.join(", ");
const parse = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

// Multi-line field styling (matches Input, but wraps so long examples/notes are
// fully visible and editable instead of being clipped in a one-line box).
// `field-sizing:content` auto-grows the box to fit the text, so the whole example
// is visible by default (no manual dragging); resize-y still allows manual tweak.
const taClass =
  "w-full resize-y rounded-[14px] border border-black/[0.08] bg-surface px-4 py-2.5 text-[16px] leading-relaxed text-ink placeholder:text-[#b3aa9a] focus:border-sage focus:outline-none sm:text-[15px] [field-sizing:content] min-h-[46px]";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
      {children}
    </label>
  );
}

type ExRow = { id?: string; sentenceEn: string; sentenceZh: string; sourceName: string };

const toRows = (word: Word): ExRow[] =>
  word.examples.map((e) => ({ id: e.id, sentenceEn: e.sentenceEn, sentenceZh: e.sentenceZh, sourceName: e.sourceName }));

export function EditWordForm({
  word,
  onDone,
  onSaved,
}: {
  word: Word;
  onDone: () => void;
  onSaved?: (updated: Word) => void;
}) {
  const qc = useQueryClient();
  const { t } = useI18n();
  const ensureLevel = useEnsureLevel();

  const [w, setW] = useState(word.word);
  const [sourceLang, setSourceLang] = useState(word.sourceLang);
  const [targetLang, setTargetLang] = useState(word.targetLang);
  const [phonetic, setPhonetic] = useState(word.phonetic ?? "");
  const [pos, setPos] = useState(word.partOfSpeech ?? "");
  const [meaning, setMeaning] = useState(word.meaningZh ?? "");
  const [coll, setColl] = useState(csv(word.collocations));
  const [syn, setSyn] = useState(csv(word.synonyms));
  const [ant, setAnt] = useState(csv(word.antonyms));
  const [notes, setNotes] = useState(word.notes ?? "");
  const [examples, setExamples] = useState<ExRow[]>(toRows(word));
  const [exStyle, setExStyle] = useState<ExampleStyle>(getExampleStyle());

  const setEx = (i: number, patch: Partial<ExRow>) =>
    setExamples((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeEx = (i: number) => setExamples((rows) => rows.filter((_, idx) => idx !== i));
  const addBlankEx = () => setExamples((rows) => [...rows, { sentenceEn: "", sentenceZh: "", sourceName: "" }]);

  // Fetch a fresh AI example. `replace` clears existing ones (regenerate);
  // otherwise it adds another. Runs immediately (independent of Save).
  const regen = useMutation({
    mutationFn: (replace: boolean) =>
      api.addExample(word.id, { exampleStyle: exStyle, exampleSource: getExampleSource(), level: getLevel(sourceLang) ?? undefined, replace }),
    onSuccess: (updated) => {
      setExamples(toRows(updated));
      qc.invalidateQueries({ queryKey: ["word", word.id] });
      qc.invalidateQueries({ queryKey: ["words"] });
      onSaved?.(updated);
    },
  });

  const save = useMutation({
    mutationFn: () =>
      api.updateWord(word.id, {
        word: w.trim(),
        sourceLang,
        targetLang,
        phonetic: phonetic.trim() || undefined,
        partOfSpeech: pos.trim() || undefined,
        meaningZh: meaning.trim() || undefined,
        collocations: parse(coll),
        synonyms: parse(syn),
        antonyms: parse(ant),
        notes: notes.trim() ? notes.trim() : null,
        examples: examples
          .filter((e) => e.sentenceEn.trim())
          .map((e) => ({ id: e.id, sentenceEn: e.sentenceEn.trim(), sentenceZh: e.sentenceZh.trim(), sourceName: e.sourceName.trim() })),
      }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["word", word.id] });
      qc.invalidateQueries({ queryKey: ["words"] });
      onSaved?.(updated);
      onDone();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (w.trim()) save.mutate();
      }}
      className="space-y-3 rounded-[18px] border border-black/[0.06] bg-surface p-5"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t("edit.word")}>
          <Input value={w} onChange={(e) => setW(e.target.value)} className="w-48" />
        </Field>
        <Field label={t("edit.from")}>
          <LangSelect value={sourceLang} onChange={setSourceLang} />
        </Field>
        <Field label={t("edit.to")}>
          <LangSelect value={targetLang} onChange={setTargetLang} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("edit.phonetic")}><Input value={phonetic} onChange={(e) => setPhonetic(e.target.value)} /></Field>
        <Field label={t("edit.pos")}><Input value={pos} onChange={(e) => setPos(e.target.value)} /></Field>
      </div>
      <Field label={t("edit.meaning")}><Input value={meaning} onChange={(e) => setMeaning(e.target.value)} /></Field>
      <Field label={t("edit.notes")}>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t("edit.notesPlaceholder")}
          rows={2}
          className={taClass}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("edit.collocations")}><Input value={coll} onChange={(e) => setColl(e.target.value)} /></Field>
        <Field label={t("edit.synonyms")}><Input value={syn} onChange={(e) => setSyn(e.target.value)} /></Field>
        <Field label={t("edit.antonyms")}><Input value={ant} onChange={(e) => setAnt(e.target.value)} /></Field>
      </div>
      {/* Examples — edit any of them, delete, or add a blank one */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {t("edit.examples")} {examples.length > 0 && <span className="text-ink-faint/70">({examples.length})</span>}
          </span>
          <button type="button" onClick={addBlankEx} className="text-sm font-semibold text-sage hover:text-sage-deep">
            + {t("edit.addBlank")}
          </button>
        </div>
        {examples.length === 0 && (
          <p className="rounded-[12px] border border-dashed border-black/[0.1] bg-paper/40 p-3 text-center text-sm text-ink-faint">
            {t("edit.noExamples")}
          </p>
        )}
        {examples.map((e, i) => (
          <div key={e.id ?? `new-${i}`} className="space-y-2 rounded-[14px] border border-black/[0.06] bg-paper/40 p-3">
            <div className="flex items-start gap-2">
              <textarea
                value={e.sentenceEn}
                onChange={(ev) => setEx(i, { sentenceEn: ev.target.value })}
                placeholder={t("edit.example")}
                rows={2}
                className={cn(taClass, "flex-1")}
              />
              <button
                type="button"
                onClick={() => removeEx(i)}
                aria-label={t("common.delete")}
                className="mt-1 shrink-0 rounded-lg px-2 py-1 text-ink-faint transition-colors hover:bg-black/[0.04] hover:text-warn-text"
              >
                ✕
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <textarea
                value={e.sentenceZh}
                onChange={(ev) => setEx(i, { sentenceZh: ev.target.value })}
                placeholder={t("edit.exampleTr")}
                rows={2}
                className={taClass}
              />
              <Input value={e.sourceName} onChange={(ev) => setEx(i, { sourceName: ev.target.value })} placeholder={t("edit.source")} />
            </div>
          </div>
        ))}
      </div>

      {/* AI example tools — fetch a new sentence in the chosen register */}
      <div className="flex flex-wrap items-center gap-2 rounded-[14px] border border-black/[0.06] bg-paper/50 p-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("edit.aiExample")}</span>
        <Select
          value={exStyle}
          onChange={(v) => setExStyle(v as ExampleStyle)}
          ariaLabel={t("style.label")}
          className="w-[150px]"
          options={EXAMPLE_STYLES.map((s) => ({ value: s, label: t(`style.${s}`), hint: t(`style.hint.${s}`) }))}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={regen.isPending}
          onClick={async () => {
            const { ok } = await ensureLevel(sourceLang);
            if (ok) regen.mutate(true);
          }}
        >
          {regen.isPending ? t("edit.fetching") : `🔄 ${t("edit.regenerate")}`}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={regen.isPending}
          onClick={async () => {
            const { ok } = await ensureLevel(sourceLang);
            if (ok) regen.mutate(false);
          }}
        >
          + {t("edit.addExample")}
        </Button>
        {regen.isError && <span className="text-sm text-warn-text">{(regen.error as Error).message}</span>}
      </div>

      {save.isError && <p className="text-sm text-warn-text">{(save.error as Error).message}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending || !w.trim()}>
          {save.isPending ? t("add.saving") : t("edit.saveChanges")}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
