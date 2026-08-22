"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type ReaderTextFull } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { langLabel } from "@/lib/langs";
import { getShowTextLevel } from "@/lib/learnPrefs";
import { LayoutGrid, List, Clock, TriangleAlert, Trash2 } from "lucide-react";
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
  const showLevel = getShowTextLevel();

  const { data: items } = useQuery({
    queryKey: ["reader-texts", accountId],
    queryFn: () => api.readerTexts(accountId),
  });

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

  if (!items || items.length === 0) return null;

  const pair = (s?: string | null, tg?: string | null) => (s && tg ? `${langLabel(s)} → ${langLabel(tg)}` : "");
  const statusIcon = (st: string) =>
    st === "generating" ? <Clock className="h-3.5 w-3.5 text-ink-faint" /> : st === "failed" ? <TriangleAlert className="h-3.5 w-3.5 text-warn-text" /> : null;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-serif text-[20px] font-medium text-ink">{t("reader.myTexts")}</h2>
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

      {view === "cards" ? (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {items.map((it) => (
            <div key={it.id} className="group relative rounded-[16px] border border-black/[0.07] bg-surface p-3.5 transition-colors hover:border-sage/40">
              <button
                type="button"
                onClick={() => it.status === "ready" && open(it.id)}
                disabled={loadingId === it.id || it.status !== "ready"}
                className="block w-full text-left disabled:cursor-default"
              >
                <div className="flex items-center gap-1.5">
                  {statusIcon(it.status)}
                  <span className="truncate font-semibold text-ink">{it.title}</span>
                </div>
                <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-ink-soft">
                  {it.status === "generating" ? t("reader.generating") : it.snippet}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-semibold">
                  {showLevel && it.level && <span className="rounded-full bg-sage-tint px-1.5 py-0.5 text-sage-deep">~{it.level}</span>}
                  {it.collection && <span className="rounded-full bg-black/[0.05] px-1.5 py-0.5 text-ink-muted">{it.collection}</span>}
                  {pair(it.sourceLang, it.targetLang) && <span className="text-ink-faint">{pair(it.sourceLang, it.targetLang)}</span>}
                </div>
              </button>
              <button
                type="button"
                onClick={() => remove(it.id)}
                aria-label={t("friends.remove")}
                className="absolute right-2 top-2 rounded-md p-1 text-ink-faint opacity-0 transition-opacity hover:text-warn-text group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-black/[0.07]">
          {items.map((it) => (
            <div key={it.id} className="group flex items-center gap-2 border-b border-black/[0.05] px-3.5 py-2.5 last:border-b-0 hover:bg-black/[0.02]">
              <button
                type="button"
                onClick={() => it.status === "ready" && open(it.id)}
                disabled={loadingId === it.id || it.status !== "ready"}
                className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
              >
                {statusIcon(it.status)}
                <span className="truncate font-semibold text-ink">{it.title}</span>
                {showLevel && it.level && <span className="shrink-0 rounded-full bg-sage-tint px-1.5 py-0.5 text-[10px] font-semibold text-sage-deep">~{it.level}</span>}
                {pair(it.sourceLang, it.targetLang) && <span className="shrink-0 text-[11px] text-ink-faint">{pair(it.sourceLang, it.targetLang)}</span>}
              </button>
              <button
                type="button"
                onClick={() => remove(it.id)}
                aria-label={t("friends.remove")}
                className="shrink-0 rounded-md p-1 text-ink-faint opacity-0 transition-opacity hover:text-warn-text group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
