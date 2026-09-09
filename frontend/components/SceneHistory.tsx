"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { langLabel } from "@/lib/langs";
import { Clapperboard, Trash2, Search, Check } from "lucide-react";
import { cn } from "@/lib/utils";

// Past scene playthroughs on the scene setup screen: title, language pair, status,
// and the words studied in that scene. Click a row to resume (active) or re-read
// the transcript + report card (done). Mirrors the Reader's SavedTexts language.
export function SceneHistory({ onOpen }: { onOpen: (id: string) => void }) {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");

  const { data: items } = useQuery({
    queryKey: ["scene-sessions", accountId],
    queryFn: () => api.sceneSessions(accountId),
    enabled: !!accountId,
  });

  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      (items ?? []).filter(
        (it) =>
          !q ||
          it.title.toLowerCase().includes(q) ||
          it.used.some((w) => w.toLowerCase().includes(q)) ||
          it.addedWords.some((w) => w.toLowerCase().includes(q)),
      ),
    [items, q],
  );

  async function remove(id: string) {
    await api.deleteSceneSession(id, accountId).catch(() => {});
    qc.setQueryData<typeof items>(["scene-sessions", accountId], (list) => (list ?? []).filter((x) => x.id !== id));
  }

  if (!items || items.length === 0) return null;

  return (
    <div className="mt-6 w-full max-w-[540px] space-y-2.5 text-left">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto flex items-center gap-1.5 font-serif text-[17px] font-medium text-ink">
          <Clapperboard className="h-4 w-4 text-sage-deep" /> {t("scene.historyTitle")}
        </h2>
        {items.length > 3 && (
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("scene.searchPlaceholder")}
              aria-label={t("scene.searchPlaceholder")}
              className="h-8 w-[140px] rounded-full border border-black/[0.08] bg-surface pl-8 pr-3 text-[13px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none"
            />
          </div>
        )}
      </div>

      {shown.length === 0 && <p className="py-3 text-center text-[13px] text-ink-faint">{t("scene.historyEmpty")}</p>}

      <div className="space-y-2">
        {shown.map((it) => {
          const words = [...new Set([...it.used, ...it.addedWords])];
          return (
            <div key={it.id} className="group relative rounded-[16px] border border-black/[0.07] bg-surface p-3.5 pr-10 transition-colors hover:border-sage/40">
              <button type="button" onClick={() => onOpen(it.id)} className="block w-full text-left">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate text-[14.5px] font-semibold text-ink">{it.title}</span>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                      it.status === "done" ? "bg-sage-tint text-sage-deep" : "bg-warn-bg text-warn-text",
                    )}
                  >
                    {it.status === "done" ? t("scene.statusDone") : t("scene.statusActive")}
                  </span>
                  {it.sourceLang && it.targetLang && (
                    <span className="shrink-0 text-[11px] font-medium text-ink-faint">
                      {langLabel(it.sourceLang)} → {langLabel(it.targetLang)}
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] text-ink-faint">
                    {new Date(it.updatedAt).toLocaleDateString()}
                  </span>
                </div>
                {words.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{t("scene.studiedWords")}</span>
                    {words.slice(0, 8).map((w) => (
                      <span key={w} className="rounded-full border border-black/[0.08] bg-paper px-1.5 py-0.5 text-[11px] text-ink-muted">
                        {it.used.includes(w) && <Check className="mr-0.5 inline h-2.5 w-2.5 text-sage-deep" strokeWidth={3} />}
                        {w}
                      </span>
                    ))}
                    {words.length > 8 && <span className="text-[11px] text-ink-faint">+{words.length - 8}</span>}
                  </div>
                )}
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
          );
        })}
      </div>
    </div>
  );
}
