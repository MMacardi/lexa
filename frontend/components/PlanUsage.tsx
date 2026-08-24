"use client";

import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { getSimulateFree, setSimulateFree, useSimulateFree } from "@/lib/learnPrefs";
import { cn } from "@/lib/utils";
import { Star } from "lucide-react";

// Shows the account's plan and today's AI-action usage. During the closed beta
// everyone is Pro, so this reads "Pro · unlimited"; on the free plan it shows a
// little "used / limit" meter so the cap is never a surprise.
export function PlanUsage() {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const qc = useQueryClient();
  const simFree = useSimulateFree();
  const { data } = useQuery({
    queryKey: ["ai-usage", accountId, simFree],
    queryFn: () => api.aiUsage(accountId),
    staleTime: 60_000,
  });

  const pro = data?.pro ?? true;
  const used = data?.used ?? 0;
  const limit = data?.limit ?? 0;
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return (
    <section className="rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">{t("plan.title")}</h2>

      <div className="mt-3 flex items-center gap-2">
        <span
          className={
            "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[13px] font-semibold " +
            (pro ? "bg-sage text-white" : "bg-black/[0.06] text-ink-muted")
          }
        >
          {pro ? (
            <>
              <Star className="h-3.5 w-3.5 fill-current" /> Pro
            </>
          ) : (
            t("plan.free")
          )}
        </span>
        <span className="text-[13px] text-ink-soft">
          {pro ? t("plan.proHint") : t("plan.usedToday", { used, limit })}
        </span>
      </div>

      {!pro && limit > 0 && (
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-black/[0.06]">
          <div
            className={"h-full rounded-full transition-all " + (pct >= 100 ? "bg-warn" : "bg-sage")}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] leading-snug text-ink-faint">{t("plan.footnote")}</p>
        <Link
          href="/pro"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors",
            pro
              ? "text-sage-deep hover:bg-sage-tint/50"
              : "bg-sage text-white hover:bg-sage-deep",
          )}
        >
          <Star className={cn("h-3.5 w-3.5", pro && "fill-current")} /> {pro ? t("pro.aboutLink") : t("pro.cta")}
        </Link>
      </div>

      {/* Testing: pretend to be free-tier to preview the caps. Shown while Pro or
          while the simulation is on (a genuine free user has nothing to toggle). */}
      {(pro || simFree) && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-dashed border-black/[0.12] bg-paper/50 p-3">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-ink">{t("plan.simTitle")}</div>
            <div className="text-[12px] leading-snug text-ink-faint">{t("plan.simHint")}</div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={simFree}
            onClick={() => {
              setSimulateFree(!getSimulateFree());
              qc.invalidateQueries({ queryKey: ["ai-usage"] });
            }}
            className={cn(
              "inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors",
              simFree ? "bg-sage" : "bg-black/[0.15]",
            )}
          >
            <span
              className={cn(
                "h-5 w-5 rounded-full bg-white shadow transition-transform",
                simFree ? "translate-x-5" : "translate-x-0",
              )}
            />
          </button>
        </div>
      )}
    </section>
  );
}
