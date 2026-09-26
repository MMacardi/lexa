"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type Collection, type Folder, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { X, Pencil, GraduationCap, Target, FolderPlus, FolderOpen, Share2, Globe, Zap } from "lucide-react";
import { CollectionShare, VISIBILITY_ICON } from "@/components/CollectionShare";
import { useDialog } from "@/lib/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { FOCUS } from "@/lib/focus";
import { HskLists } from "@/components/HskLists";

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
  const { data: folders } = useQuery({
    queryKey: ["folders", accountId],
    queryFn: () => api.folders(),
  });
  const { prompt, confirm } = useDialog();
  const [folderError, setFolderError] = useState<string | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["collections"] });
    qc.invalidateQueries({ queryKey: ["words"] });
    qc.invalidateQueries({ queryKey: ["folders"] });
  };
  const folderDone = {
    onSuccess: () => {
      setFolderError(null);
      invalidate();
    },
    onError: (e: unknown) => setFolderError((e as Error).message),
  };
  const newFolder = useMutation({ mutationFn: (n: string) => api.createFolder(n), ...folderDone });
  const renameFolder = useMutation({
    mutationFn: ({ id, n }: { id: string; n: string }) => api.renameFolder(id, n),
    ...folderDone,
  });
  const removeFolder = useMutation({ mutationFn: (id: string) => api.deleteFolder(id), onSuccess: invalidate });

  async function askNewFolder() {
    const n = await prompt({ title: t("folder.newTitle"), placeholder: t("folder.namePlaceholder"), confirmLabel: t("col.create") });
    if (n?.trim()) newFolder.mutate(n.trim().slice(0, 60));
  }

  const create = useMutation({
    mutationFn: () => api.createCollection(name.trim(), accountId),
    onSuccess: () => {
      setName("");
      invalidate();
    },
  });

  const wordsByColl = (id: string) =>
    (words ?? []).filter((w) => (w.collections ?? []).some((c) => c.id === id));
  const folderIds = new Set((folders ?? []).map((f) => f.id));

  const grid = (cols: Collection[]) => (
    <div className="grid gap-4 sm:grid-cols-2">
      {cols.map((c) => (
        <CollectionCard key={c.id} collection={c} words={wordsByColl(c.id)} folders={folders ?? []} onChanged={invalidate} />
      ))}
    </div>
  );

  return (
    <div className="space-y-7">
      <div className="anim-fade-up">
        <h1 className="font-serif text-[28px] font-medium break-words sm:text-[34px] tracking-[-0.01em] text-ink">{t("nav.collections")}</h1>
        <p className="mt-1.5 text-ink-soft">{t("col.pageSubtitle")}</p>
      </div>

      {/* the official lists: read-only decks every HSK learner expects to find */}
      <HskLists />

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
        <Button type="button" variant="outline" onClick={askNewFolder} className="shrink-0">
          <FolderPlus className="h-4 w-4" /> {t("folder.new")}
        </Button>
        {create.isError && (
          <p className="w-full text-sm font-medium text-warn-text">{(create.error as Error).message}</p>
        )}
        {folderError && <p className="w-full text-sm font-medium text-warn-text">{folderError}</p>}
      </form>

      {!FOCUS && (
        <Link
          href="/community"
          className="anim-fade-up flex items-center gap-3 rounded-[18px] border border-sage/30 bg-sage-tint/40 px-4 py-3 text-sm text-sage-deep transition-colors hover:bg-sage-tint"
        >
          <Globe className="h-5 w-5 shrink-0" />
          <span className="flex-1">{t("community.promo")}</span>
          <span className="font-semibold">→</span>
        </Link>
      )}

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

      {collections && collections.length > 0 && grid(collections.filter((c) => !c.folderId || !folderIds.has(c.folderId)))}

      {(folders ?? []).map((f) => {
        const inFolder = (collections ?? []).filter((c) => c.folderId === f.id);
        return (
          <section key={f.id} className="space-y-3">
            <div className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-sage-deep" />
              <h2 className="font-serif text-[22px] font-semibold text-ink">{f.name}</h2>
              <span className="text-[13px] font-medium text-ink-faint">{t("folder.nSets", { n: inFolder.length })}</span>
              <button
                onClick={async () => {
                  const n = await prompt({ title: t("folder.renameTitle"), defaultValue: f.name, confirmLabel: t("common.save") });
                  if (n?.trim() && n.trim() !== f.name) renameFolder.mutate({ id: f.id, n: n.trim().slice(0, 60) });
                }}
                aria-label={t("folder.renameTitle")}
                className="rounded-lg p-1.5 text-ink-faint hover:bg-black/[0.04]"
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={async () => {
                  if (
                    await confirm({
                      title: t("folder.deleteTitle"),
                      message: t("folder.deleteConfirm", { name: f.name }),
                      confirmLabel: t("common.delete"),
                      tone: "danger",
                    })
                  )
                    removeFolder.mutate(f.id);
                }}
                aria-label={t("folder.deleteTitle")}
                className="rounded-lg p-1.5 text-ink-faint hover:bg-black/[0.04] hover:text-warn-text"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {inFolder.length === 0 ? (
              <p className="rounded-[16px] border border-dashed border-black/[0.12] bg-surface/60 p-5 text-center text-sm text-ink-soft">
                {t("folder.empty")}
              </p>
            ) : (
              grid(inFolder)
            )}
          </section>
        );
      })}
    </div>
  );
}

function CollectionCard({
  collection,
  words,
  folders,
  onChanged,
}: {
  collection: Collection;
  words: Word[];
  folders: Folder[];
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const { confirm } = useDialog();
  const [editing, setEditing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const visibility = collection.visibility ?? "private";
  const VisIcon = VISIBILITY_ICON[visibility];
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
              <p className="flex flex-wrap items-center gap-x-2 text-[13px] font-medium text-ink-soft">
                <span>{count === 1 ? t("col.word", { n: count }) : t("col.words", { n: count })}</span>
                {visibility !== "private" && (
                  <span className="inline-flex items-center gap-1 text-sage-deep">
                    <VisIcon className="h-3.5 w-3.5" /> {t(`share.${visibility}`)}
                  </span>
                )}
                {!!collection.learners && <span className="text-ink-faint">{t("community.addedBy", { n: collection.learners })}</span>}
              </p>
              {collection.copiedFrom && (
                <p className="text-[12px] text-ink-faint">
                  {t("community.creditFrom")}{" "}
                  {t("community.credit", { author: collection.copiedFrom.author, deck: collection.copiedFrom.deck })}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {/* publishing a set is the other half of Community, so it waits with it (F7) */}
              {!FOCUS && (
                <button
                  onClick={() => setSharing((v) => !v)}
                  aria-label={t("share.title")}
                  title={t("share.title")}
                  className={cn("rounded-lg p-1.5 hover:bg-black/[0.04]", sharing ? "text-sage-deep" : "text-ink-faint")}
                >
                  <Share2 className="h-4 w-4" />
                </button>
              )}
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

      {sharing && <CollectionShare collection={collection} folders={folders} onChanged={onChanged} />}

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
        <Action href={`/quiz?coll=${collection.id}&cram=1`} disabled={count < 1} reason={t("col.needWords")}>
          <Zap className="h-4 w-4" /> {t("quiz.cram")}
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
