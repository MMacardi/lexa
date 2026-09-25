"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { setLevel as setPrefLevel, pushRecentPair, getNativeLang, setNativeLang, CEFR_LEVELS, LEVEL_HINT, type CefrLevel } from "@/lib/learnPrefs";
import { starterWords } from "@/lib/starterDecks";
import { DEFAULT_LEARNING_LANG, LEARNING_LANGS, langFlag, langLabel } from "@/lib/langs";
import { useCustomLangs } from "@/lib/customLangs";
import { LangSelect } from "@/components/LangSelect";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/button";
import { AddWordForm } from "@/components/AddWordForm";
import { HskFirstRun, OTHER_LANGUAGE_KEY } from "@/components/HskFirstRun";
import { Sparkles, Plus, Loader2, RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

const cjk = (l: string) => (l === "zh" || l === "zh-Hant" || l === "ja" ? "font-zh" : "");

type Cluster = { theme: string; words: string[] };

// The placement mini-test costs one cheap AI call, so we cache the clusters per
// (language, level) for a week — re-running onboarding or flipping back and forth
// shouldn't keep spending tokens on the same word list.
const CACHE_KEY = "lexa.starterCandidates";
const CACHE_TTL = 1000 * 60 * 60 * 24 * 7;
const cacheId = (lang: string, level: string) => `${lang}:${level}`;

function readCache(): Record<string, { clusters: Cluster[]; ts: number }> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as Record<string, { clusters: Cluster[]; ts: number }>;
  } catch {
    return {};
  }
}

function writeCache(id: string, clusters: Cluster[]) {
  try {
    const all = readCache();
    all[id] = { clusters, ts: Date.now() };
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    /* storage full / unavailable — caching is best-effort */
  }
}

function dropCache(id: string) {
  try {
    const all = readCache();
    delete all[id];
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

// First-run. The HSK path is the default and the one the product is built
// around; everything below it is the generic flow, kept whole for learners of
// another language (and reached from the link at the bottom of the HSK path)
// rather than deleted. It is a separate component, not a branch, so its
// placement-test call is never spent on a learner who never sees it.
export function FirstRun() {
  // "I'm learning another language", tapped in the questions before sign-in.
  const [other, setOther] = useState(() => {
    try {
      return localStorage.getItem(OTHER_LANGUAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  return other ? <GenericFirstRun /> : <HskFirstRun onOther={() => setOther(true)} />;
}

// Pick what you're learning (flags) + your level, then run a tiny placement
// test — tap the words you DON'T know and exactly those become your starter
// deck. Falls back to a curated set if the AI is unreachable. Adding your own
// word stays one click away, never forced.
function GenericFirstRun() {
  const { accountId } = useAccount();
  const { t, locale } = useI18n();
  const { show, trackImport } = useToast();
  const qc = useQueryClient();
  const custom = useCustomLangs();

  const native = locale === "ru" ? "ru" : locale === "zh" ? "zh" : "en";
  // Language you're learning. Focused, that's Chinese — unless Chinese is already
  // the side they know, in which case the other first-class learning language.
  const [source, setSource] = useState(
    DEFAULT_LEARNING_LANG && DEFAULT_LEARNING_LANG !== native ? DEFAULT_LEARNING_LANG : native === "en" ? "es" : "en",
  );
  const [target, setTarget] = useState(native); // language you already know (meanings)
  const [level, setLevel] = useState<CefrLevel>("B1");
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);

  const [clusters, setClusters] = useState<Cluster[]>([]);
  const [loading, setLoading] = useState(true);
  const [fallback, setFallback] = useState(false); // showing the curated set, not the AI test
  const [errored, setErrored] = useState(false); // AI failed (retry offered)
  const [reloadKey, setReloadKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const sameLang = source === target;
  const learningOptions = [
    ...LEARNING_LANGS.map((l) => ({ code: l.code as string, flag: l.flag, label: langLabel(l.code) })),
    ...custom.map((c) => ({ code: c.code, flag: langFlag(c.code), label: c.name })),
  ];
  const selectedCount = selected.size;
  const canStart = !sameLang && !loading && selectedCount > 0 && !busy;

  // (Re)load the placement clusters whenever the language/level changes.
  useEffect(() => {
    if (sameLang) {
      setClusters([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const id = cacheId(source, level);
    setLoading(true);
    setErrored(false);
    setFallback(false);

    const cached = readCache()[id];
    if (cached?.clusters?.length && Date.now() - cached.ts < CACHE_TTL) {
      setClusters(cached.clusters);
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const applyFallback = () => {
      const curated = starterWords(source);
      if (curated.length) {
        setClusters([{ theme: "", words: curated }]);
        setFallback(true);
      } else {
        setClusters([]);
      }
      setErrored(true);
    };

    (async () => {
      try {
        const r = await api.starterCandidates({ sourceLang: source, targetLang: target, level });
        if (cancelled) return;
        const cls = (r.clusters ?? []).filter((c) => c.words?.length);
        if (cls.length) {
          writeCache(id, cls);
          setClusters(cls);
        } else {
          applyFallback();
        }
      } catch {
        if (!cancelled) applyFallback();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [source, target, level, sameLang, reloadKey]);

  // A fresh word list clears the taps.
  useEffect(() => {
    setSelected(new Set());
  }, [clusters]);

  function toggle(word: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(word)) next.delete(word);
      else next.add(word);
      return next;
    });
  }

  function retry() {
    dropCache(cacheId(source, level));
    setReloadKey((k) => k + 1);
  }

  async function addWords(words: string[]) {
    const unique = [...new Set(words.map((w) => w.trim()).filter(Boolean))];
    if (!unique.length || busy) return;
    setBusy(true);
    try {
      setPrefLevel(source, level);
      pushRecentPair(source, target);
      if (!getNativeLang()) setNativeLang(target); // "I already know" = their side of every pair
      try {
        localStorage.setItem("lexa.wordPair", JSON.stringify({ sourceLang: source, targetLang: target }));
      } catch {
        /* ignore */
      }
      const r = await api.batchAddWords({ telegramId: accountId, sourceLang: source, targetLang: target, words: unique, level, enrich: true });
      // Keep the verdict, not just the deck it produced: every word shown and not
      // tapped is the learner saying "I already know this" about vocabulary that
      // never becomes a card, which is the only evidence we get about it.
      const shown = clusters.flatMap((c) => c.words);
      if (shown.length) {
        const tapped = new Set(unique);
        void api
          .savePlacement({
            sourceLang: source,
            targetLang: target,
            level,
            known: shown.filter((w) => !tapped.has(w.trim())),
            unknown: unique,
          })
          .catch(() => {});
      }
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      if (r.job) trackImport({ jobId: r.job.id, telegramId: accountId, words: unique, total: r.job.total, processed: 0 });
      show({ icon: "🌱", title: t("first.added", { n: r.created }) });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  const allShown = clusters.flatMap((c) => c.words);

  return (
    <div className="anim-fade-up space-y-4">
      <div className="rounded-[22px] border border-sage/25 bg-gradient-to-br from-sage-tint/50 via-surface to-surface p-5 sm:p-6">
        <h2 className="font-serif text-[24px] font-medium text-ink sm:text-[28px]">{t("first.title")}</h2>
        <p className="mt-1.5 max-w-[520px] text-[15px] leading-relaxed text-ink-soft">{t("first.sub")}</p>

        {/* what you're learning — a friendly flag grid */}
        <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("first.pickLang")}</p>
        <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5">
          {learningOptions.map((l) => {
            const active = l.code === source;
            return (
              <button
                key={l.code}
                type="button"
                onClick={() => setSource(l.code)}
                aria-pressed={active}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-[14px] border px-2 py-2.5 transition-colors",
                  active ? "border-sage bg-sage-tint" : "border-black/[0.08] bg-surface hover:bg-black/[0.03]",
                )}
              >
                <span className="text-[22px] leading-none">{l.flag}</span>
                <span className={cn("line-clamp-1 text-[11px] font-medium", active ? "text-sage-deep" : "text-ink-muted", cjk(l.code))}>
                  {l.label}
                </span>
              </button>
            );
          })}
        </div>

        {/* what you already know + your level */}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("first.know")}</span>
            <LangSelect value={target} onChange={setTarget} className="w-[168px]" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("first.level")}</span>
            <Select
              value={level}
              onChange={(v) => setLevel(v as CefrLevel)}
              ariaLabel={t("first.level")}
              className="w-[130px]"
              options={CEFR_LEVELS.map((l) => ({ value: l, label: l, hint: LEVEL_HINT[l] }))}
            />
          </label>
        </div>

        {/* the placement mini-test */}
        {sameLang ? (
          <p className="mt-4 text-[13px] font-medium text-warn-text">{t("first.sameLang")}</p>
        ) : loading ? (
          <p className="mt-5 flex items-center gap-2 text-[14px] text-ink-soft">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("first.loadingTest")}
          </p>
        ) : clusters.length > 0 ? (
          <div className="mt-5">
            <p className="text-[15px] font-semibold text-ink">{t("first.testTitle")}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{t("first.testSub")}</p>

            {fallback && (
              <p className="mt-3 flex flex-wrap items-center gap-2 text-[12px] font-medium text-warn-text">
                {t("first.testFallback")}
                <button
                  type="button"
                  onClick={retry}
                  className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink-muted hover:bg-black/[0.03]"
                >
                  <RotateCw className="h-3 w-3" /> {t("first.retry")}
                </button>
              </p>
            )}

            <div className="mt-3 space-y-3.5">
              {clusters.map((c, ci) => (
                <div key={ci}>
                  {c.theme && <p className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">{c.theme}</p>}
                  <div className="flex flex-wrap gap-1.5">
                    {c.words.map((w) => {
                      const on = selected.has(w);
                      return (
                        <button
                          key={w}
                          type="button"
                          onClick={() => toggle(w)}
                          aria-pressed={on}
                          className={cn(
                            "rounded-full border px-3 py-1.5 text-[14px] transition-colors",
                            on ? "border-sage bg-sage text-white" : "border-black/[0.08] bg-surface text-ink hover:bg-black/[0.03]",
                            cjk(source),
                          )}
                        >
                          {w}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button className="w-full sm:w-auto" disabled={!canStart} onClick={() => addWords([...selected])}>
                <Sparkles className="mr-2 h-4 w-4" />
                {busy ? t("first.building") : t("first.build", { n: selectedCount })}
              </Button>
              <span className="text-[13px] text-ink-soft">
                {selectedCount > 0 ? t("first.selected", { n: selectedCount }) : t("first.pickSome")}
              </span>
            </div>

            {selectedCount === 0 && !busy && (
              <button
                type="button"
                onClick={() => addWords(allShown)}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-sage transition-colors hover:text-sage-deep"
              >
                {t("first.giveMe")}
              </button>
            )}
          </div>
        ) : (
          <div className="mt-4">
            <p className="text-[13px] text-ink-soft">{t("first.noDeck", { lang: langLabel(source) })}</p>
            {errored && (
              <button
                type="button"
                onClick={retry}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-sage transition-colors hover:text-sage-deep"
              >
                <RotateCw className="h-3.5 w-3.5" /> {t("first.retry")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* adding your own word — always available, never in the way */}
      {manual ? (
        <AddWordForm />
      ) : (
        <button
          type="button"
          onClick={() => setManual(true)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-sage transition-colors hover:text-sage-deep"
        >
          <Plus className="h-4 w-4" /> {t("first.manual")}
        </button>
      )}
    </div>
  );
}
