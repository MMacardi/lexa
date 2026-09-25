"use client";

import { useEffect, useRef, useState, type ComponentType } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { api, type HskVersion, type HskWord } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import { FOCUS } from "@/lib/focus";
import { useToast } from "@/lib/toast";
import { errText } from "@/lib/errText";
import { setLevel as setPrefLevel, pushRecentPair, setNativeLang, setDailyGoal, setNewPerDay, type CefrLevel } from "@/lib/learnPrefs";
import { LangSelect } from "@/components/LangSelect";
import { langFlag, langLabel } from "@/lib/langs";
import { Button } from "@/components/ui/button";
import { ImportWordsDialog } from "@/components/ImportWordsDialog";
import { HskWordChip } from "@/components/HskWordChip";
import { prefetchCoachPicks } from "@/components/CoachPicks";
import {
  BookOpen,
  Briefcase,
  CalendarDays,
  Check,
  ChevronLeft,
  Clapperboard,
  Coins,
  Cpu,
  Dumbbell,
  FlaskConical,
  Flame,
  Footprints,
  Gamepad2,
  GraduationCap,
  Heart,
  Landmark,
  Languages,
  Layers,
  Leaf,
  Loader2,
  MessageCircle,
  MessagesSquare,
  Music,
  Newspaper,
  Plane,
  School,
  Shirt,
  Sparkles,
  Sprout,
  Target,
  Trophy,
  UtensilsCrossed,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

// The one onboarding path, the way phone apps do it now: a question per screen
// (the language words are explained in, why Chinese, how much they know, the
// target and the exam date, what they're into, how many words a day), then the
// plan those answers make, then the check → gap deck → first review as before.
// Every answer lands somewhere that uses it: the target and daily goal on the
// account (daily words, readiness mark), the reasons and interests in the coach
// memory (the Coach's picks, examples, the tutor). Everything is one language
// pair — Chinese, explained in what the learner already knows — because that is
// the product: HSK prep for Russian speakers. Other languages drop back to the
// generic FirstRun.

const MAX_LEVEL: Record<HskVersion, number> = { "2.0": 6, "3.0": 7 };

// The check writes PlacementAnswers and the gap deck reads them, so a run of
// ~24 words is the cheapest honest signal: enough to move the mark, short
// enough to tap through before anyone loses interest.
const CHECK_SIZE = 24;
const DECK_SIZE = 20;

// Cards are still generated at a CEFR level (examples, synonyms), so the HSK
// target has to name one. Rough but stable: HSK 1–2 are A1/A2, 3 is B1, 4 is B2,
// 5 and up are C1 — the mapping the HSK bands are usually published against.
// Shared with Today's daily words (HskDaily), which make cards at the same level.
export const CEFR_FOR_HSK: Record<number, CefrLevel> = { 1: "A1", 2: "A2", 3: "B1", 4: "B2", 5: "C1", 6: "C1", 7: "C2" };

type Step = "lang" | "goal" | "level" | "target" | "interests" | "daily" | "plan" | "check" | "deck" | "done" | "building" | "ready";
const STEPS: Step[] = ["lang", "goal", "level", "target", "interests", "daily", "plan", "check", "deck", "done"];
// Before sign-in the whole first five minutes happen here: the questions, the
// check, the plan being built, the words — and the account comes last, to keep them.
const GUEST_STEPS: Step[] = ["lang", "goal", "level", "target", "interests", "daily", "check", "building", "ready"];
// Lines on the "building your plan" screen, ticked off one by one.
const BUILD_STEPS = 4;
const BUILD_STEP_MS = 850;

type Icon = ComponentType<{ className?: string }>;

const GOALS: { id: string; Icon: Icon }[] = [
  { id: "exam", Icon: GraduationCap },
  { id: "study", Icon: School },
  { id: "work", Icon: Briefcase },
  { id: "travel", Icon: Plane },
  { id: "media", Icon: Clapperboard },
  { id: "people", Icon: Heart },
  { id: "self", Icon: Sparkles },
];

// Self-rated level, 0 = none. It picks the default target (one above) and a
// learner starting from zero skips the check: there is nothing to check yet.
const LEVELS: Icon[] = [Sprout, Leaf, MessageCircle, MessagesSquare, BookOpen, Newspaper];

const EXAMS = ["none", "3", "6", "12", "later"] as const;
type Exam = (typeof EXAMS)[number];

const INTERESTS: { id: string; Icon: Icon }[] = [
  { id: "food", Icon: UtensilsCrossed },
  { id: "travel", Icon: Plane },
  { id: "tech", Icon: Cpu },
  { id: "business", Icon: Coins },
  { id: "films", Icon: Clapperboard },
  { id: "music", Icon: Music },
  { id: "sport", Icon: Trophy },
  { id: "games", Icon: Gamepad2 },
  { id: "science", Icon: FlaskConical },
  { id: "history", Icon: Landmark },
  { id: "nature", Icon: Leaf },
  { id: "fashion", Icon: Shirt },
];

const DAILY: { n: number; Icon: Icon }[] = [
  { n: 5, Icon: Leaf },
  { n: 10, Icon: Footprints },
  { n: 15, Icon: Flame },
  { n: 20, Icon: Zap },
];
// Words a day that make a target reachable by the exam, roughly: a closer date
// asks for more. Only a suggestion — it is tagged, not chosen for them.
const DAILY_FOR_EXAM: Record<Exam, number> = { none: 10, "3": 20, "6": 15, "12": 10, later: 10 };

// The answers, kept on the device between the questions (asked before sign-in,
// the way phone apps do it) and the account they end up on. Cleared once the
// plan is committed.
const ANSWERS_KEY = "onomika.onboarding";
export const OTHER_LANGUAGE_KEY = "onomika.onboarding.other";
type Answers = {
  native: string;
  goals: string[];
  known: number | null;
  version: HskVersion;
  target: number;
  exam: Exam;
  interests: string[];
  daily: number;
};

function readAnswers(): Answers | null {
  if (typeof window === "undefined") return null;
  try {
    const a = JSON.parse(localStorage.getItem(ANSWERS_KEY) ?? "null") as Answers | null;
    return a && typeof a.target === "number" && Array.isArray(a.goals) ? a : null;
  } catch {
    return null;
  }
}

// Everything a guest's onboarding decided, waiting on the device until they sign
// in; Today applies it once (GuestPlan.tsx) so the words are there on arrival.
export const GUEST_PLAN_KEY = "onomika.guestPlan";
export type GuestPlan = {
  native: string;
  version: HskVersion;
  target: number;
  daily: number;
  goal: string; // coach memory, in the interface language they answered in
  likes: string;
  known: string[]; // the check's "know it", plus deck words turned down
  unknown: string[]; // the check's taps
  words: string[]; // the first deck
};

export function readGuestPlan(): GuestPlan | null {
  if (typeof window === "undefined") return null;
  try {
    const p = JSON.parse(localStorage.getItem(GUEST_PLAN_KEY) ?? "null") as GuestPlan | null;
    return p && typeof p.target === "number" && Array.isArray(p.words) ? p : null;
  } catch {
    return null;
  }
}

export function clearGuestPlan() {
  try {
    localStorage.removeItem(GUEST_PLAN_KEY);
  } catch {
    /* ignore */
  }
}

// A tappable answer: a full-width card with an icon, for one-per-screen questions.
function Choice({
  on,
  onClick,
  Icon,
  label,
  desc,
  tag,
  multi,
}: {
  on: boolean;
  onClick: () => void;
  Icon?: Icon;
  label: string;
  desc?: string;
  tag?: string;
  multi?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        "flex w-full items-center gap-3 rounded-[16px] border px-4 py-3 text-left transition-colors",
        on ? "border-sage bg-sage-tint/60" : "border-black/[0.08] bg-surface hover:bg-black/[0.02]",
      )}
    >
      {Icon && (
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors",
            on ? "bg-sage text-white" : "bg-sage-tint/60 text-sage-deep",
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-semibold text-ink">{label}</span>
        {desc && <span className="mt-0.5 block text-[13px] leading-snug text-ink-soft">{desc}</span>}
      </span>
      {tag && (
        <span className="shrink-0 rounded-full bg-sage px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">{tag}</span>
      )}
      {multi && (
        <span
          className={cn(
            "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors",
            on ? "border-sage bg-sage text-white" : "border-black/20 bg-surface",
          )}
        >
          {on && <Check className="h-3.5 w-3.5" />}
        </span>
      )}
    </button>
  );
}

// The flow runs once per account. After it the next words come by themselves, a
// day's worth at a time, on Today (HskDaily).
//
// `guest`: the questions before sign-in. The plan's button saves the answers and
// hands over to sign-in (`onGuestDone`); signed in, the flow picks them up and
// opens on the plan, one tap from the check.
export function HskFirstRun({
  onOther,
  onClose,
  guest,
  onGuestDone,
}: {
  onOther?: () => void;
  onClose?: () => void;
  guest?: boolean;
  onGuestDone?: () => void;
}) {
  const { accountId } = useAccount();
  const { t, locale } = useI18n();
  const { show, trackImport } = useToast();
  const qc = useQueryClient();

  // Answers the first pre-sign-in version saved (questions only, no check): the
  // flow resumes on the plan. The current one hands over a whole GuestPlan instead.
  const [saved] = useState(() => (guest ? null : readAnswers()));
  // "I already know" — Russian by default, and only overridden by the browser's
  // own language. The learning side is never a picker here: it is Chinese.
  const [native, setNative] = useState(saved?.native ?? (locale === "zh" ? "en" : locale === "en" ? "en" : "ru"));
  const [goals, setGoals] = useState<Set<string>>(new Set(saved?.goals ?? ["exam"]));
  const [known, setKnown] = useState<number | null>(saved?.known ?? null); // self-rated level, 0–5
  const [version, setVersion] = useState<HskVersion>(saved?.version ?? "3.0");
  const [target, setTarget] = useState(saved?.target ?? 4);
  const [exam, setExam] = useState<Exam>(saved?.exam ?? "none");
  const [interests, setInterests] = useState<Set<string>>(new Set(saved?.interests ?? []));
  const [daily, setDaily] = useState(saved?.daily ?? 10);

  const [step, setStep] = useState<Step>(saved ? "plan" : "lang");
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState<HskWord[]>([]);
  const [unknown, setUnknown] = useState<Set<string>>(new Set());
  const [knownCount, setKnownCount] = useState(0);
  const [gap, setGap] = useState<HskWord[]>([]);
  // Deck words the learner turned down as already known (saved on build).
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState(0);

  const level = CEFR_FOR_HSK[target] ?? "B1";
  const levelName = target === 7 ? "7–9" : String(target);
  const fromZero = known === 0;
  const recommended = DAILY_FOR_EXAM[exam];
  const steps = guest ? GUEST_STEPS : STEPS;
  const idx = steps.indexOf(step);
  // Back is offered through the questions (and, before sign-in, from the check).
  const backable = idx > 0 && idx <= steps.indexOf(guest ? "check" : "plan");
  // The "building your plan" screen: which line is ticking, and the check's
  // answers it was built from (kept for the account after sign-in).
  const [buildStep, setBuildStep] = useState(0);
  const [answers, setAnswers] = useState<{ known: string[]; unknown: string[] }>({ known: [], unknown: [] });
  const buildTimer = useRef(0);
  useEffect(() => () => window.clearInterval(buildTimer.current), []);

  // Each step opens at its own top: on a phone the last answer tapped sits low on
  // the screen, and the next question would otherwise start half scrolled away.
  const rootRef = useRef<HTMLDivElement>(null);
  const go = (s: Step) => {
    setStep(s);
    const top = rootRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) window.scrollBy({ top: top - 72, behavior: "smooth" });
  };
  // A single-choice answer moves on by itself, after the tap has shown.
  const pickThen = (apply: () => void, next: Step) => {
    apply();
    window.setTimeout(() => go(next), 180);
  };
  const toggleIn = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  };

  // What the coach memory keeps: the reasons (the exam one carries the target and
  // the date) and the interests, in the learner's own interface language — it is
  // shown back to them on the Coach, and the model reads any language.
  function memoryText() {
    const goal = GOALS.filter((g) => goals.has(g.id))
      .map((g) =>
        g.id === "exam"
          ? `HSK ${levelName}${exam !== "none" ? ` (${t(`onb.exam.${exam}`)})` : ""}`
          : t(`onb.goal.${g.id}`),
      )
      .join(", ");
    const likes = INTERESTS.filter((i) => interests.has(i.id))
      .map((i) => t(`onb.int.${i.id}`))
      .join(", ");
    return { goal, likes };
  }

  // Before sign-in, after the last question: the check (public list data, no
  // account needed), or straight to building for someone starting from zero.
  async function guestNext() {
    if (fromZero) {
      startBuilding([], []);
      return;
    }
    setBusy(true);
    try {
      const r = await api.publicHskCheck(version, target, CHECK_SIZE);
      setCheck(r.words);
      setUnknown(new Set());
      go("check");
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  // The screen phone apps put here: the plan being put together, a line at a
  // time. The deck request runs underneath and is back long before the last
  // line, so the wait is the few seconds of the animation, not the network.
  function startBuilding(knownWords: string[], unknownWords: string[]) {
    setAnswers({ known: knownWords, unknown: unknownWords });
    setBuildStep(0);
    setGap([]);
    setRejected(new Set());
    go("building");
    const deck = api.publicHskDeck({ version, level: target, known: knownWords, unknown: unknownWords, size: DECK_SIZE });
    let n = 0;
    window.clearInterval(buildTimer.current);
    // The last line keeps spinning until the words are really there.
    buildTimer.current = window.setInterval(() => {
      n += 1;
      setBuildStep(n);
      if (n >= BUILD_STEPS - 1) window.clearInterval(buildTimer.current);
    }, BUILD_STEP_MS);
    Promise.all([deck, new Promise((r) => window.setTimeout(r, BUILD_STEP_MS * BUILD_STEPS))])
      .then(([r]) => {
        setGap(r.words);
        setBuildStep(BUILD_STEPS);
        window.setTimeout(() => go("ready"), 450);
      })
      .catch((e) => {
        window.clearInterval(buildTimer.current);
        show({ icon: "⚠️", title: errText(e, t) });
        go(fromZero ? "daily" : "check");
      });
  }

  // "Sign in to start": the plan and the words wait on the device; Today applies
  // them the moment the account exists.
  function saveForSignIn() {
    const { goal, likes } = memoryText();
    const plan: GuestPlan = {
      native,
      version,
      target,
      daily,
      goal,
      likes,
      known: [...answers.known, ...rejected],
      unknown: answers.unknown,
      words: gap.map((w) => w.word).filter((w) => !rejected.has(w)),
    };
    try {
      localStorage.setItem(GUEST_PLAN_KEY, JSON.stringify(plan));
    } catch {
      /* private mode: the account starts from the onboarding again */
    }
    onGuestDone?.();
  }

  // The plan, kept before anything else runs: a learner who drops out at the
  // check still has their target, daily goal, language and reasons remembered.
  async function commitPlan() {
    if (busy) return;
    setBusy(true);
    try {
      try {
        localStorage.removeItem(ANSWERS_KEY);
      } catch {
        /* ignore */
      }
      setNativeLang(native);
      setPrefLevel("zh", level);
      pushRecentPair("zh", native);
      setDailyGoal(daily);
      setNewPerDay(daily); // review introduces what the plan promised, not the default 15
      try {
        localStorage.setItem("lexa.wordPair", JSON.stringify({ sourceLang: "zh", targetLang: native }));
      } catch {
        /* ignore */
      }
      void api.updateLearnerPrefs({ hskVersion: version, hskTarget: target, nativeLang: native, dailyGoal: daily }).catch(() => {});
      const { goal, likes } = memoryText();
      // The Coach's "Words for you" are made now, while the check runs, so Today has
      // them waiting — after the memory lands, so they follow the goal.
      void api
        .updateCoachProfile({ telegramId: accountId, lang: "zh", goal, interests: likes })
        .catch(() => {})
        .then(() => prefetchCoachPicks(qc, accountId, "zh", native));

      if (fromZero) {
        // Nothing to check yet: the first deck is the start of the target level.
        const r = await api.hskGap(version, target, DECK_SIZE);
        setCheck([]);
        setGap(r.words);
        setRejected(new Set());
        go("deck");
      } else {
        const r = await api.hskCheck(version, target, CHECK_SIZE);
        setCheck(r.words);
        setUnknown(new Set());
        go("check");
      }
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  async function finishCheck() {
    if (guest) {
      const knownWords = check.map((w) => w.word).filter((w) => !unknown.has(w));
      setKnownCount(knownWords.length);
      startBuilding(knownWords, [...unknown]);
      return;
    }
    setBusy(true);
    try {
      const knownWords = check.map((w) => w.word).filter((w) => !unknown.has(w));
      setKnownCount(knownWords.length);
      await api.savePlacement({
        sourceLang: "zh",
        targetLang: native,
        level,
        known: knownWords,
        unknown: [...unknown],
      });
      // The gap deck is computed after the taps land, so the words the learner
      // just said they know never come back as something to learn.
      const r = await api.hskGap(version, target, DECK_SIZE);
      setGap(r.words);
      setRejected(new Set());
      go("deck");
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  async function buildDeck() {
    const words = gap.map((w) => w.word).filter((w) => !rejected.has(w));
    if (!words.length || busy) return;
    setBusy(true);
    try {
      // A turned-down word is an "I know it" like the check's, so it never comes
      // back in a deck or in the daily words.
      if (rejected.size) {
        await api.savePlacement({ sourceLang: "zh", targetLang: native, level, known: [...rejected], unknown: [] });
      }
      const r = await api.batchAddWords({ telegramId: accountId, sourceLang: "zh", targetLang: native, words, level, enrich: true });
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["hskReadiness"] });
      if (r.job) trackImport({ jobId: r.job.id, telegramId: accountId, words, total: r.job.total, processed: 0 });
      setAdded(r.created);
      go("done");
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setBusy(false);
    }
  }

  const heading = (title: string, sub?: string) => (
    <div className="mb-4">
      <h2 className="font-serif text-[24px] font-medium leading-tight text-ink sm:text-[28px]">{title}</h2>
      {sub && <p className="mt-1.5 max-w-[540px] text-[14px] leading-relaxed text-ink-soft">{sub}</p>}
    </div>
  );

  const { goal: goalText, likes } = memoryText();
  const planSummary = (
    <ul className="space-y-2.5 rounded-[16px] border border-black/[0.06] bg-surface p-4">
      <li className="flex items-start gap-3 text-[14px] text-ink">
        <Target className="mt-0.5 h-4 w-4 shrink-0 text-sage-deep" />
        <span>
          <span className="font-semibold">{t("onb.planTarget", { level: levelName, list: version })}</span>
          {exam !== "none" && <span className="text-ink-soft"> · {t(`onb.exam.${exam}`)}</span>}
        </span>
      </li>
      <li className="flex items-start gap-3 text-[14px] text-ink">
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-sage-deep" />
        {t("onb.planDaily", { n: daily })}
      </li>
      <li className="flex items-start gap-3 text-[14px] text-ink">
        <Languages className="mt-0.5 h-4 w-4 shrink-0 text-sage-deep" />
        {t("onb.planLang", { lang: langLabel(native) })}
      </li>
      {(goalText || likes) && (
        <li className="flex items-start gap-3 text-[14px] text-ink">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-sage-deep" />
          {t("onb.planFor", { what: [goalText, likes].filter(Boolean).join(" · ") })}
        </li>
      )}
    </ul>
  );
  const buildLines = [
    t("onb.build.answers"),
    fromZero ? t("onb.build.zero") : t("onb.build.level", { known: knownCount, shown: check.length, level: levelName }),
    t("onb.build.words", { n: DECK_SIZE, level: levelName }),
    t("onb.build.pace", { n: daily }),
  ];

  return (
    <div ref={rootRef} className="anim-fade-up space-y-4">
      <div className="rounded-[22px] border border-sage/25 bg-gradient-to-br from-sage-tint/50 via-surface to-surface p-5 sm:p-6">
        {/* where you are: back, progress, and what this is */}
        <div className="mb-5 flex items-center gap-3">
          {backable ? (
            <button
              type="button"
              onClick={() => go(steps[idx - 1])}
              aria-label={t("onb.back")}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-black/[0.05] hover:text-ink"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : (
            <GraduationCap className="h-5 w-5 shrink-0 text-sage-deep" />
          )}
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06]">
            <div
              className="h-full rounded-full bg-sage transition-[width] duration-300"
              style={{ width: `${((idx + 1) / steps.length) * 100}%` }}
            />
          </div>
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-sage-deep">{t("onb.eyebrow")}</span>
        </div>

        {step === "lang" && (
          <>
            {heading(t("onb.langTitle"), t("onb.langSub"))}
            <div className="space-y-2">
              {["ru", "en"].map((l) => (
                <Choice
                  key={l}
                  on={native === l}
                  onClick={() => pickThen(() => setNative(l), "goal")}
                  label={`${langFlag(l)} ${langLabel(l)}`}
                />
              ))}
              <div className="flex flex-wrap items-center gap-3 rounded-[16px] border border-black/[0.08] bg-surface px-4 py-3">
                <Languages className="h-5 w-5 text-sage-deep" />
                <span className="text-[14px] font-medium text-ink-soft">{t("onb.langOther")}</span>
                <LangSelect value={native} onChange={setNative} className="w-[168px]" />
              </div>
            </div>
            {native !== "ru" && native !== "en" && (
              <Button className="mt-4 w-full sm:w-auto" onClick={() => go("goal")}>
                {t("onb.continue")}
              </Button>
            )}
          </>
        )}

        {step === "goal" && (
          <>
            {heading(t("onb.goalTitle"), t("onb.goalSub"))}
            <div className="grid gap-2 sm:grid-cols-2">
              {GOALS.map((g) => (
                <Choice
                  key={g.id}
                  multi
                  Icon={g.Icon}
                  on={goals.has(g.id)}
                  onClick={() => setGoals((s) => toggleIn(s, g.id))}
                  label={t(`onb.goal.${g.id}`)}
                />
              ))}
            </div>
            <Button className="mt-4 w-full sm:w-auto" disabled={goals.size === 0} onClick={() => go("level")}>
              {t("onb.continue")}
            </Button>
          </>
        )}

        {step === "level" && (
          <>
            {heading(t("onb.levelTitle"), t("onb.levelSub"))}
            <div className="space-y-2">
              {LEVELS.map((Icon, n) => (
                <Choice
                  key={n}
                  Icon={Icon}
                  on={known === n}
                  onClick={() =>
                    pickThen(() => {
                      setKnown(n);
                      setTarget(Math.min(MAX_LEVEL[version], n + 1));
                    }, "target")
                  }
                  label={t(`onb.level.${n}`)}
                  desc={t(`onb.level.${n}d`)}
                />
              ))}
            </div>
          </>
        )}

        {step === "target" && (
          <>
            {heading(t("onb.targetTitle"), t("onb.targetSub"))}
            <div className="flex flex-wrap gap-2">
              {Array.from({ length: MAX_LEVEL[version] }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTarget(n)}
                  aria-pressed={n === target}
                  className={cn(
                    "rounded-full border px-4 py-2 text-[15px] font-semibold transition-colors",
                    n === target ? "border-sage bg-sage text-white" : "border-black/[0.08] bg-surface text-ink hover:bg-black/[0.03]",
                  )}
                >
                  {n === 7 ? t("hsk.band79") : t("hsk.level", { n })}
                </button>
              ))}
            </div>

            <p className="mt-5 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("onb.examTitle")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {EXAMS.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => {
                    setExam(e);
                    setDaily(DAILY_FOR_EXAM[e]);
                  }}
                  aria-pressed={e === exam}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[14px] font-medium transition-colors",
                    e === exam ? "border-sage bg-sage text-white" : "border-black/[0.08] bg-surface text-ink hover:bg-black/[0.03]",
                  )}
                >
                  {e !== "none" && <CalendarDays className="h-3.5 w-3.5" />}
                  {t(`onb.exam.${e}`)}
                </button>
              ))}
            </div>

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

            <Button className="mt-5 w-full sm:w-auto" onClick={() => go("interests")}>
              {t("onb.continue")}
            </Button>
          </>
        )}

        {step === "interests" && (
          <>
            {heading(t("onb.interestsTitle"), t("onb.interestsSub"))}
            <div className="flex flex-wrap gap-2">
              {INTERESTS.map(({ id, Icon }) => {
                const on = interests.has(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setInterests((s) => toggleIn(s, id))}
                    aria-pressed={on}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-[14px] font-medium transition-colors",
                      on ? "border-sage bg-sage text-white" : "border-black/[0.08] bg-surface text-ink hover:bg-black/[0.03]",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {t(`onb.int.${id}`)}
                  </button>
                );
              })}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button className="w-full sm:w-auto" onClick={() => go("daily")}>
                {interests.size ? t("onb.continue") : t("onb.skip")}
              </Button>
            </div>
          </>
        )}

        {step === "daily" && (
          <>
            {heading(t("onb.dailyTitle"), t("onb.dailySub"))}
            <div className="space-y-2">
              {DAILY.map(({ n, Icon }) => (
                <Choice
                  key={n}
                  Icon={Icon}
                  on={daily === n}
                  onClick={() => {
                    if (!guest) return pickThen(() => setDaily(n), "plan");
                    setDaily(n);
                    window.setTimeout(guestNext, 180);
                  }}
                  label={`${t(`onb.daily.${n}`)} · ${t("onb.dailyN", { n })}`}
                  desc={t("onb.dailyTime", { m: n })}
                  tag={exam !== "none" && n === recommended ? t("onb.recommended") : undefined}
                />
              ))}
            </div>
          </>
        )}

        {step === "plan" && (
          <>
            {heading(t("onb.planTitle"), fromZero ? t("onb.planSubZero") : t("onb.planSub"))}
            {planSummary}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button className="w-full sm:w-auto" disabled={busy} onClick={commitPlan}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <GraduationCap className="mr-2 h-4 w-4" />}
                {fromZero ? t("onb.startZero") : t("hskFirst.startCheck")}
              </Button>
              {!fromZero && <span className="text-[13px] text-ink-soft">{t("hskFirst.checkLen", { n: CHECK_SIZE })}</span>}
            </div>
          </>
        )}

        {step === "building" && (
          <div>
            {heading(t("onb.buildTitle"), t("onb.buildSub"))}
            <ul className="space-y-3">
              {buildLines.map((line, i) => (
                <li key={i} className="flex items-center gap-3 text-[15px]">
                  <span
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors duration-300",
                      i < buildStep ? "bg-sage text-white" : "bg-sage-tint/60 text-sage-deep",
                    )}
                  >
                    {i < buildStep ? (
                      <Check className="h-4 w-4" />
                    ) : i === buildStep ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    )}
                  </span>
                  <span className={cn("transition-colors duration-300", i <= buildStep ? "text-ink" : "text-ink-faint")}>{line}</span>
                </li>
              ))}
            </ul>
            <div className="mt-6 h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
              <div
                className="h-full rounded-full bg-sage transition-[width] duration-700 ease-out"
                style={{ width: `${Math.min(100, ((buildStep + 0.5) / BUILD_STEPS) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {step === "ready" && (
          <div>
            {heading(
              t("onb.readyTitle"),
              check.length
                ? t("hskFirst.markLine", { known: knownCount, shown: check.length, level: levelName })
                : t("onb.deckZero", { level: levelName }),
            )}
            {planSummary}
            <p className="mt-5 text-[15px] font-semibold text-ink">{t("onb.readyWords", { n: gap.length - rejected.size })}</p>
            <p className="mt-0.5 mb-3 text-[13px] leading-relaxed text-ink-soft">{t("hskFirst.rejectHint")}</p>
            <div className="flex flex-wrap gap-1.5">
              {gap.map((w) => (
                <HskWordChip
                  key={w.word}
                  word={w.word}
                  pinyin={w.pinyin}
                  level={w.level}
                  known={rejected.has(w.word)}
                  onToggle={() => setRejected((s) => toggleIn(s, w.word))}
                />
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button className="w-full sm:w-auto" disabled={gap.length === rejected.size} onClick={saveForSignIn}>
                <Sparkles className="mr-2 h-4 w-4" />
                {t("onb.readyCta")}
              </Button>
              <span className="text-[13px] text-ink-soft">{t("onb.readyHint")}</span>
            </div>
          </div>
        )}

        {step === "check" && (
          <div>
            {heading(t("hskFirst.tapTitle"), t("hskFirst.tapSub"))}
            <div className="flex flex-wrap gap-1.5">
              {check.map((w) => {
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
              <Button className="w-full sm:w-auto" disabled={busy} onClick={finishCheck}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                {t("hskFirst.seeMark")}
              </Button>
              <span className="text-[13px] text-ink-soft">{t("hskFirst.tapped", { n: unknown.size })}</span>
            </div>
          </div>
        )}

        {step === "deck" && (
          <div>
            {heading(
              check.length
                ? t("hskFirst.markLine", { known: knownCount, shown: check.length, level: levelName })
                : t("onb.deckZero", { level: levelName }),
              check.length ? t("hskFirst.markSub") : undefined,
            )}
            <p className="-mt-2 mb-3 text-[13px] leading-relaxed text-ink-soft">{t("hskFirst.rejectHint")}</p>
            <div className="flex flex-wrap gap-1.5">
              {gap.map((w) => (
                <HskWordChip
                  key={w.word}
                  word={w.word}
                  pinyin={w.pinyin}
                  level={w.level}
                  known={rejected.has(w.word)}
                  onToggle={() => setRejected((s) => toggleIn(s, w.word))}
                />
              ))}
            </div>
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <Button className="w-full sm:w-auto" disabled={busy || gap.length === rejected.size} onClick={buildDeck}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Layers className="mr-2 h-4 w-4" />}
                {t("hskFirst.buildGap", { n: gap.length - rejected.size })}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && (
          <div>
            {heading(t("hskFirst.doneTitle", { n: added }), t("hskFirst.doneSub"))}
            <div className="flex flex-wrap gap-3">
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
              {/* Opened from Today's offer, it has somewhere to go back to; the
                  first run on an empty account is the page, so it gets no close. */}
              {onClose && (
                <Button variant="outline" onClick={onClose}>
                  {t("hskFirst.close")}
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* The textbook path: this week's list, photographed or pasted, becomes
          cards in the same pair — a way in that skips the questions. */}
      {step === "lang" && !guest && (
        <div className="rounded-[22px] border border-black/[0.06] bg-surface p-5">
          <p className="text-[15px] font-semibold text-ink">{t("hskFirst.textbookTitle")}</p>
          <p className="mt-0.5 mb-3 text-[13px] leading-relaxed text-ink-soft">{t("hskFirst.textbookSub")}</p>
          <ImportWordsDialog defaultSourceLang="zh" defaultTargetLang={native} triggerLabel={t("hskFirst.textbookOpen")} />
        </div>
      )}

      {/* Only the empty-account run offers the way out to another language — the
          offer on Today was opened deliberately by someone choosing the HSK track.
          Hidden while focused: the app is HSK prep, and the link read as a second
          product on the first screen. */}
      {!FOCUS && onOther && step === "lang" && (
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
