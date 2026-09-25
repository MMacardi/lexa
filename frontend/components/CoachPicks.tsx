"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { getLevel, getExampleStyle, getNativeLang } from "@/lib/learnPrefs";
import { isAiSupported, langLabel } from "@/lib/langs";
import { PairChip } from "@/components/PairChip";
import { HskBadge } from "@/components/HskBadge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, Check, Compass, Loader2, Plus, RefreshCw, Sprout, Tag, X } from "lucide-react";

type Pick = { word: string; meaning: string; reason: string; hsk?: number };
// `topic`: what this set was narrowed to ("IT"), kept with the picks so "New
// picks" stays on it and Today can say so — until the learner clears it.
type PicksData = { picks: Pick[]; topic?: string };

// Persist the picks so they survive a full reload (F5) — the React Query cache is
// memory-only, and re-fetching would silently spend tokens each time.
function picksLSKey(account: string, source: string, target: string) {
  return `lexa.coachPicks.${account}.${source}-${target}`;
}
function readPicksLS(account: string, source: string, target: string): PicksData | undefined {
  if (typeof window === "undefined" || !account) return undefined;
  try {
    const raw = localStorage.getItem(picksLSKey(account, source, target));
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.picks)) return parsed as PicksData;
  } catch {
    /* ignore */
  }
  return undefined;
}
function writePicksLS(account: string, source: string, target: string, data: PicksData) {
  if (typeof window === "undefined" || !account) return;
  try {
    localStorage.setItem(picksLSKey(account, source, target), JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

// The shared pair (the Add form and the Reader write it). With none yet, the pair
// the app is built for: Chinese, explained in the learner's own language.
export function readPair(): { source: string; target: string } {
  const fallback = () => ({ source: "zh", target: getNativeLang() || "ru" });
  if (typeof window === "undefined") return { source: "zh", target: "ru" };
  try {
    const p = JSON.parse(localStorage.getItem("lexa.wordPair") ?? "null") as { sourceLang?: string; targetLang?: string } | null;
    if (!p?.sourceLang || p.sourceLang === "auto") return fallback();
    return { source: p.sourceLang, target: p.targetLang || fallback().target };
  } catch {
    return fallback();
  }
}

function writePair(next: { source: string; target: string }) {
  try {
    localStorage.setItem("lexa.wordPair", JSON.stringify({ sourceLang: next.source, targetLang: next.target }));
  } catch {
    /* ignore */
  }
}

// Picks being made in the background (onboarding starts them while the check
// runs), so the panel waits for those instead of paying for a second set.
const inflight = new Map<string, Promise<void>>();

export function prefetchCoachPicks(qc: QueryClient, accountId: string, source: string, target: string) {
  const id = picksLSKey(accountId, source, target);
  if (!accountId || inflight.has(id) || readPicksLS(accountId, source, target)) return;
  const job = api
    .coachPicks({ sourceLang: source, targetLang: target, count: 8 })
    .then((r) => {
      qc.setQueryData(["coach-picks", accountId, source, target], r);
      writePicksLS(accountId, source, target, r);
    })
    .catch(() => {
      /* the panel fills itself on first sight instead */
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, job);
}

const srcFont = (l: string) => (l === "zh" || l === "zh-Hant" || l === "ja" ? "font-zh" : "");
const COMPACT_COUNT = 4;

// "Words for you": useful words at the learner's level that they don't have yet,
// aimed at the goal they gave (onboarding, or the box here) or at their recent
// words. It fills itself the first time it is seen for a pair — Today shows the
// compact version, so the words are waiting before the Coach is ever opened, and
// the Coach reads the same cache. After that only "New picks" spends a call, so
// flipping languages never burns tokens.
//
// Two dials, kept apart on purpose. The goal ("HSK 4 by May, studying in China")
// is saved in coach memory and reaches every set and every chat. A topic ("IT")
// narrows one set on top of it. They used to share one box, so asking for IT
// words meant deleting the goal to type over it.
export function CoachPicks({ compact = false }: { compact?: boolean }) {
  const { accountId, profile } = useAccount();
  const { t } = useI18n();
  const { show, trackImport } = useToast();
  const qc = useQueryClient();

  const [pair, setPair] = useState(() => readPair());
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [goalDraft, setGoalDraft] = useState("");
  const [editingGoal, setEditingGoal] = useState(false);
  const [topicDraft, setTopicDraft] = useState("");
  const [customTopic, setCustomTopic] = useState(false);
  // The topic a set is being made for, shown on the chip while it loads ("" = clearing).
  const [pendingTopic, setPendingTopic] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);
  const [adding, setAdding] = useState(false);

  // Coach memory: the goal typed here (or given in onboarding), per source language.
  const { data: memory } = useQuery({
    queryKey: ["coach-profile", accountId, pair.source],
    queryFn: () => api.coachProfile(accountId, pair.source),
    enabled: !!accountId,
  });

  const zh = pair.source === "zh" || pair.source === "zh-Hant";
  const hskTarget = zh ? profile?.hskTarget : null;
  const levelLabel = hskTarget ? `HSK ${hskTarget === 7 ? "7–9" : hskTarget}` : getLevel(pair.source) ?? "—";

  const picksKey = ["coach-picks", accountId, pair.source, pair.target] as const;
  const picksQuery = useQuery<PicksData>({
    queryKey: picksKey,
    queryFn: () => api.coachPicks({ sourceLang: pair.source, targetLang: pair.target, level: getLevel(pair.source) ?? undefined, count: 8 }),
    enabled: false, // fetched on purpose only (first sight, or "New picks")
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    initialData: () => readPicksLS(accountId, pair.source, pair.target),
  });
  const allPicks = picksQuery.data?.picks ?? [];
  const picks = compact ? allPicks.slice(0, COMPACT_COUNT) : allPicks;
  const topic = picksQuery.data?.topic?.trim() ?? "";
  const goal = memory?.goal?.trim() ?? "";
  const loading = picksQuery.isFetching || fetching;
  const shownTopic = pendingTopic ?? topic;

  function changePair(next: { source: string; target: string }) {
    setPair(next);
    writePair(next);
  }

  // A set for the saved goal, narrowed to `nextTopic` when there is one ("" = none).
  async function loadPicks(nextTopic = topic) {
    if (fetching || !accountId) return;
    setFetching(true);
    setPendingTopic(nextTopic);
    try {
      const r = await api.coachPicks({
        sourceLang: pair.source,
        targetLang: pair.target,
        level: getLevel(pair.source) ?? undefined,
        count: 8,
        topic: nextTopic || undefined,
      });
      qc.setQueryData<PicksData>(picksKey, nextTopic ? { ...r, topic: nextTopic } : r);
      setTopicDraft("");
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setFetching(false);
      setPendingTopic(null);
    }
  }

  // Saving the goal re-aims the set at it, keeping the topic.
  async function saveGoal() {
    const next = goalDraft.trim();
    setEditingGoal(false);
    if (next === goal || !accountId) return;
    try {
      await api.updateCoachProfile({ telegramId: accountId, lang: pair.source, goal: next });
      await qc.invalidateQueries({ queryKey: ["coach-profile", accountId, pair.source] });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
      return;
    }
    void loadPicks();
  }

  // First sight with nothing cached: fill it without being asked. Once per mount,
  // so a model that is down costs one failed call per visit, not a loop.
  const autoTried = useRef(false);
  useEffect(() => {
    if (!accountId || autoTried.current || picksQuery.data) return;
    autoTried.current = true;
    const pending = inflight.get(picksLSKey(accountId, pair.source, pair.target));
    if (pending) {
      setFetching(true);
      void pending.finally(() => setFetching(false));
      return;
    }
    void loadPicks("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, picksQuery.data]);

  // Select all freshly-loaded picks by default, and persist them for next reload.
  useEffect(() => {
    setSel(new Set(allPicks.map((p) => p.word)));
    if (picksQuery.data && accountId) writePicksLS(accountId, pair.source, pair.target, picksQuery.data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picksQuery.data]);

  const toggle = (w: string) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(w)) n.delete(w);
      else n.add(w);
      return n;
    });

  const selected = picks.filter((p) => sel.has(p.word));

  async function addSelected() {
    const words = selected.map((p) => p.word);
    if (!words.length || adding) return;
    setAdding(true);
    try {
      const r = await api.batchAddWords({
        telegramId: accountId,
        sourceLang: pair.source,
        targetLang: pair.target,
        words,
        level: getLevel(pair.source) ?? undefined,
        exampleStyle: getExampleStyle(),
        enrich: isAiSupported(pair.source),
      });
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      if (r.job) trackImport({ jobId: r.job.id, telegramId: accountId, words, total: r.job.total, processed: 0 });
      show({ icon: "🌱", title: t("word.cardsCreated", { n: r.created }) });
      // Drop the added ones from the cached picks.
      const added = new Set(words);
      qc.setQueryData<PicksData>(picksKey, (old) => (old ? { ...old, picks: old.picks.filter((x) => !added.has(x.word)) } : old));
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setAdding(false);
    }
  }

  return (
    <section id="coach-picks" className="space-y-4 rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
      {/* "New picks" on the title's line: under the hint, a phone wrapped it onto a
          row of its own */}
      <div>
        <div className="flex items-center justify-between gap-3">
          <h2 className="min-w-0 font-serif text-[20px] font-medium text-ink">{t("coach.picksTitle")}</h2>
          <button
            type="button"
            onClick={() => loadPicks()}
            disabled={loading}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3.5 py-1.5 text-[13px] font-semibold text-ink-muted transition-colors hover:border-sage/60 hover:text-sage-deep disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t("coach.refresh")}
          </button>
        </div>
        <p className="mt-0.5 text-[13px] text-ink-soft">
          {topic
            ? t("coach.picksHintTopic", { level: levelLabel, topic })
            : goal
              ? t("coach.picksHintGoal", { level: levelLabel })
              : t("coach.picksHint", { level: levelLabel, lang: langLabel(pair.source) })}
        </p>
      </div>

      {!compact && (
        <>
          {/* language pair: stated as a chip, changed from it */}
          <PairChip
            source={pair.source}
            target={pair.target}
            onSource={(source) => changePair({ ...pair, source })}
            onTarget={(target) => changePair({ ...pair, target })}
            onSwap={() => changePair({ source: pair.target, target: pair.source })}
          />

          <div className="space-y-3 rounded-[14px] bg-black/[0.025] p-3.5">
            {/* The goal: saved, and behind every set. A saved one is stated in a line
                with "Change", not left sitting in an open text box — a filled input
                on every visit read as a form still waiting to be done. Only a
                learner with no goal yet gets the box straight away. */}
            {goal && !editingGoal ? (
              <p className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink-muted">
                <Compass className="h-3.5 w-3.5 shrink-0 text-sage" />
                <span className="shrink-0 font-semibold text-ink-soft">{t("coach.goalLabel")}:</span>
                <span className="min-w-0 truncate">{goal}</span>
                <button
                  type="button"
                  onClick={() => {
                    setGoalDraft(goal);
                    setEditingGoal(true);
                  }}
                  className="shrink-0 font-semibold text-sage-deep hover:underline"
                >
                  {t("coach.goalChange")}
                </button>
              </p>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveGoal();
                }}
              >
                <div className="flex gap-2">
                  <input
                    value={goalDraft}
                    onChange={(e) => setGoalDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setEditingGoal(false);
                    }}
                    autoFocus={editingGoal}
                    placeholder={t(zh ? "coach.themePlaceholderZh" : "coach.themePlaceholder")}
                    maxLength={80}
                    className="h-10 min-w-0 flex-1 rounded-[12px] border border-black/[0.08] bg-surface px-3.5 text-[16px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none sm:text-[14px]"
                  />
                  <button
                    type="submit"
                    disabled={goalDraft.trim() === goal}
                    className="shrink-0 rounded-[12px] bg-sage px-3.5 text-[13px] font-semibold text-white transition-colors hover:bg-sage-deep disabled:opacity-40"
                  >
                    {t("common.save")}
                  </button>
                </div>
                <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-faint">
                  <Compass className="h-3.5 w-3.5 shrink-0 text-sage" />
                  {goalDraft.trim() ? t("coach.themeRemembers") : t("coach.themeHint")}
                </p>
              </form>
            )}

            {/* The topic: this set only, on top of the goal. Kept with the picks,
                so "New picks" stays on it until it's cleared. */}
            <div>
              <div className="flex flex-wrap items-center gap-1.5 text-[13px]">
                <Tag className="h-3.5 w-3.5 shrink-0 text-sage" />
                <span className="mr-0.5 font-semibold text-ink-soft">{t("coach.topicLabel")}:</span>
                {shownTopic ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-sage/40 bg-sage-tint/60 py-1 pl-3 pr-1.5 font-semibold text-sage-deep">
                    {shownTopic}
                    {pendingTopic != null ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <button
                        type="button"
                        onClick={() => loadPicks("")}
                        disabled={loading}
                        aria-label={t("coach.topicClear")}
                        title={t("coach.topicClear")}
                        className="rounded-full p-0.5 hover:bg-sage/20"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                ) : customTopic ? (
                  <form
                    className="flex min-w-0 basis-full gap-2 sm:basis-auto sm:flex-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const next = topicDraft.trim();
                      if (next) {
                        setCustomTopic(false);
                        void loadPicks(next);
                      }
                    }}
                  >
                    <input
                      value={topicDraft}
                      onChange={(e) => setTopicDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") setCustomTopic(false);
                      }}
                      autoFocus
                      placeholder={t("coach.topicPlaceholder")}
                      maxLength={60}
                      className="h-9 min-w-0 flex-1 rounded-[10px] border border-black/[0.08] bg-surface px-3 text-[16px] text-ink placeholder:text-ink-faint focus:border-sage focus:outline-none sm:text-[14px]"
                    />
                    <button
                      type="submit"
                      disabled={!topicDraft.trim() || loading}
                      className="shrink-0 rounded-[10px] bg-sage px-3 text-[13px] font-semibold text-white transition-colors hover:bg-sage-deep disabled:opacity-40"
                    >
                      {t("coach.topicGo")}
                    </button>
                  </form>
                ) : (
                  <>
                    {t("coach.topicSuggest")
                      .split(",")
                      .map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => loadPicks(s.trim())}
                          disabled={loading}
                          className="rounded-full border border-black/[0.1] bg-surface px-3 py-1 font-semibold text-ink-muted transition-colors hover:border-sage/60 hover:text-sage-deep disabled:opacity-50"
                        >
                          {s.trim()}
                        </button>
                      ))}
                    <button
                      type="button"
                      onClick={() => setCustomTopic(true)}
                      disabled={loading}
                      className="inline-flex items-center gap-1 rounded-full border border-dashed border-black/[0.18] px-3 py-1 font-semibold text-ink-soft transition-colors hover:border-sage/60 hover:text-sage-deep disabled:opacity-50"
                    >
                      <Plus className="h-3.5 w-3.5" /> {t("coach.topicOwn")}
                    </button>
                  </>
                )}
              </div>
              <p className="mt-1.5 text-[12px] text-ink-faint">{t("coach.topicHint")}</p>
            </div>
          </div>
        </>
      )}

      {loading && picks.length === 0 ? (
        <p className="py-8 text-center text-sm text-ink-soft">{t("coach.loading")}</p>
      ) : picks.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-black/[0.12] bg-black/[0.02] p-8 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-sage-tint/60 text-sage-deep">
            <Sprout className="h-7 w-7" />
          </div>
          <p className="mt-4 text-[16px] font-semibold text-ink">{t("coach.emptyPicksTitle")}</p>
          <p className="mt-1 text-[13px] text-ink-soft">{t("coach.emptyPicksHint")}</p>
          <button
            type="button"
            onClick={() => loadPicks()}
            disabled={loading}
            className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-sage px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-sage-deep disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {t("coach.refresh")}
          </button>
        </div>
      ) : (
        <div className={cn("space-y-2 transition-opacity", loading && "opacity-50")}>
          {picks.map((p) => {
            const on = sel.has(p.word);
            return (
              <button
                key={p.word}
                type="button"
                onClick={() => toggle(p.word)}
                className={cn(
                  "flex w-full items-start gap-3 rounded-[14px] border p-3.5 text-left transition-colors",
                  on ? "border-sage/40 bg-sage-tint/45" : "border-black/[0.08] bg-surface opacity-80 hover:opacity-100",
                )}
              >
                <span
                  className={cn(
                    "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
                    on ? "border-sage bg-sage text-white" : "border-black/20 bg-surface",
                  )}
                >
                  {on && <Check className="h-3.5 w-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className={cn("text-[19px] font-semibold leading-tight text-ink", srcFont(pair.source))}>{p.word}</span>
                    {p.meaning && (
                      <span className={cn("text-[15px] font-medium text-sage", srcFont(pair.target))}>{p.meaning}</span>
                    )}
                    {p.hsk && <HskBadge hsk={profile?.hskVersion === "2.0" ? { "2.0": p.hsk } : { "3.0": p.hsk }} className="self-center" />}
                  </span>
                  {p.reason && <span className="mt-1 block text-[13px] leading-snug text-ink-soft">{p.reason}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {picks.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={addSelected} disabled={adding || selected.length === 0} className={cn(!compact && "w-full")}>
            {adding ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("reader.queueing")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Plus className="h-4 w-4" /> {t("coach.addN", { n: selected.length })}
              </span>
            )}
          </Button>
          {compact && (
            <Link href="/coach#coach-picks" className="inline-flex items-center gap-1 text-sm font-semibold text-sage hover:text-sage-deep">
              {allPicks.length > picks.length ? t("coach.morePicks", { n: allPicks.length - picks.length }) : t("coach.setGoal")}
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
