"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { pairLabel } from "@/lib/langs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const targetFont = (lang: string) => (lang === "zh" ? "font-zh" : "");

export default function CollectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { accountId } = useAccount();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [pairFilter, setPairFilter] = useState("all");

  const { data: collections } = useQuery({
    queryKey: ["collections", accountId],
    queryFn: () => api.collections(accountId),
  });
  const { data: words, isLoading } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
  });

  const collection = collections?.find((c) => c.id === id);
  const all = words ?? [];
  const inSet = all.filter((w) => (w.collections ?? []).some((c) => c.id === id));
  const q = query.trim().toLowerCase();
  const notInSet = all.filter((w) => !(w.collections ?? []).some((c) => c.id === id));
  const availablePairs = Array.from(new Set(notInSet.map((w) => `${w.sourceLang}>${w.targetLang}`)));
  const candidates = notInSet
    .filter((w) => pairFilter === "all" || `${w.sourceLang}>${w.targetLang}` === pairFilter)
    .filter((w) => !q || w.word.toLowerCase().includes(q) || (w.meaningZh ?? "").toLowerCase().includes(q));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["words"] });
    qc.invalidateQueries({ queryKey: ["collections"] });
    qc.invalidateQueries({ queryKey: ["word"] });
  };
  const addW = useMutation({
    mutationFn: (wordId: string) => api.addWordToCollection(id, wordId),
    onSuccess: invalidate,
  });
  const removeW = useMutation({
    mutationFn: (wordId: string) => api.removeWordFromCollection(id, wordId),
    onSuccess: invalidate,
  });

  if (isLoading)
    return (
      <div className="space-y-5">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="h-24 rounded-[18px]" />
        <Skeleton className="h-40 rounded-[18px]" />
      </div>
    );

  return (
    <div className="anim-fade-up space-y-7">
      <div className="space-y-2">
        <Link href="/collections" className="text-sm font-semibold text-ink-soft hover:text-ink">
          ← {t("nav.collections")}
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="font-serif text-[34px] font-medium tracking-[-0.01em] text-ink">
            {collection?.name ?? "—"}
          </h1>
          <div className="flex gap-2">
            <Link
              href={`/review?coll=${id}`}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                inSet.length >= 1
                  ? "bg-sage text-white hover:bg-sage-deep"
                  : "pointer-events-none border border-black/[0.05] text-ink-faint/50",
              )}
            >
              {t("col.study")}
            </Link>
            <Link
              href={`/quiz?coll=${id}`}
              className={cn(
                "rounded-full px-4 py-2 text-sm font-semibold transition-colors",
                inSet.length >= 4
                  ? "border border-black/[0.08] bg-surface text-ink-muted hover:bg-black/[0.03]"
                  : "pointer-events-none border border-black/[0.05] text-ink-faint/50",
              )}
            >
              {t("col.quiz")}
            </Link>
          </div>
        </div>
      </div>

      {/* words in this set */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
          {t("col.inSet")} · {inSet.length}
        </p>
        {inSet.length === 0 ? (
          <p className="rounded-[16px] border border-dashed border-black/[0.12] bg-surface/60 p-6 text-center text-sm text-ink-soft">
            {t("col.emptySet")}
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {inSet.map((w) => (
              <span
                key={w.id}
                className="inline-flex items-center gap-2 rounded-full border border-sage/30 bg-sage-tint py-1 pl-3 pr-1.5 text-sm font-semibold text-sage-deep"
              >
                <Link href={`/word/${w.id}`} className="hover:underline">
                  {w.word}
                </Link>
                <button
                  onClick={() => removeW.mutate(w.id)}
                  disabled={removeW.isPending}
                  aria-label="Remove"
                  className="flex h-5 w-5 items-center justify-center rounded-full text-sage-deep/70 hover:bg-black/[0.06] hover:text-warn-text"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* add words */}
      <div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
          {t("col.addWords")}
        </p>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("col.searchWords")}
          className="mb-3 h-11 w-full rounded-[14px] border border-black/[0.08] bg-surface px-4 text-[15px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
        />

        {availablePairs.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              onClick={() => setPairFilter("all")}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                pairFilter === "all" ? "bg-sage text-white" : "border border-black/[0.07] bg-surface text-ink-muted hover:bg-black/[0.03]",
              )}
            >
              {t("common.all")}
            </button>
            {availablePairs.map((p) => {
              const [s, tg] = p.split(">");
              return (
                <button
                  key={p}
                  onClick={() => setPairFilter(p)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                    pairFilter === p ? "bg-sage text-white" : "border border-black/[0.07] bg-surface text-ink-muted hover:bg-black/[0.03]",
                  )}
                >
                  {pairLabel(s, tg)}
                </button>
              );
            })}
          </div>
        )}

        {candidates.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-ink-faint">
              {notInSet.length === 0 ? t("col.noneToAdd") : t("col.noWordFound")}
            </p>
            {q && (
              <Link
                href={`/words?coll=${id}&word=${encodeURIComponent(query.trim())}`}
                className="inline-flex items-center gap-2 rounded-full bg-sage px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-sage-deep"
              >
                ＋ {t("col.createWord", { word: query.trim() })}
              </Link>
            )}
          </div>
        ) : (
          <div className="divide-y divide-black/[0.05] overflow-hidden rounded-[16px] border border-black/[0.06] bg-surface">
            {candidates.slice(0, 40).map((w: Word) => (
              <button
                key={w.id}
                onClick={() => addW.mutate(w.id)}
                disabled={addW.isPending}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-sage-tint/40 disabled:opacity-50"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-serif text-[18px] font-semibold text-ink">{w.word}</span>
                    <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                      {pairLabel(w.sourceLang, w.targetLang)}
                    </span>
                  </span>
                  {w.meaningZh && (
                    <span className={cn("truncate text-sm text-sage-deep", targetFont(w.targetLang))}>
                      {w.meaningZh}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-lg font-bold text-sage">+</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
