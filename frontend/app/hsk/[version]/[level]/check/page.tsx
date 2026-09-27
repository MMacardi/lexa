"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type CheckResult, type HskVersion } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { getNativeLang } from "@/lib/learnPrefs";
import { CEFR_FOR_HSK } from "@/components/HskFirstRun";
import { CheckSummary, HskCheck } from "@/components/HskCheck";
import { Skeleton } from "@/components/ui/skeleton";

// "Check again" (BACKLOG "An adaptive check that catches overclaiming"): the
// onboarding's check, for an account that already has a target — the onboarding
// never runs twice, so without this page nobody past it could take the check
// with made-up words, and scripts/check-placement-holdout.ts had nothing to score.
//
// It starts where the current estimate stops being mostly known (the lowest
// level up to the target under 70%), asks only words with no card and no answer
// yet — the ones the estimate is stretched over — and saves at the end, as the
// onboarding does. The mark and the plan then read it like any other answers.
export default function CheckAgainPage() {
  const params = useParams<{ version: string; level: string }>();
  const version: HskVersion = params.version === "2.0" ? "2.0" : "3.0";
  const level = Number(params.level) || 4;
  const levelName = level === 7 ? "7–9" : String(level);

  const { accountId, profile } = useAccount();
  const { t } = useI18n();
  const qc = useQueryClient();
  const native = profile?.nativeLang ?? getNativeLang() ?? "ru";
  const [result, setResult] = useState<CheckResult | null>(null);

  const { data: mark, isLoading } = useQuery({
    queryKey: ["hskReadiness", accountId, version, level],
    queryFn: () => api.hskReadiness(version, level),
  });
  // Read once, before the check changes it: where the first screen comes from.
  const [claimed, setClaimed] = useState<number | null>(null);
  if (claimed === null && mark) {
    const under = mark.levels.find((l) => l.level <= level && l.total > 0 && Math.max(l.estimate, l.recognise) / l.total < 0.7);
    setClaimed(under?.level ?? level);
  }

  async function save(r: CheckResult) {
    await api.savePlacement({
      sourceLang: "zh",
      targetLang: native,
      level: CEFR_FOR_HSK[level],
      known: r.known,
      unknown: r.unknown,
      fakes: { known: r.fakeKnown, unknown: r.fakeUnknown },
    });
    for (const key of ["hskReadiness", "hskPlan", "hskDaily", "hskLists", "hskList"]) qc.invalidateQueries({ queryKey: [key] });
    setResult(r);
    window.scrollTo({ top: 0 });
  }

  const back = (
    <Link href="/" className="text-sm font-semibold text-ink-soft hover:text-ink">
      ← {t("nav.today")}
    </Link>
  );

  if (result)
    return (
      <div className="anim-fade-up space-y-4">
        {back}
        <h1 className="font-serif text-[28px] font-semibold tracking-[-0.02em] text-ink sm:text-[34px]">{t("check.againDone")}</h1>
        <CheckSummary
          result={result}
          estimate={mark ? { known: mark.estimate, total: mark.total } : null}
          account
          levelName={levelName}
          sweepHref={`/hsk/${version}/${level}/sweep`}
        />
        <Link
          href="/"
          className="inline-flex h-11 items-center rounded-full bg-sage px-5 text-[15px] font-semibold text-white transition-colors hover:bg-sage-deep"
        >
          {t("sweep.toToday")}
        </Link>
      </div>
    );

  return (
    <div className="space-y-4">
      {back}
      <div>
        <h1 className="font-serif text-[28px] font-semibold tracking-[-0.02em] text-ink sm:text-[34px]">{t("hskFirst.tapTitle")}</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{t("hskFirst.tapSub")}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">{t("check.againNote", { level: levelName })}</p>
      </div>
      {isLoading || claimed === null ? (
        <Skeleton className="h-32 rounded-[16px]" />
      ) : (
        <HskCheck
          version={version}
          target={level}
          claimed={claimed}
          native={native}
          onResult={save}
        />
      )}
    </div>
  );
}
