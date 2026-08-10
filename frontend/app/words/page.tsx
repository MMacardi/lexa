"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useDialog } from "@/lib/dialog";
import { useToast } from "@/lib/toast";
import { pairLabel } from "@/lib/langs";
import { AddWordForm } from "@/components/AddWordForm";
import { ImportWordsDialog, exportWords } from "@/components/ImportWordsDialog";
import { CollectionSelect } from "@/components/CollectionSelect";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { Button } from "@/components/ui/button";
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
  return lang === "zh" || lang === "zh-Hant" ? "font-zh" : "";
}

export default function WordsPage() {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { confirm } = useDialog();
  const { show } = useToast();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [pair, setPair] = useState<string>("all");
  const [coll, setColl] = useState<string>("all");
  // bulk selection (add many words to a collection at once)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkColl, setBulkColl] = useState<string>("");
  // how many rows are rendered (grow on demand instead of dumping the whole list)
  const PAGE = 60;
  const [visible, setVisible] = useState(PAGE);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
  });
  const { data: collections } = useQuery({
    queryKey: ["collections", accountId],
    queryFn: () => api.collections(accountId),
  });

  // Honor a ?coll= deep link from the Collections page.
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("coll");
    if (c) setColl(c);
  }, []);

  const del = useMutation({
    mutationFn: (id: string) => api.deleteWord(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["words"] }),
  });

  // Add every selected word to the chosen collection in one go.
  const bulkAdd = useMutation({
    mutationFn: async (collectionId: string) => {
      const n = selected.size;
      await Promise.all([...selected].map((id) => api.addWordToCollection(collectionId, id)));
      return { n, name: collections?.find((c) => c.id === collectionId)?.name ?? "" };
    },
    onSuccess: ({ n, name }) => {
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      setSelected(new Set());
      show({ icon: "🗂", title: t("words.addedToSet", { n, set: name }) });
    },
  });

  // Delete every selected word at once.
  const bulkDelete = useMutation({
    mutationFn: async () => {
      await Promise.all([...selected].map((id) => api.deleteWord(id)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      setSelected(new Set());
    },
  });

  const toggleSel = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
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
    if (coll !== "all" && !(w.collections ?? []).some((c) => c.id === coll)) return false;
    return (
      !q ||
      w.word.toLowerCase().includes(q) ||
      (w.meaningZh ?? "").toLowerCase().includes(q)
    );
  });

  // Reset the visible window whenever the filter/search narrows the list.
  useEffect(() => {
    setVisible(PAGE);
  }, [q, filter, pair, coll]);

  const shown = filtered.slice(0, visible);

  const pills: { key: Filter; label: string }[] = [
    { key: "all", label: t("words.pill.all", { n: words.length }) },
    { key: "learning", label: t("words.pill.learning", { n: learning }) },
    { key: "mastered", label: t("words.pill.mastered", { n: mastered }) },
  ];

  return (
    <div className="space-y-6">
      <div className="anim-fade-up flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-[34px] font-medium tracking-[-0.01em] text-ink">{t("words.title")}</h1>
          <span className="text-[15px] font-semibold text-sage">{t("words.count", { n: words.length })}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {words.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => exportWords(words)}>
              ↓ {t("import.export")}
            </Button>
          )}
          <ImportWordsDialog defaultCollectionId={coll} />
        </div>
      </div>

      <div className="anim-fade-up space-y-3" style={{ animationDelay: "60ms" }}>
        <AddWordForm defaultCollectionId={coll} />
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
          {t("words.empty")}
        </p>
      )}

      {data && words.length > 0 && (
        <>
          {/* collection filter */}
          {collections && collections.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("words.set")}</span>
              <CollectionSelect options={collections} value={coll} onChange={setColl} />
            </div>
          )}

          {/* language-pair filter (only when more than one pair exists) */}
          {pairs.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("words.pair")}</span>
              <button
                onClick={() => setPair("all")}
                className={cn(
                  "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                  pair === "all" ? "bg-sage text-white" : "border border-black/[0.07] bg-surface text-ink-muted hover:bg-black/[0.03]",
                )}
              >
                {t("common.all")}
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
              placeholder={t("words.search")}
              className="h-11 min-w-[200px] flex-1 rounded-[14px] border border-black/[0.07] bg-surface px-4 text-[15px] text-ink placeholder:text-[#b3aa9a] focus:border-sage focus:outline-none"
            />
            {pills.map((p) => (
              <button
                key={p.key}
                onClick={() => setFilter(p.key)}
                className={cn(
                  "rounded-full px-4 py-2.5 text-sm font-semibold transition-colors",
                  filter === p.key
                    ? "bg-onyx text-[#f4f1ec]"
                    : "border border-black/[0.07] bg-surface text-ink-muted hover:bg-black/[0.03]",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="overflow-hidden rounded-[20px] border border-black/[0.06] bg-surface">
            <div className="flex items-center gap-3 border-b border-black/[0.07] px-6 py-3.5 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
              <Checkbox
                ariaLabel={t("words.selectAll")}
                checked={filtered.length > 0 && filtered.every((w) => selected.has(w.id))}
                onChange={(next) => setSelected(next ? new Set(filtered.map((w) => w.id)) : new Set())}
              />
              <div className="grid flex-1 grid-cols-[1.4fr_0.7fr] gap-4 sm:grid-cols-[1.4fr_1.1fr_1fr_0.7fr]">
                <span>{t("words.col.word")}</span>
                <span className="hidden sm:block">{t("words.col.meaning")}</span>
                <span className="hidden sm:block">{t("words.col.source")}</span>
                <span className="text-right">{t("words.col.mastery")}</span>
              </div>
            </div>
            {filtered.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-ink-soft">{t("common.noMatches")}</p>
            ) : (
              shown.map((w: Word) => (
                <div
                  key={w.id}
                  className={cn(
                    "group flex items-start gap-3 border-b border-black/[0.05] px-6 py-4 last:border-0 transition-colors hover:bg-black/[0.015]",
                    selected.has(w.id) && "bg-sage-tint/25",
                  )}
                >
                  <Checkbox className="mt-0.5" ariaLabel={`Select ${w.word}`} checked={selected.has(w.id)} onChange={() => toggleSel(w.id)} />
                  <div className="grid flex-1 grid-cols-[1.4fr_0.7fr] items-center gap-4 sm:grid-cols-[1.4fr_1.1fr_1fr_0.7fr]">
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
                      onClick={async () => {
                        if (
                          await confirm({
                            title: t("dialog.deleteWordTitle"),
                            message: t("words.deleteConfirm", { word: w.word }),
                            confirmLabel: t("common.delete"),
                            tone: "danger",
                          })
                        )
                          del.mutate(w.id);
                      }}
                      className="text-ink-faint opacity-0 transition-opacity hover:text-warn-text group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                  </div>
                </div>
              ))
            )}
            {filtered.length > visible && (
              <button
                type="button"
                onClick={() => setVisible((v) => v + PAGE)}
                className="w-full border-t border-black/[0.06] px-6 py-3.5 text-sm font-semibold text-sage transition-colors hover:bg-black/[0.03]"
              >
                {t("words.showMore", { n: filtered.length - visible })}
              </button>
            )}
          </div>

          {/* spacer so the floating selection bar never hides the last rows */}
          {selected.size > 0 && <div className="h-24 md:h-16" />}
        </>
      )}

      {/* floating selection bubble — add/delete selected words from anywhere */}
      {selected.size > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(56px_+_env(safe-area-inset-bottom))] z-40 px-4 md:bottom-6">
          <div className="anim-fade-up mx-auto flex max-w-[720px] flex-wrap items-center gap-2 rounded-[18px] border border-black/[0.08] bg-surface/95 px-3.5 py-2.5 shadow-[0_14px_40px_rgba(46,42,38,0.24)] backdrop-blur">
            <span className="text-sm font-semibold text-sage-deep">{t("words.nSelected", { n: selected.size })}</span>
            {collections && collections.length > 0 ? (
              <>
                <Select
                  value={bulkColl}
                  onChange={setBulkColl}
                  placeholder={t("words.chooseSet")}
                  ariaLabel={t("words.chooseSet")}
                  className="w-[170px]"
                  options={collections.map((c) => ({ value: c.id, label: c.name }))}
                />
                <Button size="sm" disabled={!bulkColl || bulkAdd.isPending} onClick={() => bulkColl && bulkAdd.mutate(bulkColl)}>
                  {bulkAdd.isPending ? t("add.saving") : t("words.addToSet")}
                </Button>
              </>
            ) : (
              <span className="text-sm text-ink-soft">{t("words.noSetsYet")}</span>
            )}
            <button
              type="button"
              disabled={bulkDelete.isPending}
              onClick={async () => {
                if (
                  await confirm({
                    title: t("words.deleteSelectedTitle"),
                    message: t("words.deleteSelectedConfirm", { n: selected.size }),
                    confirmLabel: t("common.delete"),
                    tone: "danger",
                  })
                )
                  bulkDelete.mutate();
              }}
              className="rounded-full border border-warn-text/30 px-3 py-1.5 text-sm font-semibold text-warn-text transition-colors hover:bg-warn-bg disabled:opacity-50"
            >
              🗑 <span className="hidden sm:inline">{t("words.deleteSelected")}</span>
            </button>
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="ml-auto text-sm font-semibold text-ink-faint hover:text-ink-muted"
            >
              {t("words.clearSel")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
