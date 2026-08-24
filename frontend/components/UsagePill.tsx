"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useSimulateFree } from "@/lib/learnPrefs";
import { cn } from "@/lib/utils";
import { Sprout } from "lucide-react";

// Compact "AI actions left today" meter for free users, so the daily limit is
// always visible (not buried in Account). Hidden for Pro (unlimited). Tapping it
// opens the Pro screen. Shares the plan/usage query and honours the test toggle.
export function UsagePill({ className }: { className?: string }) {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const simFree = useSimulateFree();
  const { data } = useQuery({
    queryKey: ["ai-usage", accountId, simFree],
    queryFn: () => api.aiUsage(accountId),
    staleTime: 30_000,
  });
  if (!data || data.pro) return null; // Pro = unlimited → no meter
  const { used, limit } = data;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const low = limit - used <= 3;
  return (
    <Link
      href="/pro"
      className={cn("block rounded-[12px] border border-black/[0.07] bg-surface px-3 py-2 transition-colors hover:border-sage/40", className)}
    >
      <div className="flex items-center justify-between gap-2 text-[12px] font-semibold">
        <span className="inline-flex items-center gap-1 text-ink-muted">
          <Sprout className="h-3.5 w-3.5 text-sage" /> {t("usage.today")}
        </span>
        <span className={cn("tabular-nums", low ? "text-warn-text" : "text-ink-soft")}>
          {used}/{limit}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black/[0.06]">
        <div className={cn("h-full rounded-full", pct >= 100 ? "bg-warn" : "bg-sage")} style={{ width: `${pct}%` }} />
      </div>
    </Link>
  );
}
