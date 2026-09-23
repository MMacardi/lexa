"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type HskVersion } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { GraduationCap } from "lucide-react";

// The readiness mark: how much of the official HSK list the learner recognises,
// and how much of it they can actually use. Deliberately two numbers — the gap
// between them is the product. It is vocabulary coverage and says so in the
// subtitle: predicting an exam score off it would be a lie we can't calibrate.

const LEVELS: Record<HskVersion, number[]> = {
  "2.0": [1, 2, 3, 4, 5, 6],
  "3.0": [1, 2, 3, 4, 5, 6, 7],
};

export function HskReadiness() {
  const { accountId, profile } = useAccount();
  const { t } = useI18n();
  const qc = useQueryClient();

  // The server resolves the goal (query → saved goal → a sane default), so the
  // response is also what the pickers show: no second source of truth.
  const { data, isLoading } = useQuery({
    queryKey: ["hskReadiness", accountId],
    queryFn: () => api.hskReadiness(),
  });
  const { data: stats } = useQuery({
    queryKey: ["stats", accountId],
    queryFn: () => api.stats(accountId),
  });

  // Chinese only — an English learner has no use for an HSK mark. But the track
  // is a choice on the account, not something inferred from the cards you happen
  // to hold (F11): gating on Chinese cards alone made this a closed loop, since
  // the only screen that handed out Chinese cards needed an empty account to
  // appear. A saved target is the learner saying "I am on this track".
  const studiesChinese = stats?.languages.includes("zh") ?? false;
  const onTrack = profile?.hskTarget != null;

  const pick = async (version: HskVersion, level: number) => {
    const next = await api.hskReadiness(version, level);
    qc.setQueryData(["hskReadiness", accountId], next);
    // Remember the goal on the account, not in this tab: the bot and the next
    // device have to open on the same target. Today's words follow it.
    await api.updateLearnerPrefs({ hskVersion: version, hskTarget: level }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["hskDaily"] });
  };

  if (isLoading)
    return (
      <section className="anim-fade-up overflow-hidden rounded-[24px] border border-black/[0.06] bg-surface p-6">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="mt-3 h-4 w-72" />
        <Skeleton className="mt-6 h-4 w-full rounded-full" />
      </section>
    );

  if (!data || (!studiesChinese && !onTrack)) return null;

  const { total, recognise, canUse, learning } = data;
  const pctRecognise = total ? (recognise / total) * 100 : 0;
  const pctCanUse = total ? (canUse / total) * 100 : 0;
  const pctLearning = total ? (learning / total) * 100 : 0;
  const levelName = (n: number) => (n === 7 ? t("hsk.band79") : t("hsk.level", { n }));

  return (
    <section className="anim-fade-up overflow-hidden rounded-[24px] border border-black/[0.06] bg-surface p-6">
      <div className="flex items-center gap-2">
        <h3 className="font-serif text-[22px] font-medium text-ink">{t("hsk.title")}</h3>
        <GraduationCap className="h-5 w-5 text-ink-faint" />
      </div>
      <p className="mt-1 text-[13px] text-ink-faint">{t("hsk.subtitle")}</p>

      {/* the mark */}
      <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="font-serif text-[34px] font-bold leading-none text-ink">{recognise}</span>
        <span className="text-[15px] text-ink-soft">
          {t("hsk.ofTotal", { a: recognise, b: total, n: data.level === 7 ? "7–9" : data.level })}
        </span>
      </div>
      <p className="mt-1 text-[15px] font-medium text-sage-deep">{t("hsk.canUseOf", { a: canUse })}</p>

      {/* recognise / can use / learning, in one track */}
      <div className="mt-4 flex h-3 w-full overflow-hidden rounded-full bg-track">
        <div className="bg-sage-deep" style={{ width: `${pctCanUse}%` }} />
        <div className="bg-sage" style={{ width: `${pctRecognise - pctCanUse}%` }} />
        <div className="bg-sage-tint" style={{ width: `${pctLearning}%` }} />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-faint">
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-sage-deep" />
          {t("hsk.canUse")} {canUse}
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-sage" />
          {t("hsk.recognise")} {recognise}
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-2 w-2 rounded-full bg-sage-tint" />
          {t("hsk.gapWords", { n: data.gap })}
        </span>
      </div>

      {/* which list, and how far up it */}
      <div className="mt-6 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
            {t("hsk.list")}
          </span>
          {(["2.0", "3.0"] as HskVersion[]).map((v) => (
            <button
              key={v}
              onClick={() => pick(v, Math.min(data.level, LEVELS[v].length))}
              className={`rounded-full px-3 py-1 text-[13px] font-semibold transition ${
                data.version === v ? "bg-sage text-white" : "bg-paper text-ink-muted hover:bg-black/[0.04]"
              }`}
            >
              {v === "2.0" ? t("hsk.list2") : t("hsk.list3")}
            </button>
          ))}
        </div>
        <p className="text-[12px] text-ink-faint">{t("hsk.listHint")}</p>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
            {t("hsk.target")}
          </span>
          {LEVELS[data.version].map((n) => (
            <button
              key={n}
              onClick={() => pick(data.version, n)}
              className={`rounded-full px-3 py-1 text-[13px] font-semibold transition ${
                data.level === n ? "bg-sage text-white" : "bg-paper text-ink-muted hover:bg-black/[0.04]"
              }`}
            >
              {n === 7 ? "7–9" : n}
            </button>
          ))}
        </div>
      </div>

      {/* the ladder, so the target is a choice and not a guess */}
      <div className="mt-6">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
          {t("hsk.byLevel")}
        </p>
        <div className="space-y-1.5">
          {data.levels.map((l) => {
            const pct = l.total ? (l.recognise / l.total) * 100 : 0;
            return (
              <div
                key={l.level}
                className={`flex items-center gap-3 rounded-[12px] px-2 py-1.5 ${
                  l.level <= data.level ? "bg-paper" : ""
                }`}
              >
                <span className="w-[58px] shrink-0 text-[12px] font-semibold text-ink-soft">
                  {levelName(l.level)}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-track">
                  <span className="block h-full bg-sage" style={{ width: `${pct}%` }} />
                </span>
                <span className="shrink-0 text-[11px] text-ink-faint">
                  {t("hsk.levelRow", { a: l.recognise, b: l.total, c: l.canUse })}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {recognise === 0 && learning === 0 && (
        <p className="mt-4 text-[13px] text-ink-soft">{t("hsk.empty")}</p>
      )}
    </section>
  );
}
