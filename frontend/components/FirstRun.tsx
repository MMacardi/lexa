"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { setLevel as setPrefLevel, pushRecentPair, CEFR_LEVELS, LEVEL_HINT, type CefrLevel } from "@/lib/learnPrefs";
import { starterWords } from "@/lib/starterDecks";
import { langLabel } from "@/lib/langs";
import { LangSelect } from "@/components/LangSelect";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/button";
import { AddWordForm } from "@/components/AddWordForm";
import { Sparkles, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

const cjk = (l: string) => (l === "zh" || l === "zh-Hant" || l === "ja" ? "font-zh" : "");

// First-run: a warm, one-tap path out of the blank slate. Pick what you're
// learning + your level, and get a hand-picked starter deck (enriched into your
// own language) so Review / Quiz / Coach have something to work with in under a
// minute. Adding your own word stays one click away — never forced.
export function FirstRun() {
  const { accountId } = useAccount();
  const { t, locale } = useI18n();
  const { show, trackImport } = useToast();
  const qc = useQueryClient();

  const native = locale === "ru" ? "ru" : locale === "zh" ? "zh" : "en";
  const [target, setTarget] = useState(native); // language you already know (meanings)
  const [source, setSource] = useState(native === "en" ? "es" : "en"); // language you're learning
  const [level, setLevel] = useState<CefrLevel>("B1");
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);

  const words = starterWords(source);
  const sameLang = source === target;
  const canStart = !sameLang && words.length > 0 && !busy;

  async function buildStarter() {
    if (!canStart) return;
    setBusy(true);
    try {
      setPrefLevel(source, level);
      pushRecentPair(source, target);
      try {
        localStorage.setItem("lexa.wordPair", JSON.stringify({ sourceLang: source, targetLang: target }));
      } catch {
        /* ignore */
      }
      const r = await api.batchAddWords({ telegramId: accountId, sourceLang: source, targetLang: target, words, level, enrich: true });
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      if (r.job) trackImport({ jobId: r.job.id, telegramId: accountId, words, total: r.job.total, processed: 0 });
      show({ icon: "🌱", title: t("first.added", { n: r.created }) });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="anim-fade-up space-y-4">
      <div className="rounded-[22px] border border-sage/25 bg-gradient-to-br from-sage-tint/50 via-surface to-surface p-5 sm:p-6">
        <h2 className="font-serif text-[24px] font-medium text-ink sm:text-[28px]">{t("first.title")}</h2>
        <p className="mt-1.5 max-w-[520px] text-[15px] leading-relaxed text-ink-soft">{t("first.sub")}</p>

        {/* what you're learning / what you already know */}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("first.learn")}</span>
            <LangSelect value={source} onChange={setSource} className="w-[168px]" />
          </label>
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

        {sameLang ? (
          <p className="mt-4 text-[13px] font-medium text-warn-text">{t("first.sameLang")}</p>
        ) : words.length > 0 ? (
          <>
            <p className="mt-4 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">{t("first.preview")}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {words.map((w) => (
                <span key={w} className={cn("rounded-full border border-black/[0.08] bg-surface px-2.5 py-1 text-[14px] text-ink", cjk(source))}>
                  {w}
                </span>
              ))}
            </div>
            <Button className="mt-4 w-full sm:w-auto" disabled={!canStart} onClick={buildStarter}>
              <Sparkles className="mr-2 h-4 w-4" />
              {busy ? t("first.building") : t("first.build", { n: words.length })}
            </Button>
          </>
        ) : (
          <p className="mt-4 text-[13px] text-ink-soft">{t("first.noDeck", { lang: langLabel(source) })}</p>
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
