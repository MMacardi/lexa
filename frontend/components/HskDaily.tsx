"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { ExamPlan, PlanLine } from "@/components/ExamPlan";
import { ArrowRight, BookOpen, CalendarDays, Loader2, Pencil, Plus, Sparkles } from "lucide-react";

// The texts written for a field today, so a second tap opens the same one: { "2026-10-15|ИИ": id }.
const READS_KEY = "lexa.topicReads";
const today = () => new Date().toLocaleDateString("sv");
function readsToday(): Record<string, string> {
  try {
    const all = JSON.parse(localStorage.getItem(READS_KEY) ?? "{}") as Record<string, string>;
    return Object.fromEntries(Object.entries(all).filter(([k]) => k.startsWith(`${today()}|`)));
  } catch {
    return {};
  }
}

// Today's new words at the learner's level: a daily drip, not a one-off build.
// It replaced F11's "add more gap words" button — a learner shouldn't have to
// remember to ask; the words should just be there each morning ("I thought it
// would always give me some words for my level"). The server decides the day's
// set (hskDailyWords): `dailyGoal` words from the top of the frontier as one group,
// named after its situation ("Сегодня: офис · 5 слов"), stable through the day.
//
// Beside them, a few words of a field the learner follows (BACKLOG "Topic words
// beside the exam words"): the same card, the same taps, one "Add" — not a third
// place on Today that offers new words. The fields are the interests they picked
// in onboarding, without asking again ("Your field without asking again"), the
// day's three going round them; the pencil picks others.
export function HskDaily() {
  const { accountId, profile } = useAccount();
  const { t } = useI18n();
  const { show, startAdd } = useToast();
  const qc = useQueryClient();
  const [known, setKnown] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [editingTopic, setEditingTopic] = useState(false);
  const [writing, setWriting] = useState<string | null>(null);
  const router = useRouter();
  const [refilling, setRefilling] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["hskDaily", accountId],
    queryFn: () => api.hskDaily(),
  });
  const { data: topicDay, isLoading: topicLoading } = useQuery({
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
  const topicsOn = !!topicDay?.on && topicDay.topics.length > 0;
  const topicWords = topicsOn ? topicDay!.words : [];
  // The row is named after the fields today's words come from, not all of them.
  const topic = topicsOn ? [...new Set(topicWords.map((w) => w.topic))].join(", ") || topicDay!.topics.join(", ") : null;
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
    // Instant capture makes the HSK words reviewable at once; a topic word
    // brings its own meaning, so it is reviewable at once too. Details follow.
    // The bar says they're on their way from the tap, so a slow answer isn't a dead button.
    const adding = addCount ? startAdd([...toAdd, ...topicToAdd].map((w) => w.word)) : null;
    try {
      const level = CEFR_FOR_HSK[data.level];
      // "I know it" first: saved as a placement answer, so the next fetch fills
      // the freed slots with other words and these never come back. A topic word
      // turned down is the same answer. The HSK words taken are answers too, if
      // only once their first review says whether they were really new — without
      // them, a week of "I know it"s alone read as knowing all of the level.
      if (known.size || toAdd.length) {
        await api.savePlacement({ sourceLang: "zh", targetLang: native, level, known: [...known], unknown: [], took: toAdd.map((w) => w.word) });
      }
      if (adding) {
        // The cards are made at the HSK level ("4"); the placement keeps its CEFR field.
        const base = { telegramId: accountId, sourceLang: "zh", targetLang: native, level: String(data.level) };
        // The day's HSK words are ready-made cards: the dictionary's meaning and the
        // pool's sentence at their level, no model call, so they are in review at once
        // and cost nothing; a sentence of their own is a tap away on the card. A topic
        // word brings only its meaning, so its example is still written for it.
        const [hsk, topical] = await Promise.all([
          toAdd.length ? api.batchAddWords({ ...base, items: toAdd.map((w) => ({ word: w.word })), enrich: false }) : null,
          topicToAdd.length
            ? api.batchAddWords({ ...base, items: topicToAdd.map((w) => ({ word: w.word, meaning: w.meaning })), enrich: true })
            : null,
        ]);
        adding.done(topical?.job);
        show({ icon: "📚", title: t("hskDaily.added", { n: (hsk?.created ?? 0) + (topical?.created ?? 0) }) });
      }
      setKnown(new Set());
      qc.invalidateQueries({ queryKey: ["hskDaily"] });
      qc.invalidateQueries({ queryKey: ["topicDaily"] });
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["hskReadiness"] });
    } catch (e) {
      adding?.fail();
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  // A field learned in a text, not only as a list (BACKLOG "Your field without asking
  // again"): a short Reader text on the field at the learner's level that uses the
  // day's words of it, opened as soon as it is written, those words picked to add.
  // One model call, on the tap; a second tap the same day opens the same text.
  async function readField(field: string) {
    if (writing || !data) return;
    const words = topicWords.filter((w) => w.topic === field);
    const key = `${today()}|${field}`;
    let id = readsToday()[key];
    if (!id) {
      setWriting(field);
      try {
        const r = await api.generateReaderText({
          telegramId: accountId,
          topic: field,
          sourceLang: "zh",
          targetLang: native,
          level: String(data.level),
          words: words.map((w) => w.word),
        });
        id = r.id;
        try {
          localStorage.setItem(READS_KEY, JSON.stringify({ ...readsToday(), [key]: id }));
        } catch {
          /* no storage: a second tap writes another text */
        }
      } catch (e) {
        setWriting(null);
        show({ icon: "⚠️", title: errText(e, t) });
        return;
      }
    }
    try {
      sessionStorage.setItem("lexa.readerOpen", JSON.stringify({ id, words: words.filter((w) => !w.added).map((w) => w.word) }));
    } catch {
      /* the Reader lists the text anyway */
    }
    router.push("/reader");
  }

  // The day's fields are used up: ask the model for their next words.
  async function refill() {
    if (!topic || refilling) return;
    setRefilling(true);
    try {
      qc.setQueryData(["topicDaily", accountId], await api.moreTopicWords());
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setRefilling(false);
    }
  }

  const topicBlock = editingTopic ? (
    <TopicEditor topics={topicDay?.topics ?? []} on={topicDay?.on ?? true} onDone={() => setEditingTopic(false)} />
  ) : topicLoading ? (
    // Still loading once the exam words are in: the day's fields are being listed
    // (one model call each, in parallel, a few seconds, once per field).
    <p className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-ink-faint">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("topic.seeding")}
    </p>
  ) : topic ? (
    <div className="mt-4">
      <div className="flex items-center gap-2">
        <p className="text-[12px] font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("topic.label", { topic, level: levelName })}</p>
        <button
          type="button"
          onClick={() => setEditingTopic(true)}
          aria-label={t("topic.change")}
          title={t("topic.change")}
          className="-my-2 rounded-full p-2.5 text-ink-faint hover:bg-black/[0.04] hover:text-ink"
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
          {/* Each of the day's fields as a text on it (the day may hold two or three). */}
          <div className="flex w-full flex-wrap gap-x-4">
            {[...new Set(topicWords.map((w) => w.topic))].map((field) => (
              <button
                key={field}
                type="button"
                onClick={() => void readField(field)}
                disabled={writing != null}
                title={t("topic.readHint")}
                className="inline-flex min-h-[32px] items-center gap-1.5 text-[13px] font-semibold text-sage-deep hover:text-sage disabled:opacity-60"
              >
                {writing === field ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
                {t("topic.read", { topic: field })}
              </button>
            ))}
          </div>
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
      {/* The plan these words are the day of: the exam, the pace, whether it fits. */}
      <PlanLine open={planOpen} onToggle={() => setPlanOpen((o) => !o)} />
      {planOpen && (
        <div className="mt-3">
          <ExamPlan />
        </div>
      )}

      {data.words.length === 0 ? (
        <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{t("hskDaily.empty", { level: levelName })}</p>
      ) : allTaken ? (
        <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
          {t("hskDaily.done", { n: data.words.length + topicWords.length })}
        </p>
      ) : (
        <p className="mt-1.5 max-w-[560px] text-[13px] leading-relaxed text-ink-soft">
          {data.theme
            ? `${t("hskDaily.theme", { theme: t(`situation.${data.theme}`), n: data.words.length })} ${t("hskDaily.tapKnown")}`
            : t("hskDaily.sub", { n: data.size })}{" "}
          {/* Tapping "I know it" on most of them every day is the sign a sweep would save time. */}
          <Link href={`/hsk/${data.version}/${data.level}/sweep`} className="font-semibold text-sage-deep hover:text-sage">
            {t("sweep.offer", { level: levelName })}
          </Link>
        </p>
      )}

      {data.words.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {data.words.map((w) => (
            <HskWordChip
              key={w.word}
              word={w.word}
              pinyin={w.pinyin}
              // The header names the level; a chip says it only when it differs (a word tapped below it).
              level={w.level === data.level ? null : w.level}
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

      {/* The card is the day's few on purpose; more are a tap away on the Onomika
          page, whose picks take the goal, a topic and "New picks" (the author,
          2026-10-09: three topic words and nowhere to ask for more). */}
      <p className="mt-3 text-[13px] text-ink-soft">
        {t("hskDaily.moreLead")}{" "}
        <Link href="/coach" className="inline-flex items-center gap-1 font-semibold text-sage-deep hover:text-sage">
          {t("hskDaily.moreLink")} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </p>
    </section>
  );
}
