"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Collection, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { X, Pencil, GraduationCap, Target } from "lucide-react";
import { useDialog } from "@/lib/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export default function CollectionsPage() {
  const qc = useQueryClient();
  const { accountId } = useAccount();
  const { t } = useI18n();
  const [name, setName] = useState("");

  const { data: collections, isLoading } = useQuery({
    queryKey: ["collections", accountId],
    queryFn: () => api.collections(accountId),
  });
  const { data: words } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => api.listWords(accountId),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["collections"] });
    qc.invalidateQueries({ queryKey: ["words"] });
  };

  const create = useMutation({
    mutationFn: () => api.createCollection(name.trim(), accountId),
    onSuccess: () => {
      setName("");
      invalidate();
    },
  });

  const wordsByColl = (id: string) =>
    (words ?? []).filter((w) => (w.collections ?? []).some((c) => c.id === id));

  return (
    <div className="space-y-7">
      <div className="anim-fade-up">
        <h1 className="font-serif text-[34px] font-medium tracking-[-0.01em] text-ink">{t("nav.collections")}</h1>
        <p className="mt-1.5 text-ink-soft">{t("col.pageSubtitle")}</p>
      </div>

      {/* create */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
        className="anim-fade-up flex flex-wrap gap-2 rounded-[18px] border border-black/[0.06] bg-surface/70 p-4"
        style={{ animationDelay: "60ms" }}
      >
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("col.createPlaceholder")}
          className="min-w-[220px] flex-1"
        />
        <Button type="submit" disabled={!name.trim() || create.isPending} className="shrink-0">
          {create.isPending ? t("col.creating") : t("col.create")}
        </Button>
        {create.isError && (
          <p className="w-full text-sm font-medium text-warn-text">{(create.error as Error).message}</p>
        )}
      </form>

      {isLoading && (
        <div className="grid gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-[20px]" />
          ))}
        </div>
      )}

      {collections && collections.length === 0 && (
        <p className="rounded-[18px] border border-dashed border-black/[0.12] bg-surface/60 p-8 text-center text-sm text-ink-soft">
          {t("col.emptyList")}
        </p>
      )}

      {collections && collections.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          {collections.map((c) => (
            <CollectionCard
              key={c.id}
              collection={c}
              words={wordsByColl(c.id)}
              onChanged={invalidate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionCard({
  collection,
  words,
  onChanged,
}: {
  collection: Collection;
  words: Word[];
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const { confirm } = useDialog();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(collection.name);

  const rename = useMutation({
    mutationFn: () => api.renameCollection(collection.id, name.trim()),
    onSuccess: () => {
      setEditing(false);
      onChanged();
    },
  });
  const remove = useMutation({
    mutationFn: () => api.deleteCollection(collection.id),
    onSuccess: onChanged,
  });

  const count = collection.count;

  return (
    <div className="anim-fade-up flex flex-col rounded-[20px] border border-black/[0.06] bg-surface p-5">
      <div className="flex items-start justify-between gap-2">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) rename.mutate();
            }}
            className="flex flex-1 gap-2"
          >
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus className="h-9" />
            <button type="submit" className="text-sm font-semibold text-sage-deep hover:underline">
              {t("common.save")}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setName(collection.name);
              }}
              className="text-ink-faint"
            >
              <X className="h-4 w-4" />
            </button>
          </form>
        ) : (
          <>
            <div className="min-w-0">
              <Link
                href={`/collections/${collection.id}`}
                className="block truncate font-serif text-[22px] font-semibold text-ink hover:text-sage-deep"
              >
                {collection.name}
              </Link>
              <p className="text-[13px] font-medium text-ink-soft">
                {count === 1 ? t("col.word", { n: count }) : t("col.words", { n: count })}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                onClick={() => setEditing(true)}
                aria-label="Rename"
                className="rounded-lg p-1.5 text-ink-faint hover:bg-black/[0.04]"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={async () => {
                  if (
                    await confirm({
                      title: t("dialog.deleteCollectionTitle"),
                      message: t("col.deleteConfirm", { name: collection.name }),
                      confirmLabel: t("common.delete"),
                      tone: "danger",
                    })
                  )
                    remove.mutate();
                }}
                aria-label="Delete"
                className="rounded-lg p-1.5 text-ink-faint hover:bg-black/[0.04] hover:text-warn-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* word preview */}
      <div className="mt-3 flex min-h-[28px] flex-wrap gap-1.5">
        {words.slice(0, 6).map((w) => (
          <Link
            key={w.id}
            href={`/word/${w.id}`}
            className="rounded-full border border-black/[0.06] bg-paper px-2.5 py-0.5 text-sm text-ink-muted hover:bg-sage-tint hover:text-sage-deep"
          >
            {w.word}
          </Link>
        ))}
        {count > 6 && <span className="px-1 py-0.5 text-sm text-ink-faint">{t("col.more", { n: count - 6 })}</span>}
        {count === 0 && <span className="text-sm text-ink-faint">{t("col.cardEmpty")}</span>}
      </div>

      {/* actions */}
      <div className="mt-4 flex flex-wrap gap-2 pt-1">
        <Action href={`/review?coll=${collection.id}`} disabled={count < 1} reason={t("col.needWords")}>
          <GraduationCap className="h-4 w-4" /> {t("col.study")}
        </Action>
        <Action href={`/quiz?coll=${collection.id}`} disabled={count < 4} reason={t("col.needFour")}>
          <Target className="h-4 w-4" /> {t("col.quiz")}
        </Action>
        <Action href={`/collections/${collection.id}`} variant="ghost">
          {t("col.open")} →
        </Action>
      </div>
    </div>
  );
}

function Action({
  href,
  disabled,
  reason,
  variant = "solid",
  children,
}: {
  href: string;
  disabled?: boolean;
  reason?: string;
  variant?: "solid" | "ghost";
  children: React.ReactNode;
}) {
  const cls =
    variant === "ghost"
      ? "text-ink-muted hover:text-ink"
      : "border border-black/[0.08] bg-surface text-ink-muted hover:bg-black/[0.03]";
  if (disabled)
    return (
      <span className="group relative inline-block">
        <span className="inline-flex items-center gap-1.5 cursor-not-allowed rounded-full border border-black/[0.05] px-3.5 py-1.5 text-sm font-semibold text-ink-faint/50">
          {children}
        </span>
        {reason && (
          <span className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-onyx px-2.5 py-1.5 text-xs font-medium text-[#f4f1ec] shadow-lg group-hover:block">
            {reason}
            <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-onyx" />
          </span>
        )}
      </span>
    );
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors", cls)}
    >
      {children}
    </Link>
  );
}
