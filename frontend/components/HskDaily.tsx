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
import { TopicEditor } from "@/components/TopicEditor";
import { CEFR_FOR_HSK } from "@/components/HskFirstRun";
import { CalendarDays, Loader2, Pencil, Plus, Sparkles } from "lucide-react";

// Today's new words at the learner's level: a daily drip, not a one-off build.
// It replaced F11's "add more gap words" button — a learner shouldn't have to
// remember to ask; the words should just be there each morning ("I thought it
// would always give me some words for my level"). The server decides the day's
// set (hskDailyWords): target level first, the words tapped as unknown before
// that, `dailyGoal` of them, stable through the day.
//
// Beside them, a few words of a field the learner follows ("AI"), when they've
// named one (BACKLOG "Topic words beside the exam words"): the same card, the same
// taps, one "Add" — not a third place on Today that offers new words.
export function HskDaily() {
  const { accountId, profile } = useAccount();
  const { t } = useI18n();
  const { show, trackImport } = useToast();
  const qc = useQueryClient();
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editingTopic, setEditingTopic] = useState(false);
  const [refilling, setRefilling] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["hskDaily", accountId],
    queryFn: () => api.hskDaily(),
  });
  const { data: topicDay } = useQuery({
    queryKey: ["topicDaily", accountId],
    queryFn: () => api.topicDaily(),
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
  const topic = topicDay?.topic ?? null;
  const topicWords = topicDay?.words ?? [];
  const pending = data.words.filter((w) => !w.added);
  const topicPending = topicWords.filter((w) => !w.added);
  const toAdd = pending.filter((w) => !known.has(w.word));
  const topicToAdd = topicPending.filter((w) => !known.has(w.word));
  const addCount = toAdd.length + topicToAdd.length;
  const allTaken = pending.length === 0 && topicPending.length === 0;
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
      // the freed slots with other words and these never come back. A topic word
      // turned down is the same answer.
      if (known.size) {
        await api.savePlacement({ sourceLang: "zh", targetLang: native, level, known: [...known], unknown: [] });
      }
      if (addCount) {
        // Instant capture makes the HSK words reviewable at once; a topic word
        // brings its own meaning, so it is reviewable at once too. Details follow.
        const items = [
          ...toAdd.map((w) => ({ word: w.word })),
          ...topicToAdd.map((w) => ({ word: w.word, meaning: w.meaning })),
        ];
        const r = await api.batchAddWords({ telegramId: accountId, sourceLang: "zh", targetLang: native, items, level, enrich: true });
        const words = items.map((i) => i.word);
        if (r.job) trackImport({ jobId: r.job.id, telegramId: accountId, words, total: r.job.total, processed: 0 });
        show({ icon: "📚", title: t("hskDaily.added", { n: r.created }) });
      }
      setKnown(new Set());
      qc.invalidateQueries({ queryKey: ["hskDaily"] });
      qc.invalidateQueries({ queryKey: ["topicDaily"] });
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["hskReadiness"] });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  // The pool is used up: ask the model for the next words on the same topic.
  async function refill() {
    if (!topic || refilling) return;
    setRefilling(true);
    try {
      qc.setQueryData(["topicDaily", accountId], await api.setTopic(topic));
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setRefilling(false);
    }
  }

  const topicBlock = editingTopic ? (
    <TopicEditor current={topic} onDone={() => setEditingTopic(false)} />
  ) : topic ? (
    <div className="mt-4">
      <div className="flex items-center gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("topic.label", { topic })}</p>
        <button
          type="button"
          onClick={() => setEditingTopic(true)}
          aria-label={t("topic.change")}
          title={t("topic.change")}
          className="rounded-full p-1 text-ink-faint hover:bg-black/[0.04] hover:text-ink"
        >
          <Pencil className="h-3 w-3" />
        </button>
      </div>
      {topicWords.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {topicWords.map((w) => (
            <HskWordChip
              key={w.word}
              word={w.word}
              pinyin={w.pinyin}
              meaning={w.meaning}
              added={w.added}
              known={known.has(w.word)}
              onToggle={() => toggle(w.word)}
            />
          ))}
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-ink-soft">
          {t("topic.usedUp", { topic })}
          <button
            type="button"
            onClick={refill}
            disabled={refilling}
            className="inline-flex items-center gap-1 font-semibold text-sage-deep hover:text-sage disabled:opacity-60"
          >
            {refilling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("topic.more")}
          </button>
        </div>
      )}
    </div>
  ) : (
    <button
      type="button"
      onClick={() => setEditingTopic(true)}
      className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-sage-deep hover:text-sage"
    >
      <Plus className="h-3.5 w-3.5" /> {t("topic.offer")}
    </button>
  );

  return (
    <section id="daily" className="anim-fade-up scroll-mt-20 overflow-hidden rounded-[24px] border border-black/[0.06] bg-surface p-6">
      <div className="flex items-center gap-2 text-sage-deep">
        <CalendarDays className="h-5 w-5" />
        <h3 className="font-serif text-[20px] font-medium text-ink">{t("hskDaily.title", { level: levelName })}</h3>
      </div>

      {data.words.length === 0 ? (
        <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{t("hskDaily.empty", { level: levelName })}</p>
      ) : allTaken ? (
        <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
          {t("hskDaily.done", { n: data.words.length + topicWords.length })}
        </p>
      ) : (
        <p className="mt-1.5 max-w-[560px] text-[13px] leading-relaxed text-ink-soft">{t("hskDaily.sub", { n: data.size })}</p>
      )}

      {data.words.length > 0 && (
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
      )}

      {topicBlock}

      <div className="mt-4">
        {allTaken ? (
          (data.words.length > 0 || topicWords.length > 0) && (
            <Link
              href="/review?go=1"
              className="inline-flex h-10 items-center gap-2 rounded-full bg-sage px-4 text-[14px] font-semibold text-white transition-colors hover:bg-sage-deep"
            >
              <Sparkles className="h-4 w-4" /> {t("hskDaily.review")}
            </Link>
          )
        ) : (
          <Button disabled={busy || (addCount === 0 && known.size === 0)} onClick={take}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            {addCount ? t("hskDaily.add", { n: addCount }) : t("hskDaily.swap")}
          </Button>
        )}
      </div>
    </section>
  );
}
