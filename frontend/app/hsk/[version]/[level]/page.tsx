"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type HskListWord, type HskVersion } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { getNativeLang } from "@/lib/learnPrefs";
import { CEFR_FOR_HSK } from "@/components/HskFirstRun";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { cn } from "@/lib/utils";
import { CalendarDays, Check, Plus } from "lucide-react";

const PAGE = 120;

// One level of an official HSK list, read-only (BACKLOG "The official HSK lists
// as decks you can browse"). Two ways in from here: make this level the source of
// Today's words, or add single words — instant capture makes them cards at once.
export default function HskLevelPage() {
  const params = useParams<{ version: string; level: string }>();
  const version: HskVersion = params.version === "2.0" ? "2.0" : "3.0";
  const level = Number(params.level) || 1;
  const levelName = level === 7 ? "7–9" : String(level);

  const { accountId, profile, refresh } = useAccount();
  const { t } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const [onlyNew, setOnlyNew] = useState(false);
  const [visible, setVisible] = useState(PAGE);
  const [adding, setAdding] = useState<string | null>(null);
  const [savingDaily, setSavingDaily] = useState(false);

  const key = ["hskList", accountId, version, level];
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: key,
    queryFn: () => api.hskList(version, level),
  });

  const isDaily = profile?.hskVersion === version && profile?.hskTarget === level;
  const native = profile?.nativeLang ?? getNativeLang() ?? "ru";

  async function makeDaily() {
    setSavingDaily(true);
    try {
      await api.updateLearnerPrefs({ hskVersion: version, hskTarget: level });
      await refresh();
      qc.invalidateQueries({ queryKey: ["hskDaily"] });
      qc.invalidateQueries({ queryKey: ["hskReadiness"] });
      qc.invalidateQueries({ queryKey: ["hskLists"] });
      show({ icon: "🎯", title: t("hskList.madeDaily", { level: levelName }) });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setSavingDaily(false);
    }
  }

  async function add(w: HskListWord) {
    if (adding) return;
    setAdding(w.word);
    try {
      await api.addWord({ telegramId: accountId, word: w.word, sourceLang: "zh", targetLang: native, level: CEFR_FOR_HSK[level] });
      qc.setQueryData(key, (prev: typeof data) =>
        prev
          ? { ...prev, words: prev.words.map((x) => (x.word === w.word ? { ...x, card: true, status: x.status ?? ("learning" as const) } : x)) }
          : prev,
      );
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["hskLists"] });
      show({ icon: "📚", title: t("hskList.added", { word: w.word }) });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setAdding(null);
    }
  }

  const back = (
    <Link href="/collections" className="text-sm font-semibold text-ink-soft hover:text-ink">
      ← {t("nav.collections")}
    </Link>
  );

  if (isLoading)
    return (
      <div className="space-y-5">
        {back}
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-64 rounded-[20px]" />
      </div>
    );
  if (isError || !data)
    return (
      <div className="space-y-4">
        {back}
        <ErrorState message={errText(error, t)} onRetry={() => refetch()} />
      </div>
    );

  const have = data.words.filter((w) => w.status).length;
  const words = onlyNew ? data.words.filter((w) => !w.status) : data.words;
  const statusLabel = { canUse: t("hskList.canUse"), recognise: t("hskList.known"), learning: t("hskList.learning") };

  return (
    <div className="anim-fade-up space-y-6">
      {back}
      <div>
        <h1 className="font-serif text-[32px] font-semibold tracking-[-0.02em] text-ink sm:text-[40px]">HSK {levelName}</h1>
        <p className="mt-1 text-ink-soft">{t("hskList.meta", { v: version, n: data.words.length, have })}</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {isDaily ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sage-tint px-3 py-1.5 text-[13px] font-semibold text-sage-deep">
              <CalendarDays className="h-4 w-4" /> {t("hskList.isDaily")}
            </span>
          ) : (
            <Button onClick={makeDaily} disabled={savingDaily}>
              <CalendarDays className="mr-2 h-4 w-4" /> {t("hskList.makeDaily")}
            </Button>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink-soft">
            <input type="checkbox" checked={onlyNew} onChange={(e) => setOnlyNew(e.target.checked)} className="accent-sage" />
            {t("hskList.onlyNew")}
          </label>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {words.slice(0, visible).map((w) => (
          <div
            key={w.word}
            className={cn(
              "flex items-center gap-3 rounded-[12px] border px-3 py-2",
              w.status ? "border-sage/20 bg-sage-tint/30" : "border-black/[0.06] bg-surface",
            )}
          >
            <span className="min-w-0 flex-1">
              <span className="font-zh text-[17px] text-ink">{w.word}</span>
              <span className="ml-2 text-[12px] text-ink-faint">{w.pinyin}</span>
            </span>
            {w.status && (
              <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-sage-deep">
                <Check className="h-3.5 w-3.5" /> {statusLabel[w.status]}
              </span>
            )}
            {/* Known from the check but no card yet: it can still be taken. */}
            {!w.card && (
              <button
                type="button"
                onClick={() => add(w)}
                disabled={adding !== null}
                aria-label={t("hskList.add", { word: w.word })}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-black/[0.08] text-ink-muted transition-colors hover:border-sage hover:bg-sage-tint hover:text-sage-deep disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
      {words.length > visible && (
        <Button variant="outline" onClick={() => setVisible((v) => v + PAGE)}>
          {t("hskList.more", { n: Math.min(PAGE, words.length - visible) })}
        </Button>
      )}
    </div>
  );
}
