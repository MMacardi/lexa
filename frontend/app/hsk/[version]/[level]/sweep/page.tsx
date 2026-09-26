"use client";

import { useEffect, useMemo, useState } from "react";
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
import { Check, Loader2 } from "lucide-react";

// A screen of words at a time: about one phone screen of four-wide tiles.
const SCREEN = 32;

// The first sense of a list meaning ("принцип; основа" → "принцип"), for the check.
const firstSense = (m: string) => m.split(/[;；]/)[0].trim();

function shuffle<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

type SpotCheck = { word: HskListWord; options: string[]; picked: string | null };

// Sweep a level (BACKLOG "A sweep instead of a big test"): the level a screen at a
// time, tap only the words you DON'T know, and the rest are saved as known — what
// "I know it" in Today's words writes — so the daily words stop offering them.
// All of HSK 4 in minutes, because only the exceptions take a tap.
//
// Two guards against a sweep that claims too much, since every word it marks
// also counts on the readiness mark: each screen is confirmed on its own ("I know
// the other 29"), never the whole level in one go; and each confirm asks what one
// of the claimed words means, from the list's own meanings — a miss sends that
// word to the ones to learn. The words tapped as unknown aren't wasted either:
// saved as such, they are the first the daily words bring.
export default function SweepPage() {
  const params = useParams<{ version: string; level: string }>();
  const version: HskVersion = params.version === "2.0" ? "2.0" : "3.0";
  const level = Number(params.level) || 1;
  const levelName = level === 7 ? "7–9" : String(level);

  const { accountId, profile } = useAccount();
  const { t } = useI18n();
  const { show } = useToast();
  const qc = useQueryClient();
  const native = profile?.nativeLang ?? getNativeLang() ?? "ru";

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["hskList", accountId, version, level],
    queryFn: () => api.hskList(version, level),
  });

  // What's left to sweep, frozen when the list first arrives: no card, no answer
  // yet. Frozen, or saving a screen would reshuffle the ones still to come.
  const [queue, setQueue] = useState<HskListWord[] | null>(null);
  useEffect(() => {
    if (data && !queue) setQueue(data.words.filter((w) => !w.card && w.status == null && !w.toLearn));
  }, [data, queue]);

  const [pos, setPos] = useState(0);
  const [unknown, setUnknown] = useState<Set<string>>(new Set());
  const [showPinyin, setShowPinyin] = useState(false);
  const [check, setCheck] = useState<SpotCheck | null>(null);
  const [totals, setTotals] = useState({ known: 0, unknown: 0 });
  const [saving, setSaving] = useState(false);
  // A missed check waits for "Next" so the right meaning can be read first.
  const [pendingSave, setPendingSave] = useState<{ known: string[]; notKnown: string[] } | null>(null);

  // Distractors for the check: other senses of this level.
  const senses = useMemo(
    () => Array.from(new Set((data?.words ?? []).map((w) => (w.meaning ? firstSense(w.meaning) : "")).filter(Boolean))),
    [data],
  );

  const back = (
    <Link href={`/hsk/${version}/${level}`} className="text-sm font-semibold text-ink-soft hover:text-ink">
      ← HSK {levelName}
    </Link>
  );

  if (isLoading || (data && !queue))
    return (
      <div className="space-y-5">
        {back}
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-72 rounded-[20px]" />
      </div>
    );
  if (isError || !data || !queue)
    return (
      <div className="space-y-4">
        {back}
        <ErrorState message={errText(error, t)} onRetry={() => refetch()} />
      </div>
    );

  const screen = queue.slice(pos, pos + SCREEN);
  const screens = Math.max(1, Math.ceil(queue.length / SCREEN));
  const screenNo = Math.min(Math.floor(pos / SCREEN) + 1, screens);
  const knownOnScreen = screen.filter((w) => !unknown.has(w.word));
  const done = pos >= queue.length;

  function toggle(word: string) {
    setUnknown((prev) => {
      const next = new Set(prev);
      if (next.has(word)) next.delete(word);
      else next.add(word);
      return next;
    });
  }

  async function save(known: string[], notKnown: string[]) {
    setSaving(true);
    try {
      await api.savePlacement({ sourceLang: "zh", targetLang: native, level: CEFR_FOR_HSK[level], known, unknown: notKnown });
      setTotals((s) => ({ known: s.known + known.length, unknown: s.unknown + notKnown.length }));
      setUnknown(new Set());
      setCheck(null);
      setPos((p) => p + SCREEN);
      window.scrollTo({ top: 0 });
      qc.invalidateQueries({ queryKey: ["hskDaily"] });
      qc.invalidateQueries({ queryKey: ["hskReadiness"] });
      qc.invalidateQueries({ queryKey: ["hskLists"] });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setSaving(false);
    }
  }

  // "I know the rest": first one claimed word, asked back — when the list has
  // meanings in the learner's language and there's enough on the screen to ask.
  function confirm() {
    const askable = knownOnScreen.filter((w) => w.meaning);
    if (askable.length >= 3 && senses.length >= 4) {
      const word = askable[Math.floor(Math.random() * askable.length)];
      const right = firstSense(word.meaning!);
      const wrong = shuffle(senses.filter((s) => s !== right)).slice(0, 3);
      setCheck({ word, options: shuffle([right, ...wrong]), picked: null });
      return;
    }
    void save(knownOnScreen.map((w) => w.word), screen.filter((w) => unknown.has(w.word)).map((w) => w.word));
  }

  function answer(opt: string) {
    if (!check || check.picked) return;
    const right = opt === firstSense(check.word.meaning!);
    setCheck({ ...check, picked: opt });
    const miss = right ? [] : [check.word.word];
    const known = knownOnScreen.map((w) => w.word).filter((w) => !miss.includes(w));
    const notKnown = [...screen.filter((w) => unknown.has(w.word)).map((w) => w.word), ...miss];
    // A right answer moves straight on; a miss stays a moment to show the meaning.
    if (right) void save(known, notKnown);
    else setPendingSave({ known, notKnown });
  }

  if (done)
    return (
      <div className="anim-fade-up space-y-5">
        {back}
        <div className="rounded-[24px] border border-black/[0.06] bg-surface p-6 text-center sm:p-8">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sage-tint text-sage-deep">
            <Check className="h-7 w-7" />
          </div>
          <h1 className="mt-4 font-serif text-[26px] font-medium text-ink">
            {queue.length === 0 ? t("sweep.nothingLeft", { level: levelName }) : t("sweep.done", { level: levelName })}
          </h1>
          {queue.length > 0 && (
            <p className="mt-2 text-[15px] text-ink-soft">{t("sweep.doneSummary", { known: totals.known, unknown: totals.unknown })}</p>
          )}
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Link
              href="/#daily"
              className="inline-flex h-11 items-center rounded-full bg-sage px-5 text-[15px] font-semibold text-white transition-colors hover:bg-sage-deep"
            >
              {t("sweep.toToday")}
            </Link>
            <Link
              href={`/hsk/${version}/${level}`}
              className="inline-flex h-11 items-center rounded-full border border-black/[0.08] bg-surface px-5 text-[15px] font-semibold text-ink-muted hover:bg-black/[0.03]"
            >
              {t("sweep.toList", { level: levelName })}
            </Link>
          </div>
        </div>
      </div>
    );

  return (
    // No fade-in on this wrapper: an animation's leftover transform makes `fixed`
    // children anchor to it, and the confirm bar sank below the screen.
    <div className="space-y-4 pb-28 md:pb-20">
      {back}
      <div>
        <h1 className="font-serif text-[28px] font-semibold tracking-[-0.02em] text-ink sm:text-[34px]">
          {t("sweep.title", { level: levelName })}
        </h1>
        <p className="mt-1 text-[14px] leading-relaxed text-ink-soft">{t("sweep.how")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-faint">
        <span className="font-semibold text-ink-soft">{t("sweep.screen", { n: screenNo, of: screens })}</span>
        {totals.known + totals.unknown > 0 && <span>{t("sweep.sofar", { known: totals.known, unknown: totals.unknown })}</span>}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 font-medium">
          <input type="checkbox" checked={showPinyin} onChange={(e) => setShowPinyin(e.target.checked)} className="accent-sage" />
          {t("sweep.pinyin")}
        </label>
      </div>
      <div className="h-[6px] overflow-hidden rounded-full bg-track">
        <div className="h-full rounded-full bg-sage transition-[width] duration-300" style={{ width: `${(pos / queue.length) * 100}%` }} />
      </div>

      {check ? (
        <div className="anim-fade-up rounded-[20px] border border-black/[0.06] bg-surface p-5 text-center sm:p-7">
          <p className="text-[13px] font-medium text-ink-faint">{t("sweep.checkWhy")}</p>
          <p className="mt-3 text-[15px] text-ink-soft">{t("sweep.checkQ")}</p>
          <div className="mt-1 font-zh text-[40px] font-medium text-ink">{check.word.word}</div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {check.options.map((opt) => {
              const right = opt === firstSense(check.word.meaning!);
              const picked = check.picked === opt;
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={!!check.picked || saving}
                  onClick={() => answer(opt)}
                  className={cn(
                    "rounded-[14px] border px-4 py-3 text-left text-[15px] font-medium transition-colors",
                    check.picked && right
                      ? "border-sage bg-sage-tint text-sage-deep"
                      : picked
                        ? "border-warn bg-warn-bg text-warn-text"
                        : "border-black/[0.08] bg-surface text-ink hover:border-sage/60",
                  )}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {check.picked && pendingSave && (
            <div className="mt-4 space-y-3">
              <p className="text-[14px] text-ink-soft">
                {t("sweep.checkMiss", { word: check.word.word, meaning: firstSense(check.word.meaning!) })}
              </p>
              <Button onClick={() => void save(pendingSave.known, pendingSave.notKnown).then(() => setPendingSave(null))} disabled={saving}>
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("sweep.next")}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8">
          {screen.map((w) => {
            const off = unknown.has(w.word);
            return (
              <button
                key={w.word}
                type="button"
                onClick={() => toggle(w.word)}
                aria-pressed={off}
                className={cn(
                  "flex min-h-[64px] flex-col items-center justify-center rounded-[14px] border px-1 py-2 transition-colors",
                  off ? "border-warn/50 bg-warn-bg text-warn-text" : "border-black/[0.07] bg-surface text-ink hover:bg-black/[0.03]",
                )}
              >
                <span className="font-zh text-[19px] leading-tight">{w.word}</span>
                {showPinyin && <span className="mt-0.5 text-[10px] leading-tight text-ink-faint">{w.pinyin}</span>}
                {off && <span className="mt-0.5 text-[10px] font-semibold">{t("sweep.toLearn")}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* In thumb reach above the phone's tab bar: the one decision per screen. */}
      {!check && (
        <div className="fixed inset-x-0 bottom-[calc(56px_+_env(safe-area-inset-bottom))] z-40 px-4 md:bottom-6">
          <div className="mx-auto flex max-w-[720px] items-center gap-2 rounded-[18px] border border-black/[0.08] bg-surface/95 px-3 py-2.5 shadow-[0_14px_40px_rgba(46,42,38,0.2)] backdrop-blur">
            <Button className="flex-1" onClick={confirm} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {knownOnScreen.length ? t("sweep.confirm", { n: knownOnScreen.length }) : t("sweep.confirmNone")}
            </Button>
            <Link href={`/hsk/${version}/${level}`} className="shrink-0 px-2 text-[13px] font-semibold text-ink-faint hover:text-ink">
              {t("sweep.stop")}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
