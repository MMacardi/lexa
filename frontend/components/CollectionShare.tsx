"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Copy, Globe, KeyRound, Lock, Users, type LucideIcon } from "lucide-react";
import { api, type Collection, type Folder, type Visibility } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { Select } from "@/components/ui/Select";
import { Segmented } from "@/components/ui/Segmented";
import { FOCUS } from "@/lib/focus";

export const VISIBILITY_ICON: Record<Visibility, LucideIcon> = {
  private: Lock,
  friends: Users,
  code: KeyRound,
  public: Globe,
};
const ALL_MODES: Visibility[] = ["private", "friends", "code", "public"];

/** Owner panel on a collection card: who can see it, its share link, its folder. */
export function CollectionShare({
  collection,
  folders,
  onChanged,
}: {
  collection: Collection;
  folders: Folder[];
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const visibility = collection.visibility ?? "private";
  // "Public" means listed in Community, which the focus pass keeps hidden — so it
  // isn't offered there, unless a deck already is public and has to show as such.
  const modes = ALL_MODES.filter((m) => !FOCUS || m !== "public" || visibility === "public");

  const update = useMutation({
    mutationFn: (patch: { visibility?: Visibility; folderId?: string | null }) => api.updateCollection(collection.id, patch),
    onSuccess: onChanged,
  });

  const link =
    collection.shareCode && typeof window !== "undefined"
      ? `${window.location.origin}/community/${collection.id}?code=${collection.shareCode}`
      : null;

  return (
    <div className="mt-3 space-y-3 rounded-[14px] border border-black/[0.06] bg-paper/60 p-3">
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("share.whoCanSee")}</p>
        <Segmented
          grid
          tone="chips"
          className={modes.length === 4 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}
          itemClassName="px-2.5"
          value={visibility}
          // one change at a time: a second tap mid-save is ignored, not queued
          onChange={(m) => !update.isPending && m !== visibility && update.mutate({ visibility: m })}
          options={modes.map((m) => ({
            value: m,
            label: t(`share.${m}`),
            Icon: VISIBILITY_ICON[m],
            disabled: m === "public" && collection.delisted,
          }))}
        />
        <p className="mt-1.5 text-[12px] text-ink-soft">{t(`share.${visibility}Hint`)}</p>
        {collection.delisted && <p className="mt-1 text-[12px] font-medium text-warn-text">{t("share.delistedNote")}</p>}
      </div>

      {visibility !== "private" && link && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg bg-surface px-2.5 py-1 font-mono text-sm font-semibold tracking-wider text-ink">
            {collection.shareCode}
          </span>
          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard blocked — the code is still visible */
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3 py-1 text-[13px] font-semibold text-ink-muted hover:bg-black/[0.03]"
          >
            <Copy className="h-3.5 w-3.5" /> {copied ? t("share.copied") : t("share.copyLink")}
          </button>
          {visibility === "friends" && <span className="text-[12px] text-ink-faint">{t("share.friendsLinkNote")}</span>}
        </div>
      )}

      {folders.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-medium text-ink-soft">{t("folder.label")}</span>
          <Select
            value={collection.folderId ?? ""}
            onChange={(v) => update.mutate({ folderId: v || null })}
            options={[{ value: "", label: t("folder.none") }, ...folders.map((f) => ({ value: f.id, label: f.name }))]}
            ariaLabel={t("folder.label")}
            className="h-8 min-w-[160px]"
          />
        </div>
      )}
      {update.isError && <p className="text-sm font-medium text-warn-text">{errText(update.error, t)}</p>}
    </div>
  );
}
