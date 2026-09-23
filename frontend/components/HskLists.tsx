"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api, type HskVersion } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { GraduationCap } from "lucide-react";

// The official HSK lists as decks you can browse — every HSK app has "HSK 1–6,
// add them", and without it the app looks empty. Read-only: the lists are data
// (services/hsk.ts), not collections anyone edits. The per-level counts come off
// the readiness endpoint, which already has them.
export function HskLists() {
  const { accountId, profile } = useAccount();
  const { t } = useI18n();
  const [version, setVersion] = useState<HskVersion>(profile?.hskVersion ?? "3.0");

  const { data } = useQuery({
    queryKey: ["hskLists", accountId, version],
    queryFn: () => api.hskReadiness(version),
  });

  return (
    <section className="anim-fade-up rounded-[20px] border border-black/[0.06] bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <GraduationCap className="h-5 w-5 text-sage-deep" />
        <h2 className="font-serif text-[20px] font-medium text-ink">{t("hskList.title")}</h2>
        <div className="ml-auto flex gap-1.5">
          {(["3.0", "2.0"] as HskVersion[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVersion(v)}
              aria-pressed={v === version}
              className={cn(
                "rounded-full px-3 py-1 text-[13px] font-semibold transition",
                v === version ? "bg-sage text-white" : "bg-paper text-ink-muted hover:bg-black/[0.04]",
              )}
            >
              {v === "2.0" ? t("hsk.list2") : t("hsk.list3")}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{t("hskList.sub")}</p>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {(data?.levels ?? []).map((l) => {
          const daily = profile?.hskVersion === version && profile?.hskTarget === l.level;
          return (
            <Link
              key={l.level}
              href={`/hsk/${version}/${l.level}`}
              className="rounded-[14px] border border-black/[0.06] bg-paper px-3 py-2.5 transition-colors hover:border-sage/40 hover:bg-sage-tint/40"
            >
              <span className="block font-serif text-[18px] font-medium text-ink">HSK {l.level === 7 ? "7–9" : l.level}</span>
              <span className="block text-[12px] text-ink-faint">{t("hskList.words", { n: l.total })}</span>
              <span className="block text-[12px] text-ink-soft">{t("hskList.yours", { n: l.recognise + l.learning })}</span>
              {daily && (
                <span className="mt-1 inline-block rounded-full bg-sage-tint px-2 py-0.5 text-[10px] font-semibold text-sage-deep">
                  {t("hskList.dailyTag")}
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
