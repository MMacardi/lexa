"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, type CheckResult, type CheckScreen, type CheckWord, type DoneCheckScreen, type HskVersion } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

// The check itself (backend services/placementCheck.ts): five screens of seven,
// each from one level, the next level following the answers — and one word a
// screen made up, to catch "I know it" said too freely. After a screen, one word
// left as known is asked back as a meaning question, as in the sweep. The server
// keeps nothing between screens: every request carries the screens done so far.
//
// Used by the onboarding (HskFirstRun) and by "Check again" for an account that
// already has a target (/hsk/[version]/[level]/check). The caller renders the
// heading and saves the result; `onResult` throwing keeps the last screen up, so
// "Next" sends it again.

function shuffle<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const toggleIn = (set: Set<string>, id: string) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

export function HskCheck({
  version,
  target,
  claimed,
  native,
  guest,
  onResult,
  onSkip,
  skipLabel,
}: {
  version: HskVersion;
  target: number;
  claimed: number; // the level the first screen comes from
  native: string;
  guest?: boolean; // before sign-in: the public route, nothing known about the learner
  onResult: (r: CheckResult) => Promise<void> | void;
  onSkip?: () => void;
  skipLabel?: string;
}) {
  const { t } = useI18n();
  const { show } = useToast();
  // Fixed when the check starts: the staircase is one learner's answers from one start.
  const [start] = useState({ version, target, claimed });
  const [screen, setScreen] = useState<CheckScreen | null>(null);
  const [done, setDone] = useState<DoneCheckScreen[]>([]);
  const [unknown, setUnknown] = useState<Set<string>>(new Set());
  const [probe, setProbe] = useState<{ word: CheckWord; options: string[]; picked: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const askCheck = (screens: DoneCheckScreen[]) => {
    const body = { ...start, native, done: screens };
    return guest ? api.publicHskCheck(body) : api.hskCheck(body);
  };

  const topRef = useRef<HTMLDivElement>(null);
  const toTop = () => {
    const top = topRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) window.scrollBy({ top: top - 96, behavior: "smooth" });
  };

  async function first() {
    setFailed(false);
    try {
      const r = await askCheck([]);
      if (!r.screen) throw new Error(t("common.error"));
      setScreen(r.screen);
    } catch (e) {
      setFailed(true);
      show({ icon: "⚠️", title: errText(e, t) });
    }
  }
  useEffect(() => {
    void first();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "Next": first one of the words left as known, asked back — when three were
  // left and there are wrong meanings to offer — then the next screen.
  function confirmScreen() {
    if (!screen || busy) return;
    const askable = screen.words.filter((w) => w.meaning && !unknown.has(w.word));
    if (askable.length >= 3) {
      const word = askable[Math.floor(Math.random() * askable.length)];
      const wrong = shuffle(screen.senses.filter((m) => m !== word.meaning)).slice(0, 3);
      if (wrong.length === 3) {
        setProbe({ word, options: shuffle([word.meaning!, ...wrong]), picked: null });
        return;
      }
    }
    void submitScreen(null);
  }

  // A right answer moves straight on; a miss stays until "Next", so the meaning
  // can be read first.
  function answerProbe(opt: string) {
    if (!probe || probe.picked || busy) return;
    setProbe({ ...probe, picked: opt });
    if (opt === probe.word.meaning) void submitScreen({ word: probe.word.word, right: true });
  }

  async function submitScreen(asked: { word: string; right: boolean } | null) {
    if (!screen) return;
    const finished: DoneCheckScreen = {
      level: screen.level,
      answers: screen.words.map((w) => ({ word: w.word, known: !unknown.has(w.word) })),
      probe: asked,
    };
    const screens = [...done, finished];
    setBusy(true);
    try {
      const r = await askCheck(screens);
      if (r.screen) {
        setScreen(r.screen);
        setUnknown(new Set());
        setProbe(null);
        toTop();
      } else if (r.result) {
        await onResult(r.result);
      }
      setDone(screens);
    } catch (e) {
      // The screen stays, with its taps: "Next" sends it again.
      setProbe(null);
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  if (!screen)
    return failed ? (
      <Button variant="outline" onClick={() => void first()}>
        {t("errState.retry")}
      </Button>
    ) : (
      <div className="space-y-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-24 rounded-[16px]" />
      </div>
    );

  return (
    <div ref={topRef}>
      <p className="mb-3 text-[12px] font-semibold uppercase tracking-wide text-ink-faint">
        {t("check.screen", { n: screen.n, of: screen.of, level: screen.level === 7 ? "7–9" : screen.level })}
      </p>
      {probe ? (
        <div className="anim-fade-up rounded-[18px] border border-black/[0.06] bg-surface p-4 text-center sm:p-6">
          <p className="text-[13px] font-medium text-ink-faint">{t("sweep.checkWhy")}</p>
          <p className="mt-2 text-[15px] text-ink-soft">{t("sweep.checkQ")}</p>
          <div className="mt-1 font-zh text-[36px] font-medium text-ink">{probe.word.word}</div>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {probe.options.map((opt) => {
              const right = opt === probe.word.meaning;
              return (
                <button
                  key={opt}
                  type="button"
                  disabled={!!probe.picked || busy}
                  onClick={() => answerProbe(opt)}
                  className={cn(
                    "rounded-[14px] border px-4 py-3 text-left text-[15px] font-medium transition-colors",
                    probe.picked && right
                      ? "border-sage bg-sage-tint text-sage-deep"
                      : probe.picked === opt
                        ? "border-warn bg-warn-bg text-warn-text"
                        : "border-black/[0.08] bg-surface text-ink hover:border-sage/60",
                  )}
                >
                  {opt}
                </button>
              );
            })}
          </div>
          {probe.picked && probe.picked !== probe.word.meaning && (
            <div className="mt-4 space-y-3">
              <p className="text-[14px] text-ink-soft">{t("sweep.checkMiss", { word: probe.word.word, meaning: probe.word.meaning! })}</p>
              <Button onClick={() => void submitScreen({ word: probe.word.word, right: false })} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t("sweep.next")}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {screen.words.map((w) => {
              const on = unknown.has(w.word);
              return (
                <button
                  key={w.word}
                  type="button"
                  onClick={() => setUnknown((s) => toggleIn(s, w.word))}
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
            <Button className="w-full sm:w-auto" disabled={busy} onClick={confirmScreen}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {screen.n >= screen.of ? t("hskFirst.seeMark") : t("check.next")}
            </Button>
            <span className="text-[13px] text-ink-soft">{t("hskFirst.tapped", { n: unknown.size })}</span>
            {onSkip && (
              <button
                type="button"
                onClick={onSkip}
                disabled={busy}
                className="text-[13px] font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline sm:ml-auto"
              >
                {skipLabel ?? t("onb.skipCheck")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// What the check found, told straight: each level it asked, the estimate it
// makes of the whole list up to the target (the plan's or the mark's own sum, so
// the numbers after it agree), what the made-up words said, and the long form —
// a sweep of the level — for anyone who wants it exact.
export function CheckSummary({
  result,
  estimate,
  account,
  levelName,
  sweepHref,
}: {
  result: CheckResult;
  estimate: { known: number; total: number } | null;
  account?: boolean; // the estimate also stands on what the account showed before
  levelName: string;
  sweepHref: string | null;
}) {
  const { t } = useI18n();
  const { claimed, shown } = result.fakes;
  const made = result.fakeKnown.join(", ");
  const vars = estimate
    ? { known: estimate.known.toLocaleString(), total: estimate.total.toLocaleString(), level: levelName, asked: result.asked }
    : null;
  return (
    <div className="mb-5 rounded-[16px] border border-black/[0.06] bg-surface p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("check.resultTitle")}</p>
      <div className="mt-2 space-y-1.5">
        {result.levels.map((l) => (
          <div key={l.level} className="flex items-center gap-3">
            <span className="w-[58px] shrink-0 text-[12px] font-semibold text-ink-soft">
              {l.level === 7 ? t("hsk.band79") : t("hsk.level", { n: l.level })}
            </span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-track">
              <span className="block h-full bg-sage" style={{ width: `${(l.knew / Math.max(1, l.asked)) * 100}%` }} />
            </span>
            <span className="shrink-0 text-[12px] text-ink-soft">{t("check.levelRow", { knew: l.knew, asked: l.asked })}</span>
          </div>
        ))}
      </div>
      {vars && estimate!.total > 0 && (
        <p className="mt-3 text-[14px] leading-snug text-ink">{t(account ? "check.estimateAccount" : "check.estimate", vars)}</p>
      )}
      {shown > 0 && (
        <p className="mt-2 text-[13px] leading-snug text-ink-soft">
          {claimed === 0
            ? t("check.fakesNone", { n: shown })
            : claimed === 1
              ? t("check.fakesOne", { words: made })
              : t("check.fakesSome", { n: claimed, shown, words: made })}
        </p>
      )}
      <p className="mt-2 text-[13px] leading-snug text-ink-soft">
        {sweepHref ? (
          <Link href={sweepHref} className="font-semibold text-sage-deep underline-offset-2 hover:underline">
            {t("check.sweep", { level: levelName })}
          </Link>
        ) : (
          t("check.sweepLater", { level: levelName })
        )}
      </p>
    </div>
  );
}
