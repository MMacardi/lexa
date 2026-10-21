"use client";

import Link from "next/link";
import { Brain } from "lucide-react";
import { useI18n } from "@/lib/i18n";

export function MikaMemoryLink({ lang, compact = false, onClick }: { lang: string; compact?: boolean; onClick?: () => void }) {
  const { t } = useI18n();
  return (
    <Link
      href={`/account?memoryLang=${encodeURIComponent(lang)}#mika-memory`}
      onClick={onClick}
      aria-label={t("coachmem.title")}
      title={t("coachmem.title")}
      className={`inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full text-ink-muted hover:bg-black/[0.04] hover:text-ink ${compact ? "h-11 w-11" : "h-8 px-2.5 text-[12px] font-semibold"}`}
    >
      <Brain className="h-4 w-4" />
      {!compact && <span>{t("coachmem.link")}</span>}
    </Link>
  );
}
