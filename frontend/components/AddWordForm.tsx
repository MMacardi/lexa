"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
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
  const { t } = useI18n();

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
  // AI spell-check ("did you mean") state
  const [checking, setChecking] = useState(false);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);

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

  // Adds a word. `manual:true` skips the AI agents and creates a bare/manual
  // card — used in Manual mode and for "Add as typed" (a word the AI doesn't
  // know, so we must not let it fabricate a definition).
  const mutation = useMutation({
    mutationFn: async ({ chosen, manual }: { chosen: string; manual: boolean }) => {
      const base = { word: chosen.trim(), telegramId: accountId, sourceLang, targetLang };
      let created;
      if (manual) {
        const fromForm = mode === "manual";
        created = await api.addWordManual({
          ...base,
          meaningZh: fromForm ? meaning.trim() || undefined : undefined,
          example:
            fromForm && exEn.trim()
              ? { sentenceEn: exEn.trim(), sentenceZh: exZh.trim() || undefined, sourceName: src.trim() || undefined }
              : undefined,
        });
      } else {
        created = await api.addWord(base);
      }
      await Promise.all(collIds.map((id) => api.addWordToCollection(id, created.id)));
      return created;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      setSuggestions(null);
      reset(); // keep collIds so several words can go into the same set(s)
    },
  });

  // Only the word (auto) — or word + meaning (manual) — are required.
  const canSubmit = word.trim().length > 0 && (mode === "auto" || meaning.trim().length > 0);
  const busy = mutation.isPending || checking;

  // AI mode: spell-check first, then either add directly or show "did you mean".
  async function handleSubmit() {
    const typed = word.trim();
    if (!canSubmit || busy) return;
    if (mode === "manual") {
      mutation.mutate({ chosen: typed, manual: true });
      return;
    }
    setChecking(true);
    setSuggestions(null);
    try {
      const r = await api.suggestWord(typed, sourceLang);
      const typedLc = typed.toLowerCase();
      const alts = r.suggestions.filter(Boolean);
      const others = alts.filter((a) => a !== typedLc);
      // Input is a real word and nothing else to offer → add it with AI.
      if (r.corrected === typedLc && others.length === 0) {
        mutation.mutate({ chosen: typedLc, manual: false });
      } else {
        setSuggestions(alts.length ? alts : [r.corrected]);
      }
    } catch {
      mutation.mutate({ chosen: typed, manual: false }); // on any hiccup, add with AI
    } finally {
      setChecking(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
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
            {m === "auto" ? t("add.auto") : t("add.manual")}
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
          onChange={(e) => {
            setWord(e.target.value);
            if (suggestions) setSuggestions(null);
          }}
          placeholder={t("add.wordPlaceholder", { lang: langLabel(sourceLang) })}
          disabled={busy}
        />
        <Button type="submit" disabled={busy || !canSubmit} className="shrink-0">
          {checking
            ? t("add.checking")
            : mutation.isPending
              ? mode === "auto"
                ? t("add.searching")
                : t("add.saving")
              : t("add.submit")}
        </Button>
      </div>

      {/* AI "did you mean" suggestions */}
      {suggestions && (
        <div className="anim-fade-up space-y-2 rounded-[14px] border border-sage/30 bg-sage-tint/50 p-3">
          <p className="text-sm font-semibold text-sage-deep">{t("add.didYouMean")}</p>
          <div className="flex flex-wrap items-center gap-2">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                disabled={mutation.isPending}
                onClick={() => mutation.mutate({ chosen: s, manual: false })}
                className="rounded-full bg-sage px-3 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-sage-deep disabled:opacity-50"
              >
                {s}
              </button>
            ))}
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate({ chosen: word.trim(), manual: true })}
              title="The AI may not know this word — it's added as a blank card you can edit."
              className="rounded-full border border-black/[0.1] bg-surface px-3 py-1.5 text-sm font-semibold text-ink-muted hover:bg-black/[0.03] disabled:opacity-50"
            >
              {t("add.asTyped", { word: word.trim() })}
            </button>
            <button
              type="button"
              onClick={() => setSuggestions(null)}
              className="text-sm font-semibold text-ink-faint hover:text-ink-muted"
            >
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {mode === "manual" && (
        <div className="space-y-2">
          <Input value={meaning} onChange={(e) => setMeaning(e.target.value)} placeholder={t("add.meaningPlaceholder", { lang: langLabel(targetLang) })} />
          <Input value={exEn} onChange={(e) => setExEn(e.target.value)} placeholder={t("add.examplePlaceholder", { lang: langLabel(sourceLang) })} />
          <Input value={exZh} onChange={(e) => setExZh(e.target.value)} placeholder={t("add.exampleTrPlaceholder", { lang: langLabel(targetLang) })} />
          <Input value={src} onChange={(e) => setSrc(e.target.value)} placeholder={t("add.sourcePlaceholder")} />
        </div>
      )}

      {/* optional collections — pretty dropdown multi-select */}
      {collections && collections.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {t("add.toSet")}
          </span>
          <CollectionMultiSelect options={collections} value={collIds} onChange={setCollIds} />
        </div>
      )}

      {mutation.isError && (
        <p className="text-sm font-medium text-warn-text">{(mutation.error as Error).message}</p>
      )}
      {mutation.isPending && mode === "auto" && !suggestions && (
        <p className="text-sm text-ink-soft">{t("add.findingSentence")}</p>
      )}
    </form>
  );
}
