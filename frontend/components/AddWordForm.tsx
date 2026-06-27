"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { LANGS, langLabel } from "@/lib/langs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Mode = "auto" | "manual";

function LangSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-11 rounded-[14px] border border-black/[0.08] bg-surface px-3 text-[15px] text-ink focus:border-sage focus:outline-none"
    >
      {LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.native}
        </option>
      ))}
    </select>
  );
}

export function AddWordForm() {
  const qc = useQueryClient();
  const { accountId } = useAccount();

  const [mode, setMode] = useState<Mode>("auto");
  const [word, setWord] = useState("");
  const [sourceLang, setSourceLang] = useState("en");
  const [targetLang, setTargetLang] = useState("zh");
  // manual fields
  const [meaning, setMeaning] = useState("");
  const [exEn, setExEn] = useState("");
  const [exZh, setExZh] = useState("");
  const [src, setSrc] = useState("");

  const reset = () => {
    setWord("");
    setMeaning("");
    setExEn("");
    setExZh("");
    setSrc("");
  };

  const mutation = useMutation({
    mutationFn: () => {
      const base = { word: word.trim(), telegramId: accountId, sourceLang, targetLang };
      if (mode === "manual") {
        return api.addWordManual({
          ...base,
          meaningZh: meaning.trim() || undefined,
          example: exEn.trim()
            ? { sentenceEn: exEn.trim(), sentenceZh: exZh.trim() || undefined, sourceName: src.trim() || undefined }
            : undefined,
        });
      }
      return api.addWord(base);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["words"] });
      reset();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (word.trim()) mutation.mutate();
      }}
      className="space-y-2.5 rounded-[18px] border border-black/[0.06] bg-surface/70 p-4"
    >
      {/* mode toggle */}
      <div className="flex gap-1 rounded-full bg-black/[0.04] p-1 text-sm font-semibold w-fit">
        {(["auto", "manual"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded-full px-3 py-1 transition-colors",
              mode === m ? "bg-sage text-white" : "text-ink-muted",
            )}
          >
            {m === "auto" ? "✨ Auto (AI)" : "✍️ Manual"}
          </button>
        ))}
      </div>

      {/* language pair */}
      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
        <LangSelect value={sourceLang} onChange={setSourceLang} />
        <span className="text-ink-faint">→</span>
        <LangSelect value={targetLang} onChange={setTargetLang} />
      </div>

      <div className="flex gap-2">
        <Input
          value={word}
          onChange={(e) => setWord(e.target.value)}
          placeholder={`Word in ${langLabel(sourceLang)}`}
          disabled={mutation.isPending}
        />
        <Button type="submit" disabled={mutation.isPending || !word.trim()} className="shrink-0">
          {mutation.isPending ? (mode === "auto" ? "Searching…" : "Saving…") : "Add word →"}
        </Button>
      </div>

      {mode === "manual" && (
        <div className="space-y-2">
          <Input value={meaning} onChange={(e) => setMeaning(e.target.value)} placeholder={`Meaning (${langLabel(targetLang)})`} />
          <Input value={exEn} onChange={(e) => setExEn(e.target.value)} placeholder={`Example sentence (${langLabel(sourceLang)})`} />
          <Input value={exZh} onChange={(e) => setExZh(e.target.value)} placeholder={`Example translation (${langLabel(targetLang)})`} />
          <Input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="Source (optional)" />
        </div>
      )}

      {mutation.isError && (
        <p className="text-sm font-medium text-warn-text">{(mutation.error as Error).message}</p>
      )}
      {mutation.isPending && mode === "auto" && (
        <p className="text-sm text-ink-soft">
          Finding a real sentence and translating it — a few seconds…
        </p>
      )}
    </form>
  );
}
