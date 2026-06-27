"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { pairLabel } from "@/lib/langs";
import { AddWordForm } from "@/components/AddWordForm";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type Filter = "all" | "learning" | "mastered";

function MasteryDots({ count }: { count: number }) {
  const filled = count >= 5 ? 3 : count >= 3 ? 2 : count >= 1 ? 1 : 0;
  return (
    <div className="flex justify-end gap-1">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn("h-2 w-2 rounded-full", i < filled ? "bg-sage" : "bg-dot-empty")}
        />
      ))}
    </div>
  );
}

// Use a CJK-capable font only when the target text is Chinese.
function targetFont(lang: string) {
  return lang === "zh" ? "font-zh" : "";
}

export default function WordsPage() {
  const { accountId } = useAccount();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pair, setPair] = useState<string>("all");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
  });

  const del = useMutation({
    mutationFn: (id: string) => api.deleteWord(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["words"] }),
  });

  const words = data ?? [];
  const mastered = words.filter((w) => w.reviewCount >= 5).length;
  const learning = words.length - mastered;

  // Distinct language pairs present in the collection.
  const pairs = Array.from(new Set(words.map((w) => `${w.sourceLang}>${w.targetLang}`)));

  const q = query.trim().toLowerCase();
  const filtered = words.filter((w) => {
    if (filter === "mastered" && w.reviewCount < 5) return false;
    if (filter === "learning" && w.reviewCount >= 5) return false;
    if (pair !== "all" && `${w.sourceLang}>${w.targetLang}` !== pair) return false;
    return (
      !q ||
      w.word.toLowerCase().includes(q) ||
      (w.meaningZh ?? "").toLowerCase().includes(q)
    );
  });

  const pills: { key: Filter; label: string }[] = [
    { key: "all", label: `All ${words.length}` },
    { key: "learning", label: `Learning ${learning}` },
    { key: "mastered", label: `Mastered ${mastered}` },
  ];

  return (
    <div className="space-y-6">
      <div className="anim-fade-up flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-serif text-[34px] font-medium tracking-[-0.01em] text-ink">My words</h1>
        <span className="text-[15px] font-semibold text-sage">{words.length} words</span>
      </div>

      <div className="anim-fade-up space-y-3" style={{ animationDelay: "60ms" }}>
        <AddWordForm />
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      )}
      {isError && <ErrorState message={(error as Error).message} onRetry={() => refetch()} />}

      {data && words.length === 0 && (
        <p className="rounded-[18px] border border-dashed border-black/[0.12] bg-surface/60 p-8 text-center text-sm text-ink-soft">
          No words yet — add one above.
        </p>
      )}

      {data && words.length > 0 && (
        <>
          {/* language-pair filter (only when more than one pair exists) */}
          {pairs.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Pair</span>
              <button
                onClick={() => setPair("all")}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                  pair === "all" ? "bg-sage text-white" : "border border-black/[0.07] bg-surface text-ink-muted hover:bg-black/[0.03]",
                )}
              >
                All
              </button>
              {pairs.map((p) => {
                const [s, t] = p.split(">");
                return (
                  <button
                    key={p}
                    onClick={() => setPair(p)}
                    className={cn(
                      "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                      pair === p ? "bg-sage text-white" : "border border-black/[0.07] bg-surface text-ink-muted hover:bg-black/[0.03]",
                    )}
                  >
                    {pairLabel(s, t)}
                  </button>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="🔍  Search your words"
              className="h-11 min-w-[200px] flex-1 rounded-[14px] border border-black/[0.07] bg-surface px-4 text-[15px] text-ink placeholder:text-[#b3aa9a] focus:border-sage focus:outline-none"
            />
            {pills.map((p) => (
              <button
                key={p.key}
                onClick={() => setFilter(p.key)}
                className={cn(
                  "rounded-full px-4 py-2.5 text-sm font-semibold transition-colors",
                  filter === p.key
                    ? "bg-ink text-paper"
                    : "border border-black/[0.07] bg-surface text-ink-muted hover:bg-black/[0.03]",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-[20px] border border-black/[0.06] bg-surface">
            <div className="grid grid-cols-[1.4fr_0.7fr] gap-4 border-b border-black/[0.07] px-6 py-3.5 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint sm:grid-cols-[1.4fr_1.1fr_1fr_0.7fr]">
              <span>Word</span>
              <span className="hidden sm:block">Meaning</span>
              <span className="hidden sm:block">Source</span>
              <span className="text-right">Mastery</span>
            </div>
            {filtered.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-ink-soft">No matches.</p>
            ) : (
              filtered.map((w: Word) => (
                <div
                  key={w.id}
                  className="group grid grid-cols-[1.4fr_0.7fr] items-center gap-4 border-b border-black/[0.05] px-6 py-4 last:border-0 transition-colors hover:bg-black/[0.015] sm:grid-cols-[1.4fr_1.1fr_1fr_0.7fr]"
                >
                  <Link href={`/word/${w.id}`} className="min-w-0">
                    <span className="font-serif text-[22px] font-semibold text-ink group-hover:text-sage-deep">
                      {w.word}
                    </span>{" "}
                    {w.phonetic && <span className="text-sm text-ink-faint">{w.phonetic}</span>}
                    <span className="mt-0.5 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                      {pairLabel(w.sourceLang, w.targetLang)}
                    </span>
                    <span className={cn("mt-0.5 block truncate text-sm text-sage sm:hidden", targetFont(w.targetLang))}>
                      {w.meaningZh}
                    </span>
                  </Link>
                  <span className={cn("hidden truncate text-[17px] text-sage-deep sm:block", targetFont(w.targetLang))}>
                    {w.meaningZh}
                  </span>
                  <span className="hidden text-sm font-medium text-ink-soft sm:block">
                    {w.examples[0]?.sourceName ?? "—"}
                  </span>
                  <div className="flex items-center justify-end gap-3">
                    <MasteryDots count={w.reviewCount} />
                    <button
                      aria-label={`Delete ${w.word}`}
                      onClick={() => {
                        if (confirm(`Delete "${w.word}"?`)) del.mutate(w.id);
                      }}
                      className="text-ink-faint opacity-0 transition-opacity hover:text-warn-text group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
