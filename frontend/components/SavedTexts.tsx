"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ReaderTextFull } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { langLabel } from "@/lib/langs";
import { getShowTextLevel } from "@/lib/learnPrefs";
import { Select } from "@/components/ui/Select";
import { SaveModal } from "@/components/ReaderTextTools";
import { LayoutGrid, List, Clock, TriangleAlert, Trash2, Pencil, Search } from "lucide-react";
import { cn } from "@/lib/utils";

// Inline "My texts" library on the reader's input page: browse saved texts as
// cards (title + preview + level + language pair) or a compact list, open one to
// keep reading, or delete. Replaces the old modal button.
export function SavedTexts({ onOpen }: { onOpen: (full: ReaderTextFull) => void }) {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [view, setView] = useState<"cards" | "list">("cards");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [fPair, setFPair] = useState(""); // "sourceLang|targetLang" filter, "" = all
  const [fColl, setFColl] = useState(""); // collection filter, "" = all
  const [fLevel, setFLevel] = useState(""); // CEFR level filter, "" = all
  const [query, setQuery] = useState(""); // title/snippet search
  const [editing, setEditing] = useState<ReaderTextFull | null>(null);
  const showLevel = getShowTextLevel();

  const { data: items } = useQuery({
    queryKey: ["reader-texts", accountId],
    queryFn: () => api.readerTexts(accountId),
  });

  // Distinct language pairs + collections + levels present, each with a count of
  // how many texts match, shown next to the option (e.g. "English → Russian · 3").
  const pairOptions = useMemo(() => {
    const label = new Map<string, string>();
    const count = new Map<string, number>();
    for (const it of items ?? []) {
      if (it.sourceLang && it.targetLang) {
        const key = `${it.sourceLang}|${it.targetLang}`;
        label.set(key, `${langLabel(it.sourceLang)} → ${langLabel(it.targetLang)}`);
        count.set(key, (count.get(key) ?? 0) + 1);
      }
    }
    return [...label].map(([value, l]) => ({ value, label: `${l} · ${count.get(value)}` }));
  }, [items]);
  const collOptions = useMemo(() => {
    const count = new Map<string, number>();
    for (const it of items ?? []) if (it.collection) count.set(it.collection, (count.get(it.collection) ?? 0) + 1);
    return [...count].map(([value, n]) => ({ value, label: `${value} · ${n}` }));
  }, [items]);
  const levelOptions = useMemo(() => {
    const count = new Map<string, number>();
    for (const it of items ?? []) if (it.level) count.set(it.level, (count.get(it.level) ?? 0) + 1);
    return [...count.keys()].sort().map((lvl) => ({ value: lvl, label: `${lvl} · ${count.get(lvl)}` }));
  }, [items]);

  const q = query.trim().toLowerCase();
  const shown = (items ?? []).filter(
    (it) =>
      (!fPair || `${it.sourceLang}|${it.targetLang}` === fPair) &&
      (!fColl || it.collection === fColl) &&
      (!fLevel || it.level === fLevel) &&
      (!q || it.title.toLowerCase().includes(q) || (it.snippet ?? "").toLowerCase().includes(q)),
  );

  async function open(id: string) {
    setLoadingId(id);
    try {
      onOpen(await api.readerText(id, accountId));
    } finally {
      setLoadingId(null);
    }
  }
  async function remove(id: string) {
    await api.deleteReaderText(id, accountId).catch(() => {});
    qc.setQueryData<typeof items>(["reader-texts", accountId], (list) => (list ?? []).filter((x) => x.id !== id));
  }
  async function edit(id: string) {
    try {
      setEditing(await api.readerText(id, accountId));
    } catch {
      /* ignore */
    }
  }

  if (!items || items.length === 0) return null;

  const pair = (s?: string | null, tg?: string | null) => (s && tg ? `${langLabel(s)} → ${langLabel(tg)}` : "");
  const statusIcon = (st: string) =>
    st === "generating" ? <Clock className="h-3.5 w-3.5 text-ink-faint" /> : st === "failed" ? <TriangleAlert className="h-3.5 w-3.5 text-warn-text" /> : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto font-serif text-[20px] font-medium text-ink">{t("reader.myTexts")}</h2>
        {items.length > 3 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("reader.searchTexts")}
              aria-label={t("reader.searchTexts")}
              className="h-9 w-[150px] rounded-full border border-black/[0.08] bg-surface pl-8 pr-3 text-[13px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
            />
          </div>
        )}
        {pairOptions.length > 1 && (
          <Select
            value={fPair}
            onChange={setFPair}
            ariaLabel={t("reader.filterLang")}
            placeholder={t("reader.allLangs")}
            className="w-[168px]"
            options={[{ value: "", label: t("reader.allLangs") }, ...pairOptions]}
          />
        )}
        {collOptions.length > 0 && (
          <Select
            value={fColl}
            onChange={setFColl}
            ariaLabel={t("reader.filterColl")}
            placeholder={t("reader.allColls")}
            className="w-[150px]"
            options={[{ value: "", label: t("reader.allColls") }, ...collOptions]}
          />
        )}
        {showLevel && levelOptions.length > 1 && (
          <Select
            value={fLevel}
            onChange={setFLevel}
            ariaLabel={t("reader.filterLevel")}
            placeholder={t("reader.allLevels")}
            className="w-[120px]"
            options={[{ value: "", label: t("reader.allLevels") }, ...levelOptions]}
          />
        )}
        <div className="flex items-center gap-1 rounded-full border border-black/[0.08] p-0.5">
          <button
            type="button"
            onClick={() => setView("cards")}
            aria-label={t("reader.viewCards")}
            className={cn("rounded-full p-1.5 transition-colors", view === "cards" ? "bg-sage-tint text-sage-deep" : "text-ink-faint hover:text-ink-muted")}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            aria-label={t("reader.viewList")}
            className={cn("rounded-full p-1.5 transition-colors", view === "list" ? "bg-sage-tint text-sage-deep" : "text-ink-faint hover:text-ink-muted")}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>
      {shown.length === 0 && <p className="py-6 text-center text-[13px] text-ink-faint">{t("reader.noTextMatches")}</p>}

      {view === "cards" ? (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {shown.map((it) => (
            <div key={it.id} className="group relative rounded-[16px] border border-black/[0.07] bg-surface p-3.5 transition-colors hover:border-sage/40">
              <button
                type="button"
                onClick={() => it.status === "ready" && open(it.id)}
                disabled={loadingId === it.id || it.status !== "ready"}
                className="block w-full text-left disabled:cursor-default"
              >
                <div className="flex items-center gap-1.5 pr-12">
                  {statusIcon(it.status)}
                  <span className="truncate text-[15px] font-semibold text-ink">{it.title}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink-soft">
                  {it.status === "generating" ? t("reader.generating") : it.snippet}
                </p>
                <div className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold">
                  {it.collection && <span className="shrink-0 rounded-full bg-black/[0.05] px-1.5 py-0.5 text-ink-muted">{it.collection}</span>}
                  {pair(it.sourceLang, it.targetLang) && <span className="truncate text-ink-faint">{pair(it.sourceLang, it.targetLang)}</span>}
                  {showLevel && it.level && (
                    <span className="ml-auto shrink-0 rounded-full bg-sage-tint px-1.5 py-0.5 text-sage-deep">~{it.level}</span>
                  )}
                </div>
              </button>
              <div className="absolute right-2 top-2 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                {it.status === "ready" && (
                  <button
                    type="button"
                    onClick={() => edit(it.id)}
                    aria-label={t("reader.editAction")}
                    className="rounded-md p-1 text-ink-faint hover:text-sage-deep"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(it.id)}
                  aria-label={t("friends.remove")}
                  className="rounded-md p-1 text-ink-faint hover:text-warn-text"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-black/[0.07]">
          {shown.map((it) => (
            <div key={it.id} className="group flex items-center gap-3 border-b border-black/[0.05] px-3.5 py-2.5 last:border-b-0 hover:bg-black/[0.02]">
              <button
                type="button"
                onClick={() => it.status === "ready" && open(it.id)}
                disabled={loadingId === it.id || it.status !== "ready"}
                className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
              >
                {statusIcon(it.status)}
                <span className="truncate text-[14px] font-semibold text-ink">{it.title}</span>
              </button>
              {/* Fixed right-hand columns so level + language pair line up across rows. */}
              <div className="flex shrink-0 items-center gap-2 text-[11px] font-semibold">
                <span className="flex w-9 justify-end">
                  {showLevel && it.level && <span className="rounded-full bg-sage-tint px-1.5 py-0.5 text-[10px] text-sage-deep">~{it.level}</span>}
                </span>
                <span className="hidden w-[190px] truncate text-right font-medium text-ink-faint sm:block">{pair(it.sourceLang, it.targetLang)}</span>
                {it.collection && <span className="hidden max-w-[110px] shrink-0 truncate rounded-full bg-black/[0.05] px-1.5 py-0.5 text-[10px] text-ink-muted md:inline">{it.collection}</span>}
              </div>
              <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                {it.status === "ready" && (
                  <button
                    type="button"
                    onClick={() => edit(it.id)}
                    aria-label={t("reader.editAction")}
                    className="rounded-md p-1 text-ink-faint hover:text-sage-deep"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => remove(it.id)}
                  aria-label={t("friends.remove")}
                  className="rounded-md p-1 text-ink-faint hover:text-warn-text"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <SaveModal
          text={editing.content}
          translation={editing.translation ?? undefined}
          clickedWords={editing.clickedWords}
          sourceLang={editing.sourceLang ?? "auto"}
          targetLang={editing.targetLang ?? "zh"}
          editId={editing.id}
          initialTitle={editing.title}
          initialCollection={editing.collection ?? ""}
          initialLevel={editing.level ?? ""}
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      )}
    </div>
  );
}
