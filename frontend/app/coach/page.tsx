"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { getLevel, getExampleStyle } from "@/lib/learnPrefs";
import { isAiSupported, langLabel } from "@/lib/langs";
import { LangSelect } from "@/components/LangSelect";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Compass, RefreshCw, Check, Loader2, Plus } from "lucide-react";

type Pick = { word: string; reason: string };

function readPair(): { source: string; target: string } {
  if (typeof window === "undefined") return { source: "en", target: "zh" };
  try {
    const p = JSON.parse(localStorage.getItem("lexa.wordPair") ?? "null") as { sourceLang?: string; targetLang?: string };
    const source = p?.sourceLang && p.sourceLang !== "auto" ? p.sourceLang : "en";
    return { source, target: p?.targetLang || "zh" };
  } catch {
    return { source: "en", target: "zh" };
  }
}

const srcFont = (l: string) => (l === "zh" || l === "zh-Hant" || l === "ja" ? "font-zh" : "");

export default function CoachPage() {
  const { accountId } = useAccount();
  const { t } = useI18n();
  const { show, trackImport } = useToast();
  const qc = useQueryClient();

  const [pair, setPair] = useState(() => readPair());
  const [picks, setPicks] = useState<Pick[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [loaded, setLoaded] = useState(false);

  function setSource(source: string) {
    const next = { ...pair, source };
    setPair(next);
    try {
      localStorage.setItem("lexa.wordPair", JSON.stringify({ sourceLang: next.source, targetLang: next.target }));
    } catch {
      /* ignore */
    }
  }
  function setTarget(target: string) {
    const next = { ...pair, target };
    setPair(next);
    try {
      localStorage.setItem("lexa.wordPair", JSON.stringify({ sourceLang: next.source, targetLang: next.target }));
    } catch {
      /* ignore */
    }
  }

  async function loadPicks() {
    if (loading) return;
    setLoading(true);
    try {
      const r = await api.coachPicks({ sourceLang: pair.source, targetLang: pair.target, level: getLevel(pair.source) ?? undefined, count: 8 });
      setPicks(r.picks);
      setSel(new Set(r.picks.map((p) => p.word)));
      setLoaded(true);
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setLoading(false);
    }
  }

  // Fetch a first batch on mount.
  useEffect(() => {
    void loadPicks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = (w: string) =>
    setSel((prev) => {
      const n = new Set(prev);
      if (n.has(w)) n.delete(w);
      else n.add(w);
      return n;
    });

  async function addSelected() {
    const words = picks.filter((p) => sel.has(p.word)).map((p) => p.word);
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
      // Drop the added ones from the list.
      const added = new Set(words);
      setPicks((p) => p.filter((x) => !added.has(x.word)));
      setSel(new Set());
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setAdding(false);
    }
  }

  const selectedCount = picks.filter((p) => sel.has(p.word)).length;

  return (
    <div className="anim-fade-up mx-auto max-w-[760px] space-y-6">
      <div>
        <h1 className="flex items-center gap-2 font-serif text-[30px] font-medium tracking-[-0.01em] text-ink">
          <Compass className="h-7 w-7 text-sage-deep" /> {t("coach.title")}
        </h1>
        <p className="mt-1.5 text-ink-soft">{t("coach.subtitle")}</p>
      </div>

      <section className="space-y-4 rounded-[20px] border border-black/[0.06] bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-[20px] font-medium text-ink">{t("coach.picksTitle")}</h2>
            <p className="mt-0.5 text-[13px] text-ink-soft">
              {t("coach.picksHint", { level: getLevel(pair.source) ?? "—", lang: langLabel(pair.source) })}
            </p>
          </div>
          <button
            type="button"
            onClick={loadPicks}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3.5 py-1.5 text-[13px] font-semibold text-ink-muted transition-colors hover:border-sage/60 hover:text-sage-deep disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            {t("coach.refresh")}
          </button>
        </div>

        {/* language pair */}
        <div className="flex flex-wrap items-center gap-2">
          <LangSelect value={pair.source} onChange={setSource} />
          <span className="text-ink-faint">→</span>
          <LangSelect value={pair.target} onChange={setTarget} />
        </div>

        {/* picks */}
        {loading && picks.length === 0 ? (
          <p className="py-8 text-center text-sm text-ink-soft">{t("coach.loading")}</p>
        ) : picks.length === 0 && loaded ? (
          <p className="py-8 text-center text-sm text-ink-soft">{t("coach.empty")}</p>
        ) : (
          <div className="space-y-2">
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
                    <span className={cn("block text-[19px] font-semibold leading-tight text-ink", srcFont(pair.source))}>{p.word}</span>
                    {p.reason && <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">{p.reason}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {picks.length > 0 && (
          <Button onClick={addSelected} disabled={adding || selectedCount === 0} className="w-full">
            {adding ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("reader.queueing")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5">
                <Plus className="h-4 w-4" /> {t("coach.addN", { n: selectedCount })}
              </span>
            )}
          </Button>
        )}
      </section>
    </div>
  );
}
