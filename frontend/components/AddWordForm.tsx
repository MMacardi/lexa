"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { langLabel } from "@/lib/langs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LangSelect } from "@/components/LangSelect";
import { CollectionMultiSelect } from "@/components/CollectionMultiSelect";
import { cn } from "@/lib/utils";

type Mode = "auto" | "manual";

// `defaultCollectionId` is the active "Set" filter from My words ("all" or an
// id). When it's a real collection, the new word is pre-assigned to it.
export function AddWordForm({ defaultCollectionId }: { defaultCollectionId?: string }) {
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
  // optional collections to drop the word into (multi-select)
  const [collIds, setCollIds] = useState<string[]>([]);

  const { data: collections } = useQuery({
    queryKey: ["collections", accountId],
    queryFn: () => api.collections(accountId),
  });

  // Follow the active "Set" filter as the default selection.
  useEffect(() => {
    setCollIds(defaultCollectionId && defaultCollectionId !== "all" ? [defaultCollectionId] : []);
  }, [defaultCollectionId]);

  const reset = () => {
    setWord("");
    setMeaning("");
    setExEn("");
    setExZh("");
    setSrc("");
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const base = { word: word.trim(), telegramId: accountId, sourceLang, targetLang };
      const created =
        mode === "manual"
          ? await api.addWordManual({
              ...base,
              meaningZh: meaning.trim() || undefined,
              example: exEn.trim()
                ? { sentenceEn: exEn.trim(), sentenceZh: exZh.trim() || undefined, sourceName: src.trim() || undefined }
                : undefined,
            })
          : await api.addWord(base);
      await Promise.all(collIds.map((id) => api.addWordToCollection(id, created.id)));
      return created;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      reset(); // keep collIds so several words can go into the same set(s)
    },
  });

  // Only the word (auto) — or word + meaning (manual) — are required.
  const canSubmit = word.trim().length > 0 && (mode === "auto" || meaning.trim().length > 0);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit) mutation.mutate();
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
        <Button type="submit" disabled={mutation.isPending || !canSubmit} className="shrink-0">
          {mutation.isPending ? (mode === "auto" ? "Searching…" : "Saving…") : "Add word →"}
        </Button>
      </div>

      {mode === "manual" && (
        <div className="space-y-2">
          <Input value={meaning} onChange={(e) => setMeaning(e.target.value)} placeholder={`Meaning (${langLabel(targetLang)}) — required`} />
          <Input value={exEn} onChange={(e) => setExEn(e.target.value)} placeholder={`Example sentence (${langLabel(sourceLang)})`} />
          <Input value={exZh} onChange={(e) => setExZh(e.target.value)} placeholder={`Example translation (${langLabel(targetLang)})`} />
          <Input value={src} onChange={(e) => setSrc(e.target.value)} placeholder="Source (optional)" />
        </div>
      )}

      {/* optional collections — pretty dropdown multi-select */}
      {collections && collections.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            Add to set
          </span>
          <CollectionMultiSelect options={collections} value={collIds} onChange={setCollIds} />
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
