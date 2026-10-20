"use client";

import type { ReaderLevelSource } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { isChineseLang } from "@/lib/dictEntry";
import { cn } from "@/lib/utils";

// Legacy Chinese metadata has unknown provenance: preserve it, but never present
// it as the current full-text vocabulary estimate or as a confirmed manual pick.
export function ReaderLevelBadge({ level, levelSource, sourceLang, className }: {
  level?: string | null; levelSource?: ReaderLevelSource | null; sourceLang?: string | null; className?: string;
}) {
  const { t } = useI18n();
  if (!level) return null;
  const label = isChineseLang(sourceLang ?? "")
    ? t(levelSource === "manual" ? "reader.manualLevel" : levelSource === "requested" ? "reader.requestedLevel" : "reader.savedLevel", { level })
    : `~${level}`;
  return <span title={label} className={cn("rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-semibold text-sage-deep", className)}>{label}</span>;
}
