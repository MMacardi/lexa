"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";

// Shows the account's plan and today's AI-action usage. During the closed beta
// everyone is Pro, so this reads "Pro · unlimited"; on the free plan it shows a
// little "used / limit" meter so the cap is never a surprise.
export function PlanUsage() {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { data } = useQuery({
    queryKey: ["ai-usage", accountId],
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
            "inline-flex items-center rounded-full px-3 py-1 text-[13px] font-semibold " +
            (pro ? "bg-sage text-white" : "bg-black/[0.06] text-ink-muted")
          }
        >
          {pro ? "★ Pro" : t("plan.free")}
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

      <p className="mt-3 text-[12px] leading-snug text-ink-faint">{t("plan.footnote")}</p>
    </section>
  );
}
