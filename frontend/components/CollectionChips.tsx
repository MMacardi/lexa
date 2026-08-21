"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Check, Plus, X } from "lucide-react";

// Toggle which collections a word belongs to, with an inline "new collection".
export function CollectionChips({ word }: { word: Word }) {
  const qc = useQueryClient();
  const { accountId } = useAccount();
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  const { data: collections } = useQuery({
    queryKey: ["collections", accountId],
    queryFn: () => api.collections(accountId),
  });

  const member = new Set((word.collections ?? []).map((c) => c.id));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["word", word.id] });
    qc.invalidateQueries({ queryKey: ["words"] });
    qc.invalidateQueries({ queryKey: ["collections"] });
  };

  const toggle = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) =>
      on ? api.removeWordFromCollection(id, word.id) : api.addWordToCollection(id, word.id),
    onSuccess: invalidate,
  });

  const create = useMutation({
    mutationFn: async () => {
      const c = await api.createCollection(name.trim(), accountId);
      await api.addWordToCollection(c.id, word.id);
    },
    onSuccess: () => {
      setName("");
      setCreating(false);
      invalidate();
    },
  });

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("word.collections")}</p>
      <div className="flex flex-wrap items-center gap-2">
        {(collections ?? []).map((c) => {
          const on = member.has(c.id);
          return (
            <button
              key={c.id}
              disabled={toggle.isPending}
              onClick={() => toggle.mutate({ id: c.id, on })}
              className={cn(
                "rounded-full px-3 py-1.5 text-sm font-semibold transition-colors",
                on
                  ? "bg-sage text-white"
                  : "border border-black/[0.08] bg-surface text-ink-muted hover:bg-black/[0.03]",
                "inline-flex items-center gap-1",
              )}
            >
              {on ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {c.name}
            </button>
          );
        })}

        {creating ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) create.mutate();
            }}
            className="flex items-center gap-1.5"
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("col.newPlaceholder")}
              className="h-9 w-40 rounded-full border border-black/[0.08] bg-surface px-3 text-sm text-ink focus:border-sage focus:outline-none"
            />
            <button
              type="submit"
              disabled={!name.trim() || create.isPending}
              className="rounded-full bg-sage px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
            >
              {t("common.add")}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setName("");
              }}
              className="text-ink-faint hover:text-ink-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="rounded-full border border-dashed border-black/[0.15] px-3 py-1.5 text-sm font-semibold text-ink-faint hover:bg-black/[0.03]"
          >
            {t("col.newCollection")}
          </button>
        )}
      </div>
      {create.isError && <p className="text-sm text-warn-text">{(create.error as Error).message}</p>}
    </div>
  );
}
