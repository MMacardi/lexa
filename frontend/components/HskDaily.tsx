"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { getNativeLang } from "@/lib/learnPrefs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { HskWordChip } from "@/components/HskWordChip";
import { CEFR_FOR_HSK } from "@/components/HskFirstRun";
import { CalendarDays, Loader2, Plus, Sparkles } from "lucide-react";

// Today's new words at the learner's level: a daily drip, not a one-off build.
// It replaced F11's "add more gap words" button — a learner shouldn't have to
// remember to ask; the words should just be there each morning ("I thought it
// would always give me some words for my level"). The server decides the day's
// set (hskDailyWords): target level first, the words tapped as unknown before
// that, `dailyGoal` of them, stable through the day.
export function HskDaily() {
  const { accountId, profile } = useAccount();
  const { t } = useI18n();
  const { show, trackImport } = useToast();
  const qc = useQueryClient();
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["hskDaily", accountId],
    queryFn: () => api.hskDaily(),
  });

  if (isLoading)
    return (
      <section id="daily" className="scroll-mt-20 rounded-[24px] border border-black/[0.06] bg-surface p-6">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-4 h-14 w-full rounded-[14px]" />
      </section>
    );
  if (!data) return null;

  const levelName = data.level === 7 ? "7–9" : String(data.level);
  const pending = data.words.filter((w) => !w.added);
  const toAdd = pending.filter((w) => !known.has(w.word));
  const native = profile?.nativeLang ?? getNativeLang() ?? "ru";

  function toggle(word: string) {
    setKnown((prev) => {
      const next = new Set(prev);
      if (next.has(word)) next.delete(word);
      else next.add(word);
      return next;
    });
  }

  async function take() {
    if (busy || !data) return;
    setBusy(true);
    try {
      const level = CEFR_FOR_HSK[data.level];
      // "I know it" first: saved as a placement answer, so the next fetch fills
      // the freed slots with other words and these never come back.
      if (known.size) {
        await api.savePlacement({ sourceLang: "zh", targetLang: native, level, known: [...known], unknown: [] });
      }
      if (toAdd.length) {
        const words = toAdd.map((w) => w.word);
        // Instant capture makes these reviewable at once; the Russian follows.
        const r = await api.batchAddWords({ telegramId: accountId, sourceLang: "zh", targetLang: native, words, level, enrich: true });
        if (r.job) trackImport({ jobId: r.job.id, telegramId: accountId, words, total: r.job.total, processed: 0 });
        show({ icon: "📚", title: t("hskDaily.added", { n: r.created }) });
      }
      setKnown(new Set());
      qc.invalidateQueries({ queryKey: ["hskDaily"] });
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["hskReadiness"] });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="daily" className="anim-fade-up scroll-mt-20 overflow-hidden rounded-[24px] border border-black/[0.06] bg-surface p-6">
      <div className="flex items-center gap-2 text-sage-deep">
        <CalendarDays className="h-5 w-5" />
        <h3 className="font-serif text-[20px] font-medium text-ink">{t("hskDaily.title", { level: levelName })}</h3>
      </div>

      {data.words.length === 0 ? (
        <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{t("hskDaily.empty", { level: levelName })}</p>
      ) : pending.length === 0 ? (
        <>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{t("hskDaily.done", { n: data.words.length })}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.words.map((w) => (
              <HskWordChip key={w.word} word={w.word} pinyin={w.pinyin} level={w.level} added />
            ))}
          </div>
          <Link
            href="/review"
            className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-sage px-4 text-[14px] font-semibold text-white transition-colors hover:bg-sage-deep"
          >
            <Sparkles className="h-4 w-4" /> {t("hskDaily.review")}
          </Link>
        </>
      ) : (
        <>
          <p className="mt-1.5 max-w-[560px] text-[13px] leading-relaxed text-ink-soft">{t("hskDaily.sub", { n: data.size })}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {data.words.map((w) => (
              <HskWordChip
                key={w.word}
                word={w.word}
                pinyin={w.pinyin}
                level={w.level}
                added={w.added}
                known={known.has(w.word)}
                onToggle={() => toggle(w.word)}
              />
            ))}
          </div>
          <div className="mt-4">
            <Button disabled={busy || (toAdd.length === 0 && known.size === 0)} onClick={take}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              {toAdd.length ? t("hskDaily.add", { n: toAdd.length }) : t("hskDaily.swap")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
