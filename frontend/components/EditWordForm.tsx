"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Word } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LangSelect } from "@/components/LangSelect";

const csv = (a: string[]) => a.join(", ");
const parse = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{label}</span>
      {children}
    </label>
  );
}

export function EditWordForm({ word, onDone }: { word: Word; onDone: () => void }) {
  const qc = useQueryClient();
  const ex = word.examples[0];

  const [w, setW] = useState(word.word);
  const [sourceLang, setSourceLang] = useState(word.sourceLang);
  const [targetLang, setTargetLang] = useState(word.targetLang);
  const [phonetic, setPhonetic] = useState(word.phonetic ?? "");
  const [pos, setPos] = useState(word.partOfSpeech ?? "");
  const [meaning, setMeaning] = useState(word.meaningZh ?? "");
  const [coll, setColl] = useState(csv(word.collocations));
  const [syn, setSyn] = useState(csv(word.synonyms));
  const [ant, setAnt] = useState(csv(word.antonyms));
  const [exEn, setExEn] = useState(ex?.sentenceEn ?? "");
  const [exZh, setExZh] = useState(ex?.sentenceZh ?? "");
  const [src, setSrc] = useState(ex?.sourceName ?? "");

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
        example: exEn.trim()
          ? { sentenceEn: exEn.trim(), sentenceZh: exZh.trim(), sourceName: src.trim() }
          : undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["word", word.id] });
      qc.invalidateQueries({ queryKey: ["words"] });
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
        <Field label="Word">
          <Input value={w} onChange={(e) => setW(e.target.value)} className="w-48" />
        </Field>
        <Field label="From">
          <LangSelect value={sourceLang} onChange={setSourceLang} />
        </Field>
        <Field label="To">
          <LangSelect value={targetLang} onChange={setTargetLang} />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Phonetic"><Input value={phonetic} onChange={(e) => setPhonetic(e.target.value)} /></Field>
        <Field label="Part of speech"><Input value={pos} onChange={(e) => setPos(e.target.value)} /></Field>
      </div>
      <Field label="Meaning"><Input value={meaning} onChange={(e) => setMeaning(e.target.value)} /></Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Collocations (comma)"><Input value={coll} onChange={(e) => setColl(e.target.value)} /></Field>
        <Field label="Synonyms (comma)"><Input value={syn} onChange={(e) => setSyn(e.target.value)} /></Field>
        <Field label="Antonyms (comma)"><Input value={ant} onChange={(e) => setAnt(e.target.value)} /></Field>
      </div>
      <Field label="Example"><Input value={exEn} onChange={(e) => setExEn(e.target.value)} /></Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Example translation"><Input value={exZh} onChange={(e) => setExZh(e.target.value)} /></Field>
        <Field label="Source"><Input value={src} onChange={(e) => setSrc(e.target.value)} /></Field>
      </div>

      {save.isError && <p className="text-sm text-warn-text">{(save.error as Error).message}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={save.isPending || !w.trim()}>
          {save.isPending ? "Saving…" : "Save changes"}
        </Button>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
