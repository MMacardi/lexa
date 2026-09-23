"use client";

import { useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { api, type HskVersion, type HskWord } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { setLevel as setPrefLevel, pushRecentPair, setNativeLang, type CefrLevel } from "@/lib/learnPrefs";
import { LangSelect } from "@/components/LangSelect";
import { langFlag } from "@/lib/langs";
import { Button } from "@/components/ui/button";
import { ImportWordsDialog } from "@/components/ImportWordsDialog";
import { GraduationCap, Loader2, Sparkles, Dumbbell, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

// The one onboarding path: target level → check → gap deck → first review →
// first use-step, in about five minutes. Everything here is one language pair
// (Chinese, explained in whatever the learner already knows — Russian unless the
// browser says otherwise), because that is the product: HSK prep for Russian
// speakers. Learners of anything else drop back to the generic FirstRun.

const MAX_LEVEL: Record<HskVersion, number> = { "2.0": 6, "3.0": 7 };

// The check writes PlacementAnswers and the gap deck reads them, so a run of
// ~24 words is the cheapest honest signal: enough to move the mark, short
// enough to tap through before anyone loses interest.
const CHECK_SIZE = 24;
const DECK_SIZE = 20;

// Cards are still generated at a CEFR level (examples, synonyms), so the HSK
// target has to name one. Rough but stable: HSK 1–2 are A1/A2, 3 is B1, 4 is B2,
// 5 and up are C1 — the mapping the HSK bands are usually published against.
const CEFR_FOR: Record<number, CefrLevel> = { 1: "A1", 2: "A2", 3: "B1", 4: "B2", 5: "C1", 6: "C1", 7: "C2" };

type Step = "target" | "check" | "deck" | "done";

// "first" is the empty-account onboarding. "refill" is the same flow re-opened by
// a learner who already has cards and wants the next batch of gap words (F11):
// same target step, but the placement check is optional — re-tapping 24 words you
// already answered is the reason a repeat visit wouldn't happen.
type Variant = "first" | "refill";

export function HskFirstRun({
  onOther,
  variant = "first",
  onClose,
}: {
  onOther?: () => void;
  variant?: Variant;
  onClose?: () => void;
}) {
  const { accountId } = useAccount();
  const { t, locale } = useI18n();
  const { show, trackImport } = useToast();
  const qc = useQueryClient();

  const [version, setVersion] = useState<HskVersion>("3.0");
  const [target, setTarget] = useState(4);
  // "I already know" — Russian by default, and only overridden by the browser's
  // own language. The learning side is never a picker here: it is Chinese.
  const [native, setNative] = useState(locale === "zh" ? "en" : locale === "en" ? "en" : "ru");

  const [step, setStep] = useState<Step>("target");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<HskWord[]>([]);
  const [unknown, setUnknown] = useState<Set<string>>(new Set());
  const [knownCount, setKnownCount] = useState(0);
  const [gap, setGap] = useState<HskWord[]>([]);
  const [added, setAdded] = useState(0);

  const level = CEFR_FOR[target] ?? "B1";

  async function startCheck() {
    setBusy(true);
    try {
      // Save the target before the check: the mark and the bot both read it off
      // the account, and a learner who drops out here still gets it remembered.
      void api.updateLearnerPrefs({ hskVersion: version, hskTarget: target, nativeLang: native }).catch(() => {});
      const r = await api.hskCheck(version, target, CHECK_SIZE);
      setCheck(r.words);
      setUnknown(new Set());
      setStep("check");
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  // Straight to the gap deck, no check. The gap endpoint already excludes both
  // the words you own and the ones you ticked as known, so a repeat run returns
  // the NEXT batch rather than the same twenty — which is what makes the loop
  // repeat at all (F11: api.hskGap used to have exactly one caller, inside the
  // screen you could only see on an empty account).
  async function loadGapOnly() {
    setBusy(true);
    try {
      void api.updateLearnerPrefs({ hskVersion: version, hskTarget: target, nativeLang: native }).catch(() => {});
      const r = await api.hskGap(version, target, DECK_SIZE);
      setCheck([]);
      setKnownCount(0);
      setGap(r.words);
      setStep("deck");
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  async function finishCheck() {
    setBusy(true);
    try {
      const known = check.map((w) => w.word).filter((w) => !unknown.has(w));
      setKnownCount(known.length);
      await api.savePlacement({
        sourceLang: "zh",
        targetLang: native,
        level,
        known,
        unknown: [...unknown],
      });
      // The gap deck is computed after the taps land, so the words the learner
      // just said they know never come back as something to learn.
      const r = await api.hskGap(version, target, DECK_SIZE);
      setGap(r.words);
      setStep("deck");
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  async function buildDeck() {
    if (!gap.length || busy) return;
    setBusy(true);
    try {
      setPrefLevel("zh", level);
      pushRecentPair("zh", native);
      setNativeLang(native);
      try {
        localStorage.setItem("lexa.wordPair", JSON.stringify({ sourceLang: "zh", targetLang: native }));
      } catch {
        /* ignore */
      }
      const words = gap.map((w) => w.word);
      const r = await api.batchAddWords({ telegramId: accountId, sourceLang: "zh", targetLang: native, words, level, enrich: true });
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["hskReadiness"] });
      if (r.job) trackImport({ jobId: r.job.id, telegramId: accountId, words, total: r.job.total, processed: 0 });
      setAdded(r.created);
      setStep("done");
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  function toggle(word: string) {
    setUnknown((prev) => {
      const next = new Set(prev);
      if (next.has(word)) next.delete(word);
      else next.add(word);
      return next;
    });
  }

  return (
    <div className="anim-fade-up space-y-4">
      <div className="rounded-[22px] border border-sage/25 bg-gradient-to-br from-sage-tint/50 via-surface to-surface p-5 sm:p-6">
        <div className="flex items-center gap-2 text-sage-deep">
          <GraduationCap className="h-5 w-5" />
          {/* A refill can skip the check, so "step 2 of 3" would be a lie. */}
          {variant === "first" && (
            <span className="text-[11px] font-semibold uppercase tracking-wide">{t("hskFirst.step", { n: STEP_NO[step], total: 3 })}</span>
          )}
        </div>
        <h2 className="mt-1.5 font-serif text-[24px] font-medium text-ink sm:text-[28px]">{t("hskFirst.title")}</h2>
        <p className="mt-1.5 max-w-[540px] text-[15px] leading-relaxed text-ink-soft">{t("hskFirst.sub")}</p>

        {step === "target" && (
          <>
            <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("hsk.list")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["3.0", "2.0"] as HskVersion[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setVersion(v);
                    if (target > MAX_LEVEL[v]) setTarget(MAX_LEVEL[v]);
                  }}
                  aria-pressed={v === version}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-[14px] font-medium transition-colors",
                    v === version ? "border-sage bg-sage text-white" : "border-black/[0.08] bg-surface text-ink hover:bg-black/[0.03]",
                  )}
                >
                  {v === "2.0" ? t("hsk.list2") : t("hsk.list3")}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-faint">{t("hsk.listHint")}</p>

            <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("hsk.target")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {Array.from({ length: MAX_LEVEL[version] }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTarget(n)}
                  aria-pressed={n === target}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-[14px] font-medium transition-colors",
                    n === target ? "border-sage bg-sage text-white" : "border-black/[0.08] bg-surface text-ink hover:bg-black/[0.03]",
                  )}
                >
                  {n === 7 ? t("hsk.band79") : t("hsk.level", { n })}
                </button>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("hskFirst.learning")}</span>
                <span className="flex h-[38px] items-center rounded-[12px] border border-black/[0.08] bg-surface px-3 text-[14px] font-medium text-ink">
                  {langFlag("zh")} <span className="ml-1.5 font-zh">{t("hskFirst.chinese")}</span>
                </span>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("hskFirst.explainIn")}</span>
                <LangSelect value={native} onChange={setNative} className="w-[168px]" />
              </label>
            </div>

            {/* On a repeat visit the check is the optional half: the learner has
                already placed themselves, so lead with the words. */}
            {variant === "refill" ? (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button className="w-full sm:w-auto" disabled={busy} onClick={loadGapOnly}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Layers className="mr-2 h-4 w-4" />}
                  {t("hskFirst.refillGo")}
                </Button>
                <Button variant="outline" disabled={busy} onClick={startCheck}>
                  <GraduationCap className="mr-2 h-4 w-4" />
                  {t("hskFirst.refillRecheck")}
                </Button>
              </div>
            ) : (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <Button className="w-full sm:w-auto" disabled={busy} onClick={startCheck}>
                  {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GraduationCap className="mr-2 h-4 w-4" />}
                  {t("hskFirst.startCheck")}
                </Button>
                <span className="text-[13px] text-ink-soft">{t("hskFirst.checkLen", { n: CHECK_SIZE })}</span>
              </div>
            )}
          </>
        )}

        {step === "check" && (
          <div className="mt-5">
            <p className="text-[15px] font-semibold text-ink">{t("hskFirst.tapTitle")}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{t("hskFirst.tapSub")}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {check.map((w) => {
                const on = unknown.has(w.word);
                return (
                  <button
                    key={w.word}
                    type="button"
                    onClick={() => toggle(w.word)}
                    aria-pressed={on}
                    className={cn(
                      "rounded-[14px] border px-3 py-1.5 text-center transition-colors",
                      on ? "border-sage bg-sage text-white" : "border-black/[0.08] bg-surface text-ink hover:bg-black/[0.03]",
                    )}
                  >
                    <span className="block font-zh text-[16px] leading-tight">{w.word}</span>
                    <span className={cn("block text-[11px] leading-tight", on ? "text-white/75" : "text-ink-faint")}>{w.pinyin}</span>
                  </button>
                );
              })}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button className="w-full sm:w-auto" disabled={busy} onClick={finishCheck}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {t("hskFirst.seeMark")}
              </Button>
              <span className="text-[13px] text-ink-soft">{t("hskFirst.tapped", { n: unknown.size })}</span>
            </div>
          </div>
        )}

        {step === "deck" && (
          <div className="mt-5">
            {/* No check in this run means no mark to report — say what the list
                actually is instead of "you knew 0 of 0". */}
            <p className="text-[15px] font-semibold text-ink">
              {check.length
                ? t("hskFirst.markLine", { known: knownCount, shown: check.length, level: target === 7 ? "7–9" : String(target) })
                : t("hskFirst.refillLine", { level: target === 7 ? "7–9" : String(target) })}
            </p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">
              {check.length ? t("hskFirst.markSub") : t("hskFirst.refillSub")}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {gap.map((w) => (
                <span key={w.word} className="rounded-[14px] border border-black/[0.08] bg-surface px-3 py-1.5 text-center">
                  <span className="block font-zh text-[16px] leading-tight text-ink">{w.word}</span>
                  <span className="block text-[11px] leading-tight text-ink-faint">{w.pinyin}</span>
                </span>
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button className="w-full sm:w-auto" disabled={busy || !gap.length} onClick={buildDeck}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Layers className="mr-2 h-4 w-4" />}
                {t("hskFirst.buildGap", { n: gap.length })}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="mt-5">
            <p className="text-[15px] font-semibold text-ink">{t("hskFirst.doneTitle", { n: added })}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{t("hskFirst.doneSub")}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/review"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-sage px-5 text-[15px] font-semibold text-white transition-colors hover:bg-sage-deep"
              >
                <Sparkles className="h-4 w-4" /> {t("hskFirst.review")}
              </Link>
              <Link
                href="/coach/practice"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-black/[0.08] bg-surface px-5 text-[15px] font-semibold text-ink-muted transition-colors hover:bg-black/[0.03]"
              >
                <Dumbbell className="h-4 w-4" /> {t("hskFirst.useStep")}
              </Link>
              {/* A refill is opened from Today and has somewhere to go back to;
                  the first run is the page, so it gets no close. */}
              {onClose && (
                <Button variant="outline" onClick={onClose}>
                  {t("hskFirst.refillClose")}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* The textbook path: this week's list, photographed or pasted, becomes
          cards in the same pair — the other half of the loop the gap deck starts. */}
      <div className="rounded-[22px] border border-black/[0.06] bg-surface p-5">
        <p className="text-[15px] font-semibold text-ink">{t("hskFirst.textbookTitle")}</p>
        <p className="mt-0.5 mb-3 text-[13px] leading-relaxed text-ink-soft">{t("hskFirst.textbookSub")}</p>
        <ImportWordsDialog defaultSourceLang="zh" defaultTargetLang={native} triggerLabel={t("hskFirst.textbookOpen")} />
      </div>

      {/* Only the first run offers the way out to another language — a refill was
          opened deliberately by someone already on the HSK track. */}
      {onOther && (
        <button
          type="button"
          onClick={onOther}
          className="text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
        >
          {t("hskFirst.other")}
        </button>
      )}
      {!onOther && onClose && step !== "done" && (
        <button
          type="button"
          onClick={onClose}
          className="text-sm font-semibold text-ink-muted transition-colors hover:text-ink"
        >
          {t("common.cancel")}
        </button>
      )}
    </div>
  );
}

const STEP_NO: Record<Step, number> = { target: 1, check: 2, deck: 3, done: 3 };
