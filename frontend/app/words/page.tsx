"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, isDue, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { useDialog } from "@/lib/dialog";
import { useToast } from "@/lib/toast";
import { pairLabel } from "@/lib/langs";
import { AddWordForm } from "@/components/AddWordForm";
import { ImportWordsDialog, exportWords } from "@/components/ImportWordsDialog";
import { CollectionSelect } from "@/components/CollectionSelect";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { Download, Trash2, X, Plus, Search } from "lucide-react";
import { OPEN_ADD, open } from "@/lib/mobileNav";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ErrorState";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// Sentinel <Select> value for "create a new set from the selection".
const NEW_SET = "__new__";

type Filter = "all" | "learning" | "mastered" | "due";
type SortKey = "recent" | "alpha" | "mastery" | "due";

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
  const [sort, setSort] = useState<SortKey>("recent");
  const [pair, setPair] = useState<string>("all");
  const [coll, setColl] = useState<string>("all");
  // bulk selection (add many words to a collection at once)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkColl, setBulkColl] = useState<string>("");
  // name for a set created straight from the bubble (used when picking "+ New set" or having none)
  const [newSetName, setNewSetName] = useState("");
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

  // Add every selected word to the chosen collection in one go, creating it first
  // when the user typed a new set name instead of picking an existing one.
  const bulkAdd = useMutation({
    mutationFn: async (target: { id: string } | { newName: string }) => {
      const n = selected.size;
      const coll =
        "newName" in target
          ? await api.createCollection(target.newName, accountId)
          : { id: target.id, name: collections?.find((c) => c.id === target.id)?.name ?? "" };
      await Promise.all([...selected].map((id) => api.addWordToCollection(coll.id, id)));
      return { n, name: coll.name };
    },
    onSuccess: ({ n, name }) => {
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["collections"] });
      setSelected(new Set());
      setBulkColl("");
      setNewSetName("");
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

  // No sets yet, or "+ New set" picked → the bubble shows a name field instead.
  const creatingSet = !collections?.length || bulkColl === NEW_SET;
  const submitBulk = () => {
    if (bulkAdd.isPending) return;
    if (creatingSet) {
      const name = newSetName.trim();
      if (name) bulkAdd.mutate({ newName: name });
    } else if (bulkColl) bulkAdd.mutate({ id: bulkColl });
  };

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
  const dueCount = words.filter(isDue).length;

  // Sort comparators for the list. "recent" mirrors the API order (newest first).
  const dueAt = (w: Word) => (w.nextReviewAt ? new Date(w.nextReviewAt).getTime() : 0); // null = due now
  const sortFns: Record<SortKey, (a: Word, b: Word) => number> = {
    recent: (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    alpha: (a, b) => a.word.localeCompare(b.word),
    mastery: (a, b) => b.reviewCount - a.reviewCount,
    due: (a, b) => dueAt(a) - dueAt(b),
  };

  // Distinct language pairs with how many words use each, most-used first. The
  // dropdown lists them all (reader-style, with counts); the quick chips below
  // surface only the top few so the row never overflows on a big collection.
  const pairCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of data ?? []) {
      const key = `${w.sourceLang}>${w.targetLang}`;
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [data]);
  const pairs = pairCounts.map(([key]) => key);

  const q = query.trim().toLowerCase();
  const filtered = words
    .filter((w) => {
      if (filter === "mastered" && w.reviewCount < 5) return false;
      if (filter === "learning" && w.reviewCount >= 5) return false;
      if (filter === "due" && !isDue(w)) return false;
      if (pair !== "all" && `${w.sourceLang}>${w.targetLang}` !== pair) return false;
      if (coll !== "all" && !(w.collections ?? []).some((c) => c.id === coll)) return false;
      return (
        !q ||
        w.word.toLowerCase().includes(q) ||
        (w.meaningZh ?? "").toLowerCase().includes(q)
      );
    })
    .sort(sortFns[sort]);

  // Reset the visible window whenever the filter/search/sort narrows the list.
  useEffect(() => {
    setVisible(PAGE);
  }, [q, filter, pair, coll, sort]);

  const shown = filtered.slice(0, visible);

  const pills: { key: Filter; label: string }[] = [
    { key: "all", label: t("words.pill.all", { n: words.length }) },
    { key: "due", label: t("words.pill.due", { n: dueCount }) },
    { key: "learning", label: t("words.pill.learning", { n: learning }) },
    { key: "mastered", label: t("words.pill.mastered", { n: mastered }) },
  ];

  return (
    <div className="space-y-6">
      <div className="anim-fade-up flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h1 className="font-serif text-[28px] font-medium break-words sm:text-[34px] tracking-[-0.01em] text-ink">{t("words.title")}</h1>
          <span className="text-[15px] font-semibold text-sage">{t("words.count", { n: words.length })}</span>
        </div>
        <div className="flex items-center gap-2">
          {words.length > 0 && (
            <Button type="button" variant="outline" onClick={() => exportWords(words)} className="inline-flex items-center gap-1.5">
              <Download className="h-4 w-4" /> {t("import.export")}
            </Button>
          )}
          <ImportWordsDialog defaultCollectionId={coll} />
        </div>
      </div>

      {/* add a word: the full inline form on desktop; on phones a compact row that
          opens the same quick-add sheet as the header "+" (the form is long) */}
      <div className="anim-fade-up hidden md:block" style={{ animationDelay: "60ms" }}>
        <AddWordForm defaultCollectionId={coll} />
      </div>
      <button
        type="button"
        onClick={() => open(OPEN_ADD)}
        className="anim-fade-up flex w-full items-center gap-3 rounded-[18px] border border-black/[0.06] bg-surface px-4 py-3.5 text-left transition-colors active:bg-black/[0.03] md:hidden"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sage text-white">
          <Plus className="h-[18px] w-[18px]" strokeWidth={2.4} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold text-ink">{t("nav.addWord")}</span>
          <span className="block truncate text-[13px] text-ink-soft">{t("words.addHint")}</span>
        </span>
      </button>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      )}
      {isError && <ErrorState message={errText(error, t)} onRetry={() => refetch()} />}

      {data && words.length === 0 && (
        <p className="rounded-[18px] border border-dashed border-black/[0.12] bg-surface/60 p-8 text-center text-sm text-ink-soft">
          {t("words.empty")}
        </p>
      )}

      {data && words.length > 0 && (
        <>
          {/* filters: search + sort, status segments, then set / language pair */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("words.search")}
                  className="h-10 w-full rounded-full border border-black/[0.07] bg-surface pr-4 pl-10 text-[15px] text-ink placeholder:text-[#b3aa9a] focus:border-sage focus:outline-none"
                />
              </div>
              <Select
                value={sort}
                onChange={(v) => setSort(v as SortKey)}
                ariaLabel={t("words.sort.label")}
                className="w-[128px] shrink-0 sm:w-[150px] [&>button]:h-10 [&>button]:rounded-full"
                options={[
                  { value: "recent", label: t("words.sort.recent") },
                  { value: "alpha", label: t("words.sort.alpha") },
                  { value: "mastery", label: t("words.sort.mastery") },
                  { value: "due", label: t("words.sort.due") },
                ]}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="scroll-row flex gap-1 rounded-full bg-black/[0.04] p-1 text-[13px] font-semibold sm:text-sm">
                {pills.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setFilter(p.key)}
                    className={cn(
                      "rounded-full px-3.5 py-1.5 transition-colors",
                      filter === p.key ? "bg-sage text-white" : "text-ink-muted hover:text-ink",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* set + language pair (the pair list shows every pair with its word
                  count; only when there's more than one pair) */}
              {((collections && collections.length > 0) || pairs.length > 1) && (
                <div className="grid w-full grid-cols-2 gap-2 sm:ml-auto sm:flex sm:w-auto">
                  {collections && collections.length > 0 && (
                    <CollectionSelect options={collections} value={coll} onChange={setColl} className="min-w-0 sm:w-[190px] [&>button]:min-w-0" />
                  )}
                  {pairs.length > 1 && (
                    <Select
                      value={pair}
                      onChange={setPair}
                      ariaLabel={t("words.pair")}
                      className="min-w-0 sm:w-[210px] [&>button]:rounded-full"
                      options={[
                        { value: "all", label: t("reader.allLangs") },
                        ...pairCounts.map(([key, n]) => {
                          const [s, tg] = key.split(">");
                          return { value: key, label: `${pairLabel(s, tg)} · ${n}` };
                        }),
                      ]}
                    />
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-[20px] border border-black/[0.06] bg-surface">
            <div className="flex items-center gap-3 border-b border-black/[0.07] px-4 py-3 text-xs sm:px-6 sm:py-3.5 font-semibold uppercase tracking-[0.1em] text-ink-faint">
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
                    "group flex items-start gap-3 border-b border-black/[0.05] px-4 py-3.5 last:border-0 sm:px-6 sm:py-4 transition-colors hover:bg-black/[0.015]",
                    selected.has(w.id) && "bg-sage-tint/25",
                  )}
                >
                  <Checkbox className="mt-0.5" ariaLabel={`Select ${w.word}`} checked={selected.has(w.id)} onChange={() => toggleSel(w.id)} />
                  <div className="grid flex-1 grid-cols-[1.4fr_0.7fr] items-center gap-4 sm:grid-cols-[1.4fr_1.1fr_1fr_0.7fr]">
                  <Link href={`/word/${w.id}`} className="min-w-0">
                    <span className="break-words font-serif text-[20px] font-semibold text-ink group-hover:text-sage-deep sm:text-[22px]">
                      {w.word}
                    </span>{" "}
                    {w.phonetic && <span className="text-sm text-ink-faint">{w.phonetic}</span>}
                    <span className="mt-0.5 block text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                      {pairLabel(w.sourceLang, w.targetLang)}
                    </span>
                    <span className={cn("mt-0.5 block truncate text-sm text-sage sm:hidden", targetFont(w.targetLang))}>
                      {w.meaningZh?.trim() ? w.meaningZh : <span className="inline-block h-3 w-28 animate-pulse rounded bg-sage/25 align-middle" />}
                    </span>
                  </Link>
                  <span className={cn("hidden truncate text-[17px] text-sage-deep sm:block", targetFont(w.targetLang))}>
                    {w.meaningZh?.trim() ? w.meaningZh : <span className="inline-block h-3.5 w-32 animate-pulse rounded bg-sage/25 align-middle" />}
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
                      className="text-ink-faint opacity-100 transition-opacity hover:text-warn-text md:opacity-0 md:group-hover:opacity-100"
                    >
                      <X className="h-4 w-4" />
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
            {collections && collections.length > 0 && (
              <Select
                value={bulkColl}
                onChange={setBulkColl}
                placeholder={t("words.chooseSet")}
                ariaLabel={t("words.chooseSet")}
                className="w-[170px]"
                options={[
                  ...collections.map((c) => ({ value: c.id, label: c.name })),
                  { value: NEW_SET, label: t("words.newSetOption") },
                ]}
              />
            )}
            {creatingSet && (
              <input
                value={newSetName}
                onChange={(e) => setNewSetName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitBulk()}
                placeholder={t("col.newSetPlaceholder")}
                aria-label={t("col.newSetPlaceholder")}
                maxLength={80}
                className="h-9 w-[160px] rounded-full border border-black/[0.1] bg-surface px-3.5 text-sm outline-none focus:border-sage"
              />
            )}
            <Button
              size="sm"
              disabled={(creatingSet ? !newSetName.trim() : !bulkColl) || bulkAdd.isPending}
              onClick={submitBulk}
            >
              {bulkAdd.isPending ? t("add.saving") : creatingSet ? t("words.createAndAdd") : t("words.addToSet")}
            </Button>
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
              className="inline-flex items-center gap-1.5 rounded-full border border-warn-text/30 px-3 py-1.5 text-sm font-semibold text-warn-text transition-colors hover:bg-warn-bg disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> <span className="hidden sm:inline">{t("words.deleteSelected")}</span>
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
