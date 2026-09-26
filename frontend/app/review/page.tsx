"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { api, isDue, type Word } from "@/lib/api";
import { useAccount } from "@/lib/account";
import { useI18n } from "@/lib/i18n";
import {
  useCardLayout,
  setCardLayout,
  getRecentPairs,
  getNewPerDay,
  useSwipeUpDown,
  setSwipeUpDown,
  usePlayOnFlip,
  setPlayOnFlip,
  CARD_PRESETS,
  CARD_FIELDS,
  type CardField,
  type CardLayout,
} from "@/lib/learnPrefs";
import { pairLabel } from "@/lib/langs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SpeakButton } from "@/components/SpeakButton";
import { FitText } from "@/components/FitText";
import { DictMeaningLabel } from "@/components/DictMeaningLabel";
import { PronounceButton } from "@/components/PronounceButton";
import { ExampleText } from "@/components/ExampleText";
import { Confetti } from "@/components/Confetti";
import { CollectionSelect } from "@/components/CollectionSelect";
import { CardLayoutPreview } from "@/components/CardLayoutPreview";
import { EditWordModal } from "@/components/EditWordModal";
import { PairMultiSelect } from "@/components/PairMultiSelect";
import { QuickChip } from "@/components/ui/QuickChip";
import { OnceHint } from "@/components/OnceHint";
import { previewMinutes, applyGradeLocally } from "@/lib/fsrsPreview";
import { fetchWordsCached, mirrorWords, submitReview, undoReview } from "@/lib/sync";
import { useToast } from "@/lib/toast";
import { ArrowRight, BookOpen, Dumbbell, ExternalLink, MoveVertical, Pencil, Repeat, Sparkles, Undo2, Volume2, VolumeX } from "lucide-react";
import { canSpeak, speak } from "@/lib/speak";
import { cn } from "@/lib/utils";
import { useDragFollower } from "@/lib/dragFollow";
import { Segmented } from "@/components/ui/Segmented";
import { Disclosure } from "@/components/ui/Disclosure";

const targetFont = (lang: string) => (lang === "zh" || lang === "zh-Hant" ? "font-zh" : "");
const sourceFont = (lang: string) => (lang === "zh" || lang === "zh-Hant" || lang === "ja" ? "font-zh" : "");
const pairKey = (w: Word) => `${w.sourceLang}>${w.targetLang}`;

// Swipe geometry. EDGE_PX is a dead zone at the left and right screen edges: iOS
// treats a drag that starts there as its back/forward navigation and no amount of
// touch-action stops it, so a swipe begun on the edge would drag the whole page.
const SWIPE_PX = 110;
const EDGE_PX = 24;
// A flick — short but fast — counts as a full swipe, so grading doesn't need the
// card dragged a third of the way across the screen every single time.
const FLICK_PX = 45;
const FLICK_V = 0.55; // px per ms (~550 px/s)
const SNAP_BACK = "transform 0.34s cubic-bezier(.22,.8,.26,1)";

// The FSRS grades in button order — `g` doubles as the keyboard shortcut and
// `name` keys both the label and its entry in the interval preview.
const GRADES = [
  { g: 1, name: "again", tone: "bg-warn-bg text-warn-text", dim: "opacity-70" },
  { g: 2, name: "hard", tone: "border border-black/[0.1] bg-surface text-ink-muted", dim: "opacity-70" },
  { g: 3, name: "good", tone: "bg-sage text-white", dim: "opacity-80" },
  { g: 4, name: "easy", tone: "bg-sage-deep text-white", dim: "opacity-80" },
] as const;

// Which preset (if any) matches a layout, for highlighting in the picker.
function presetIdOf(layout: CardLayout): string {
  const eq = (a: CardField[], b: CardField[]) => a.length === b.length && a.every((x, i) => x === b[i]);
  return CARD_PRESETS.find((p) => eq(p.front, layout.front) && eq(p.back, layout.back))?.id ?? "custom";
}

// Compact "next due" label for a grade button, e.g. "10м" / "2д" / "3мес".
function fmtInterval(m: number, t: (k: string) => string): string {
  if (m < 60) return `${m}${t("unit.min")}`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}${t("unit.hour")}`;
  const d = Math.round(m / 1440);
  if (d < 30) return `${d}${t("unit.day")}`;
  return `${Math.round(d / 30)}${t("unit.month")}`;
}

export default function FlashcardsPage() {
  const qc = useQueryClient();
  const { accountId, profile } = useAccount();
  const { t } = useI18n();
  const layout = useCardLayout();
  const activePreset = presetIdOf(layout);
  const toggleField = (side: "front" | "back", field: CardField) => {
    const cur = layout[side];
    const next = cur.includes(field) ? cur.filter((f) => f !== field) : [...cur, field];
    if (next.length === 0) return; // never leave a side empty
    setCardLayout({ ...layout, [side]: next });
  };
  const { data: allWords, isLoading } = useQuery({
    queryKey: ["words", accountId],
    queryFn: () => fetchWordsCached(accountId),
  });

  const { data: collections } = useQuery({
    queryKey: ["collections", accountId],
    queryFn: () => api.collections(accountId),
  });

  // For the finish screen: are some of today's new words still waiting?
  const { data: daily } = useQuery({
    queryKey: ["hskDaily", accountId],
    queryFn: () => api.hskDaily(),
    enabled: profile?.hskTarget != null,
  });

  const [started, setStarted] = useState(false);
  const [selPairs, setSelPairs] = useState<string[] | null>(null);
  const [selColl, setSelColl] = useState<string>("all");
  const [onlyDue, setOnlyDue] = useState(true);

  const inColl = (w: Word) =>
    selColl === "all" || (w.collections ?? []).some((c) => c.id === selColl);

  // Preset the collection from a ?coll= deep link (e.g. from the Collections page).
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("coll");
    if (c) setSelColl(c);
  }, []);

  const [deck, setDeck] = useState<Word[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [known, setKnown] = useState(0);
  const [learning, setLearning] = useState(0);
  const [editing, setEditing] = useState<Word | null>(null);
  // The last grade, kept so a mis-tap can be taken back (BACKLOG "Undo the last
  // grade in review"): the card as it was, where it sat in the deck, and the send
  // that has to land before it can be undone.
  const [lastGrade, setLastGrade] = useState<{ before: Word; grade: number; at: number; sent: Promise<boolean> } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const { show } = useToast();

  const swipeUpDown = useSwipeUpDown();
  const playOnFlip = usePlayOnFlip();

  // Turn the card to its answer side, saying the word as it turns. Called straight
  // from the tap or key handler, never from an effect: iOS only lets speech start
  // inside the user's own gesture.
  function reveal(w: Word) {
    setFlipped(true);
    if (playOnFlip) speak(w.word, w.sourceLang);
  }

  // The drag never goes through React state: a setState per pointermove re-rendered
  // the whole card — both stamps, every field, and the FSRS interval preview — a
  // hundred-odd times a second, which is what made the swipe feel heavy on a phone.
  // The card and the stamps are written straight to the DOM, once per frame, from
  // a smoothed finger position (lib/dragFollow.ts: raw touch points made a slow
  // drag step instead of glide). Not even the grab cursor is state, since a
  // re-render on touch-down cost the first frames of the drag.
  const startX = useRef(0);
  const startY = useRef(0);
  const axis = useRef<"" | "x" | "y">(""); // direction lock, decided on the first few px
  const cardRef = useRef<HTMLDivElement | null>(null);
  const stampAgain = useRef<HTMLDivElement | null>(null);
  const stampGood = useRef<HTMLDivElement | null>(null);
  const stampHard = useRef<HTMLDivElement | null>(null);
  const stampEasy = useRef<HTMLDivElement | null>(null);
  const draggedRef = useRef(false);
  const pointerActive = useRef(false); // synchronous "a drag is in progress" flag
  // Two samples ~30ms apart, for the release velocity: the last frame alone is far
  // too noisy to tell a flick from a thumb that happened to stop moving.
  const sampleD = useRef(0);
  const sampleT = useRef(0);
  const prevD = useRef(0);
  const prevT = useRef(0);

  function paintCard(dx: number, dy: number) {
    if (cardRef.current)
      cardRef.current.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx * 0.035}deg)`;
    const op = (r: typeof stampGood, v: number) => {
      if (r.current) r.current.style.opacity = String(Math.max(0, Math.min(1, v)));
    };
    op(stampGood, dx / SWIPE_PX);
    op(stampAgain, -dx / SWIPE_PX);
    op(stampEasy, -dy / SWIPE_PX); // up → Easy
    op(stampHard, dy / SWIPE_PX); // down → Hard
  }
  const follow = useDragFollower(paintCard);
  const grabbing = (on: boolean) => {
    if (cardRef.current) cardRef.current.style.cursor = on ? "grabbing" : "";
  };

  // A focused session handed off from the Coach ("drill weak words"): start
  // immediately with exactly those cards, skipping the setup screen.
  const focusStarted = useRef(false);
  useEffect(() => {
    if (focusStarted.current || allWords == null) return;
    let ids: string[] = [];
    try {
      ids = JSON.parse(sessionStorage.getItem("lexa.reviewFocusIds") ?? "[]");
    } catch {
      ids = [];
    }
    if (!Array.isArray(ids) || ids.length === 0) return;
    sessionStorage.removeItem("lexa.reviewFocusIds");
    focusStarted.current = true;
    const byId = new Map(allWords.map((w) => [w.id, w]));
    const focusDeck = ids.map((id) => byId.get(id)).filter(Boolean) as Word[];
    if (focusDeck.length === 0) return;
    setDeck(focusDeck);
    setIndex(0);
    setFlipped(false);
    setKnown(0);
    setLearning(0);
    restCard();
    setStarted(true);
  }, [allWords]);

  // While a card is on screen, stop the page rubber-banding: `pan-y` deliberately
  // hands the vertical axis back to the browser, and a thumb swipe travels in an
  // arc — so a downward-curving "I know it" used to start pull-to-refresh mid-drag.
  useEffect(() => {
    if (!started) return;
    const html = document.documentElement;
    const prev = html.style.overscrollBehaviorY;
    html.style.overscrollBehaviorY = "contain";
    return () => {
      html.style.overscrollBehaviorY = prev;
    };
  }, [started]);

  // Anki's keys: 1–4 grade from either face, space/enter reveals the back — and
  // once the back is up, space is Good.
  useEffect(() => {
    if (!started || editing) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, [contenteditable=true]")) return;
      // Ctrl/⌘+Z takes the last grade back, Anki's key for it.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        void undo();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Never steal space/enter from a focused control: someone who tabbed to
      // "Hard" must get Hard, not the space-is-Good shortcut.
      if ((e.key === " " || e.key === "Enter") && el?.closest("button, a")) return;
      const card = deck[index];
      if (!card) return;
      if (!flipped && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        reveal(card);
        return;
      }
      const grade = e.key === " " ? 3 : Number(e.key);
      if (Number.isInteger(grade) && grade >= 1 && grade <= 4) {
        e.preventDefault();
        commit(grade, card);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // `commit` and `undo` are left out on purpose — they're rebuilt every render,
    // and the deps above already re-bind the listener on every card, flip and grade.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, editing, deck, index, flipped, lastGrade]);

  // Put the card back at rest with no animation — for a fresh card, where snapping
  // in from the last one's fly-off would look like the new card arriving pre-swiped.
  function restCard() {
    follow.stop();
    axis.current = "";
    const el = cardRef.current;
    if (el) {
      el.style.transition = "none";
      el.style.transform = "";
    }
    for (const s of [stampAgain, stampGood, stampHard, stampEasy]) {
      if (s.current) s.current.style.opacity = "0";
    }
  }

  const words = allWords ?? [];
  const allPairs = Array.from(new Set(words.map(pairKey)));

  // Pairs ordered by recent use (from add history); the first 5 are quick-pick chips.
  const quickPairs = (() => {
    const recent = getRecentPairs().map((p) => `${p.s}>${p.t}`);
    const ordered = [...allPairs].sort((a, b) => {
      const ia = recent.indexOf(a);
      const ib = recent.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return ordered.slice(0, 5);
  })();

  // Until the learner picks, the most recently used pair is preselected — an
  // empty selection made new users think there was nothing to review.
  const sel = selPairs ?? quickPairs.slice(0, 1);

  const togglePair = (pk: string) =>
    setSelPairs(sel.includes(pk) ? sel.filter((x) => x !== pk) : [...sel, pk]);

  // Record a grade offline-first: update the card locally (FSRS) so the due list
  // reflects it instantly and survives with no network, then send it to the
  // server or queue it for sync. The server recomputes authoritatively on sync.
  async function recordGrade(word: Word, grade: number) {
    const updated = applyGradeLocally(word, grade as 1 | 2 | 3 | 4);
    qc.setQueryData<Word[]>(["words", accountId], (prev) => (prev ?? []).map((w) => (w.id === word.id ? updated : w)));
    void mirrorWords(accountId, qc.getQueryData<Word[]>(["words", accountId]) ?? []);
    const synced = await submitReview(word.id, grade);
    if (synced) qc.invalidateQueries({ queryKey: ["stats"] });
    return synced;
  }

  // Take the last grade back: the card's schedule as it was (on the server, or
  // dropped from the offline queue), the tallies and a re-queued "Again" copy
  // undone, and the card back on screen answer-side up, ready to be graded again.
  async function undo() {
    const last = lastGrade;
    if (!last || undoing) return;
    setUndoing(true);
    try {
      await last.sent;
      if (!(await undoReview(last.before.id))) {
        setLastGrade(null);
        show({ icon: "⚠️", title: t("review.undoFailed") });
        return;
      }
      qc.setQueryData<Word[]>(["words", accountId], (prev) =>
        (prev ?? []).map((w) => (w.id === last.before.id ? last.before : w)),
      );
      void mirrorWords(accountId, qc.getQueryData<Word[]>(["words", accountId]) ?? []);
      qc.invalidateQueries({ queryKey: ["stats"] });
      if (last.grade >= 3) setKnown((k) => Math.max(0, k - 1));
      else setLearning((l) => Math.max(0, l - 1));
      if (last.grade === 1) setDeck((d) => d.slice(0, -1));
      restCard();
      setIndex(last.at);
      setFlipped(true);
      setLastGrade(null);
    } finally {
      setUndoing(false);
    }
  }

  // Pace new words: serve all due-for-review cards + at most newPerDay brand-new
  // ones, so a huge import doesn't dump every new card at once. Only applies in the
  // default "due" mode — "review all" deliberately ignores pacing.
  function capNewCards(list: Word[]) {
    const cap = getNewPerDay();
    const reviewed = list.filter((w) => w.reviewCount > 0);
    const fresh = list.filter((w) => w.reviewCount === 0);
    return [...reviewed, ...fresh.slice(0, cap)];
  }

  function buildDeck() {
    const filtered = words.filter(
      (w) => sel.includes(pairKey(w)) && inColl(w) && (onlyDue ? isDue(w) : true),
    );
    return onlyDue ? capNewCards(filtered) : filtered;
  }

  function start() {
    setDeck(buildDeck());
    setIndex(0);
    setFlipped(false);
    setKnown(0);
    setLearning(0);
    setLastGrade(null);
    restCard();
    setStarted(true);
  }

  // grade: 1=Again 2=Hard 3=Good 4=Easy (FSRS). Again re-queues in-session.
  // `fly` is where the card leaves from — a swipe passes its own direction so the
  // card keeps going the way the thumb was pushing it; the buttons use the default.
  function commit(grade: number, word: Word, fly?: { x: number; y: number }) {
    const to = fly ?? { x: grade >= 3 ? 640 : -640, y: 0 };
    follow.stop();
    const el = cardRef.current;
    if (el) {
      el.style.transition = SNAP_BACK;
      el.style.transform = `translate(${to.x}px, ${to.y}px) rotate(${to.x * 0.035}deg)`;
    }
    grabbing(false);
    // Only the newest grade can be taken back, and not while its card is still flying off.
    setLastGrade(null);
    // The card as the list has it now, before this grade — what Undo restores.
    const before = qc.getQueryData<Word[]>(["words", accountId])?.find((w) => w.id === word.id) ?? word;
    const sent = recordGrade(word, grade);
    if (grade >= 3) setKnown((k) => k + 1);
    else setLearning((l) => l + 1);
    if (grade === 1) setDeck((d) => [...d, word]); // "Again" comes back this session
    const at = index;
    setTimeout(() => {
      restCard();
      setFlipped(false);
      setIndex((i) => i + 1);
      setLastGrade({ before, grade, at, sent });
    }, 260);
  }

  const undoButton = lastGrade && (
    <button
      onClick={() => void undo()}
      disabled={undoing}
      title={t("review.undoHint")}
      className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03] disabled:opacity-50"
    >
      <Undo2 className="h-3.5 w-3.5" /> {t("review.undo")}
    </button>
  );

  if (isLoading)
    return (
      <div className="mx-auto max-w-[560px] space-y-5">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-[320px] rounded-[30px]" />
      </div>
    );

  if (words.length === 0)
    return (
      <div className="mx-auto max-w-[480px] rounded-[24px] border border-black/[0.06] bg-surface p-10 text-center">
        <Repeat className="mx-auto h-8 w-8 text-sage" />
        <h2 className="mt-4 font-serif text-[26px] font-medium text-ink">{t("review.noWords")}</h2>
        <p className="mt-2 text-ink-soft">{t("review.emptyHint")}</p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-sage px-5 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-sage-deep"
        >
          {t("review.emptyCta")}
        </Link>
        <div className="mt-3">
          <Link href="/words" className="inline-flex items-center gap-1.5 text-sm font-semibold text-sage transition-colors hover:text-sage-deep">
            {t("first.manual")}
          </Link>
        </div>
      </div>
    );

  // ---------------- Setup screen ----------------
  if (!started) {
    const inSel = (w: Word) => sel.includes(pairKey(w)) && inColl(w);
    const dueCount = capNewCards(words.filter((w) => inSel(w) && isDue(w))).length;
    const allCount = words.filter(inSel).length;
    const candidate = onlyDue ? dueCount : allCount;
    const pairCount = (pk: string) =>
      capNewCards(words.filter((w) => pairKey(w) === pk && inColl(w) && isDue(w))).length;
    return (
      <div className="mx-auto max-w-[520px] space-y-5">
        <h2 className="font-serif text-[28px] font-medium text-ink">{t("review.title")}</h2>
        <OnceHint id="review">{t("hint.review")}</OnceHint>

        <div className="space-y-5 rounded-[20px] border border-black/[0.06] bg-surface p-5">
          {/* 1. language pair — the one thing a session needs */}
          {allPairs.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {t("review.pairs")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {quickPairs.map((pk) => {
                  const [s, tg] = pk.split(">");
                  const n = pairCount(pk);
                  return (
                    <QuickChip key={pk} active={sel.includes(pk)} onClick={() => togglePair(pk)}>
                      {pairLabel(s, tg)}
                      {n > 0 && <span className="ml-1.5 opacity-70">{n}</span>}
                    </QuickChip>
                  );
                })}
              </div>
              {allPairs.length > quickPairs.length && (
                <div className="mt-2">
                  <PairMultiSelect pairs={allPairs} selected={sel} onChange={setSelPairs} />
                </div>
              )}
            </div>
          )}

          {/* 2. which words: due now vs everything */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              {t("review.which")}
            </p>
            <Segmented
              grow
              size="lg"
              value={onlyDue ? "due" : "all"}
              onChange={(v) => setOnlyDue(v === "due")}
              options={([true, false] as const).map((due) => ({
                value: due ? "due" : "all",
                label: (
                  <>
                    {t(due ? "review.modeDue" : "review.modeAll")}
                    <span className="-ml-0.5 opacity-70">{due ? dueCount : allCount}</span>
                  </>
                ),
              }))}
            />
            <p className="mt-2 text-[12px] leading-snug text-ink-faint">
              {t(onlyDue ? "review.modeDueHint" : "review.modeAllHint")}
            </p>
          </div>

          {/* 3. collection (optional) */}
          {collections && collections.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {t("review.collection")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <QuickChip active={selColl === "all"} onClick={() => setSelColl("all")}>
                  {t("common.allWords")}
                </QuickChip>
                {collections.slice(0, 5).map((c) => (
                  <QuickChip key={c.id} active={selColl === c.id} onClick={() => setSelColl(c.id)}>
                    {c.name}
                  </QuickChip>
                ))}
              </div>
              {collections.length > 5 && (
                <div className="mt-2">
                  <CollectionSelect options={collections} value={selColl} onChange={setSelColl} />
                </div>
              )}
            </div>
          )}
        </div>

        <Button className="w-full" disabled={candidate === 0} onClick={start}>
          {sel.length === 0
            ? t("review.pickPair")
            : candidate === 0
              ? t(onlyDue ? "review.nothingDue" : "review.nothing")
              : candidate === 1
                ? t("review.startOne", { n: candidate })
                : t("review.start", { n: candidate })}
        </Button>
        {sel.length > 0 && onlyDue && dueCount === 0 && allCount > 0 && (
          <button
            type="button"
            onClick={() => setOnlyDue(false)}
            className="-mt-2 w-full text-center text-[13px] font-semibold text-sage hover:text-sage-deep"
          >
            {t("review.reviewAllInstead", { n: allCount })}
          </button>
        )}

        {/* card layout — tucked away; the defaults work for most people */}
        <Disclosure
          summary={
            <span>
              {t("review.cardLayout")}
              <span className="ml-2 font-medium text-ink-faint">{t(`layout.${activePreset}`)}</span>
            </span>
          }
        >
            <Segmented
              className="w-fit"
              scroll
              size="lg"
              itemClassName="px-3 py-1"
              value={activePreset}
              onChange={(id) => {
                const p = CARD_PRESETS.find((c) => c.id === id);
                if (p) setCardLayout({ front: p.front, back: p.back });
              }}
              options={[
                ...CARD_PRESETS.map((p) => ({ value: p.id, label: t(`layout.${p.id}`) })),
                // "Custom" is not pickable — it shows up, holding the pill, as soon
                // as the field toggles below stop matching a preset.
                ...(activePreset === "custom" ? [{ value: "custom", label: t("layout.custom") }] : []),
              ]}
            />

            {/* per-side field toggles */}
            <div className="mt-3 space-y-2">
              {(["front", "back"] as const).map((side) => (
                <div key={side} className="flex flex-wrap items-center gap-1.5">
                  <span className="w-12 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                    {t(`layout.${side}`)}
                  </span>
                  {CARD_FIELDS.map((f) => {
                    const on = layout[side].includes(f);
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => toggleField(side, f)}
                        className={cn(
                          "rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                          on
                            ? "border-sage bg-sage-tint text-sage-deep"
                            : "border-black/[0.08] bg-surface text-ink-faint hover:border-sage/60",
                        )}
                      >
                        {t(`field.${f}`)}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            {/* hover/pin preview of the card with these settings */}
            <CardLayoutPreview layout={layout} />
        </Disclosure>
      </div>
    );
  }

  // ---------------- Training ----------------
  const total = deck.length;
  const done = index >= total;

  const dailyLeft = daily?.words.filter((w) => !w.added).length ?? 0;
  const reviewedIds = Array.from(new Set(deck.map((w) => w.id)));
  const nextSteps = [
    ...(dailyLeft > 0
      ? [{ href: "/#daily", Icon: Sparkles, title: t("review.nextDaily", { n: dailyLeft }), sub: t("review.nextDailySub"), onClick: undefined }]
      : []),
    {
      href: "/coach/practice",
      Icon: Dumbbell,
      title: t("review.nextUse"),
      sub: t("review.nextUseSub", { n: reviewedIds.length }),
      // The drill takes the words just reviewed, the way a set's "Practice" hands them over.
      onClick: () => {
        try {
          sessionStorage.setItem("lexa.coachFocusIds", JSON.stringify(reviewedIds));
        } catch {
          /* no storage: the drill picks its own words */
        }
      },
    },
    { href: "/reader", Icon: BookOpen, title: t("review.nextRead"), sub: t("review.nextReadSub"), onClick: undefined },
  ];

  if (done)
    return (
      <div className="anim-pop mx-auto flex max-w-[480px] flex-col items-center rounded-[24px] border border-black/[0.06] bg-surface p-10 text-center">
        {known > 0 && <Confetti />}
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-sage-tint">
          <svg width="40" height="40" viewBox="0 0 34 34" fill="none">
            <path d="M9 17.5l5 5L25 11" stroke="#7c9885" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h2 className="mt-5 font-serif text-[28px] font-medium text-ink sm:text-[32px]">{t("review.complete")}</h2>
        <p className="mt-2 text-ink-soft">{t("review.reviewed", { n: total })}</p>
        <div className="mt-6 flex gap-3.5">
          <div className="rounded-[18px] border border-black/[0.07] bg-paper px-7 py-4">
            <div className="font-serif text-[30px] font-bold text-sage">{known}</div>
            <div className="mt-0.5 text-[13px] font-medium text-ink-soft">{t("review.known")}</div>
          </div>
          <div className="rounded-[18px] border border-black/[0.07] bg-paper px-7 py-4">
            <div className="font-serif text-[30px] font-bold text-warn">{learning}</div>
            <div className="mt-0.5 text-[13px] font-medium text-ink-soft">{t("review.learningCount")}</div>
          </div>
        </div>
        {/* The loop, one tap at a time (BACKLOG "End of review → the next step"):
            today's new words while some are left, then using what was just
            reviewed, then reading. The first is the one to take. */}
        <div className="mt-7 w-full space-y-2 text-left">
          {nextSteps.map(({ href, Icon, title, sub, onClick }, i) => (
            <Link
              key={href}
              href={href}
              onClick={onClick}
              className={cn(
                "flex items-center gap-3 rounded-[16px] px-4 py-3 transition-colors",
                i === 0 ? "bg-sage text-white hover:bg-sage-deep" : "border border-black/[0.08] bg-paper text-ink hover:border-sage/60",
              )}
            >
              <Icon className={cn("h-5 w-5 shrink-0", i === 0 ? "text-white" : "text-sage")} />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{title}</span>
                <span className={cn("block text-[12px]", i === 0 ? "text-white/80" : "text-ink-faint")}>{sub}</span>
              </span>
              <ArrowRight className="h-4 w-4 shrink-0 opacity-70" />
            </Link>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            onClick={() => setStarted(false)}
            className="rounded-full px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.04]"
          >
            {t("review.backToSetup")}
          </button>
          {undoButton}
        </div>
      </div>
    );

  const word = deck[index];
  const iv = previewMinutes(word); // FSRS "next due" for each grade

  // Render one card field. `primary` = the big hero field on the front.
  const chips = (items: string[], tone: "syn" | "ant" | "muted") =>
    items.length ? (
      <div className="flex flex-wrap justify-center gap-1.5">
        {items.map((it) => (
          <span
            key={it}
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-[15px]",
              tone === "syn"
                ? "border-sage/40 bg-sage-tint text-sage-deep"
                : tone === "ant"
                  ? "border-warn/40 bg-warn-bg text-warn-text"
                  : "border-black/[0.08] bg-paper text-ink-muted",
            )}
          >
            {it}
          </span>
        ))}
      </div>
    ) : null;

  const fieldNode = (field: CardField, primary: boolean, withTr = false): React.ReactNode => {
    switch (field) {
      case "word":
        return (
          <div className="flex items-center justify-center gap-3">
            {/* A long headword ("intertextuality") at 52px is wider than a phone, so the hero shrinks to fit */}
            {primary ? (
              <FitText
                text={word.word}
                max={52}
                min={28}
                className={cn("font-serif font-medium leading-tight tracking-[-0.025em] text-ink", sourceFont(word.sourceLang))}
              />
            ) : (
              <span className={cn("min-w-0 break-words font-serif text-[26px] font-medium text-ink", sourceFont(word.sourceLang))}>
                {word.word}
              </span>
            )}
            <SpeakButton text={word.word} lang={word.sourceLang} size={primary ? "md" : "sm"} />
          </div>
        );
      case "phonetic":
        return word.phonetic ? <div className="break-words text-[18px] text-ink-faint">{word.phonetic}</div> : null;
      case "pos":
        return word.partOfSpeech ? (
          <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-taupe-dim">{word.partOfSpeech}</div>
        ) : null;
      case "meaning":
        return word.meaningZh ? (
          <div>
            {primary ? (
              <FitText
                text={word.meaningZh}
                max={36}
                min={22}
                className={cn("font-serif font-bold leading-tight text-sage-deep", targetFont(word.targetLang))}
              />
            ) : (
              <div className={cn("break-words text-[22px] font-bold text-sage-deep", targetFont(word.targetLang))}>{word.meaningZh}</div>
            )}
            {/* Instant capture: still the dictionary's English, labelled until the model's meaning lands. */}
            <DictMeaningLabel word={word} className="mt-1 block" />
          </div>
        ) : null;
      case "example":
        return word.examples.length ? (
          <div className="space-y-3 text-left">
            {word.examples.map((ex) => (
              <div key={ex.id}>
                <p className="whitespace-pre-line font-serif text-[17px] leading-relaxed text-quote">
                  <ExampleText text={ex.sentenceEn} word={word.word} lang={word.sourceLang} hideWordReading />
                </p>
                {withTr && ex.sentenceZh?.trim() && (
                  <p className={cn("mt-1 whitespace-pre-line text-[15px] leading-relaxed text-ink-soft", targetFont(word.targetLang))}>
                    {ex.sentenceZh}
                  </p>
                )}
                {ex.sourceName && (
                  <div className="mt-1 text-[12px] font-semibold tracking-[0.04em] text-ink-faint">— {ex.sourceName}</div>
                )}
              </div>
            ))}
          </div>
        ) : null;
      case "exampleTr":
        return word.examples.some((ex) => ex.sentenceZh?.trim()) ? (
          <div className="space-y-2 text-left">
            {word.examples
              .filter((ex) => ex.sentenceZh?.trim())
              .map((ex) => (
                <p key={ex.id} className={cn("whitespace-pre-line text-[15px] leading-relaxed text-ink-soft", targetFont(word.targetLang))}>
                  {ex.sentenceZh}
                </p>
              ))}
          </div>
        ) : null;
      case "synonyms":
        return chips(word.synonyms, "syn");
      case "antonyms":
        return chips(word.antonyms, "ant");
      case "collocations":
        return chips(word.collocations, "muted");
      case "notes":
        return word.notes?.trim() ? (
          <div className="whitespace-pre-wrap text-left text-[15px] leading-relaxed text-ink-soft">{word.notes}</div>
        ) : null;
      default:
        return null;
    }
  };

  // Non-empty fields, so a missing phonetic/example doesn't leave blank gaps.
  // When BOTH example fields are on for a side, each sentence renders its own
  // translation underneath — so the standalone "Example translation" list (which read
  // as 3 examples followed by 3 unaligned translations) is dropped for that side.
  const inlineTr = (fields: CardField[]) => fields.includes("example") && fields.includes("exampleTr");
  const visibleFields = (fields: CardField[], primary: boolean, withTr: boolean) =>
    fields.filter((f) => !(withTr && f === "exampleTr")).filter((f) => fieldNode(f, primary, withTr) !== null);
  const frontTr = inlineTr(layout.front);
  const backTr = inlineTr(layout.back);
  const frontFields = visibleFields(layout.front, true, frontTr);
  const backFields = visibleFields(layout.back, false, backTr);

  // Drag/flip via pointer capture on the card itself — no window listeners, so a
  // lost pointerup (e.g. switching to a new tab) can never leave a stuck state.
  const onPointerDown = (e: React.PointerEvent) => {
    // Let interactive children (speak button, links) work without flipping/dragging.
    if ((e.target as HTMLElement).closest("button, a, input, textarea")) return;
    // Edge dead zone: iOS owns a drag that starts here (back/forward navigation),
    // so starting a swipe there would drag the page along with the card.
    if (e.pointerType === "touch" && (e.clientX < EDGE_PX || e.clientX > window.innerWidth - EDGE_PX))
      return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    startX.current = e.clientX;
    startY.current = e.clientY;
    axis.current = "";
    draggedRef.current = false;
    pointerActive.current = true;
    sampleD.current = 0;
    sampleT.current = e.timeStamp;
    prevD.current = 0;
    prevT.current = e.timeStamp;
    if (cardRef.current) cardRef.current.style.transition = "none";
    grabbing(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointerActive.current) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    // Lock to one axis on the first few px, so a swipe that drifts diagonally
    // doesn't end up grading on whichever direction happened to win at the end.
    if (!axis.current && Math.hypot(dx, dy) > 8) {
      const vertical = Math.abs(dy) > Math.abs(dx);
      if (vertical && !swipeUpDown) {
        // Vertical scrolling is the browser's here — let go of the card entirely.
        // Still a drag though, so releasing must not read as a tap and flip it.
        draggedRef.current = true;
        pointerActive.current = false;
        grabbing(false);
        return;
      }
      axis.current = vertical ? "y" : "x";
      draggedRef.current = true;
      follow.start(0, 0);
    }
    if (!axis.current) return;
    const d = axis.current === "y" ? dy : dx;
    follow.to(axis.current === "y" ? 0 : dx, axis.current === "y" ? dy : 0);
    if (e.timeStamp - sampleT.current > 30) {
      prevD.current = sampleD.current;
      prevT.current = sampleT.current;
      sampleD.current = d;
      sampleT.current = e.timeStamp;
    }
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    if (!pointerActive.current) return;
    pointerActive.current = false;
    grabbing(false);
    follow.stop();
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    const d = axis.current === "y" ? dy : dx;
    // `v * d > 0` so a drag that was yanked back at the last moment doesn't fire
    // the direction it was pulled away from.
    const dt = e.timeStamp - prevT.current;
    const v = dt > 0 ? (d - prevD.current) / dt : 0;
    const fired = Math.abs(d) > SWIPE_PX || (Math.abs(d) > FLICK_PX && Math.abs(v) > FLICK_V && v * d > 0);
    if (fired && axis.current === "x")
      return d > 0
        ? commit(3, word, { x: 640, y: 0 }) // right → Good
        : commit(1, word, { x: -640, y: 0 }); // left → Again
    if (fired && axis.current === "y")
      return d < 0
        ? commit(4, word, { x: 0, y: -640 }) // up → Easy
        : commit(2, word, { x: 0, y: 640 }); // down → Hard
    // Short of the threshold: snap back. A plain tap never moved, so this is a
    // no-op there and onClick handles the flip (reliable on double-taps).
    if (cardRef.current) cardRef.current.style.transition = SNAP_BACK;
    paintCard(0, 0);
    axis.current = "";
  };
  const onPointerCancel = () => {
    if (!pointerActive.current) return;
    pointerActive.current = false;
    grabbing(false);
    follow.stop();
    if (cardRef.current) cardRef.current.style.transition = SNAP_BACK;
    paintCard(0, 0);
    axis.current = "";
  };
  // Flip on a genuine tap/click (skipped right after a drag). Using onClick keeps
  // rapid/double taps reliable where a manual pointerup toggle could get stuck.
  // Ignore taps on interactive children (speak button, links) so they don't flip.
  const onFlip = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, textarea")) return;
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (flipped) setFlipped(false);
    else reveal(word);
  };

  // Nothing on the session screen is text to copy, and a long press anywhere on it
  // (even on a hidden grade stamp) used to start an iOS selection that grew across
  // the card and the grade row. The edit modal is portalled out, so it still selects.
  return (
    <div className="mx-auto flex max-w-[560px] select-none flex-col items-center [-webkit-touch-callout:none]">
      <div className="w-full">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-serif text-[22px] font-medium text-ink sm:text-[28px]">{t("review.title")}</h2>
          <span className="shrink-0 text-[15px] font-semibold tabular-nums text-ink-soft">
            {Math.min(index + 1, total)} / {total}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <a
            href={`/word/${word.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
          >
            {t("review.openCard")} <ExternalLink className="h-3.5 w-3.5" />
          </a>
          <button
            onClick={() => setEditing(word)}
            className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
          >
            <Pencil className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{t("edit.editCard")}</span>
          </button>
          <button
            onClick={() => setStarted(false)}
            className="inline-flex items-center gap-1 rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
          >
            ← {t("review.backToSetup")}
          </button>
          {undoButton}
        </div>
        <div className="mt-4 h-[7px] overflow-hidden rounded-full bg-track">
          <div
            className="h-full rounded-full bg-sage transition-[width] duration-300"
            style={{ width: `${(index / total) * 100}%` }}
          />
        </div>
        <div className="mt-3 flex justify-between text-sm font-semibold">
          <span className="flex items-center gap-2 text-warn-text">
            <span className="h-2.5 w-2.5 rounded-full bg-warn" /> {t("review.learningLabel", { n: learning })}
          </span>
          <span className="flex items-center gap-2 text-sage-deep">
            {t("review.knownLabel", { n: known })} <span className="h-2.5 w-2.5 rounded-full bg-sage" />
          </span>
        </div>
      </div>

      <div className="relative flex w-full items-center justify-center py-5 sm:py-8">
        {/* Grade stamps — each one named after the button it fires, so the gesture
            and the row below it never claim to do two different things. Opacity is
            written by `paint`; the class only sets the starting value. */}
        <div
          ref={stampGood}
          className="pointer-events-none absolute left-1 top-12 z-10 -rotate-12 rounded-xl border-[3px] border-sage bg-paper/70 px-4 py-2 text-lg font-bold uppercase tracking-wider text-sage-deep opacity-0"
        >
          {t("review.good")}
        </div>
        <div
          ref={stampAgain}
          className="pointer-events-none absolute right-1 top-12 z-10 rotate-12 rounded-xl border-[3px] border-warn bg-paper/70 px-4 py-2 text-lg font-bold uppercase tracking-wider text-warn-text opacity-0"
        >
          {t("review.again")}
        </div>
        <div
          ref={stampEasy}
          className="pointer-events-none absolute bottom-10 left-1/2 z-10 -translate-x-1/2 rounded-xl border-[3px] border-sage-deep bg-paper/70 px-4 py-2 text-lg font-bold uppercase tracking-wider text-sage-deep opacity-0"
        >
          {t("review.easy")}
        </div>
        <div
          ref={stampHard}
          className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-xl border-[3px] border-ink-faint/50 bg-paper/70 px-4 py-2 text-lg font-bold uppercase tracking-wider text-ink-muted opacity-0"
        >
          {t("review.hard")}
        </div>

        <div
          ref={cardRef}
          className="w-full max-w-[560px] cursor-grab"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerCancel}
          onClick={onFlip}
          style={{
            // transform/transition/cursor are written imperatively during a drag and
            // so are deliberately absent here — React must not clobber them on a re-render.
            willChange: "transform",
            // With up/down on we own both axes, so the card can no longer scroll the
            // page under it (the back face keeps its own scroll area below).
            touchAction: swipeUpDown ? "none" : "pan-y",
          }}
        >
          {/* Keyed per card: the next word gets a fresh, face-up card that rises
              in. Reusing the element meant the new word turned back over from
              its answer side after a flipped card was graded — half a second of
              the next answer showing. */}
          <div key={index} className="flip-scene anim-card-in">
            <div className={cn("flip-card", flipped && "is-flipped")}>
              {/* FRONT — the layout's front fields, first one as the hero */}
              <div className="flip-face relative flex min-h-[300px] flex-col rounded-[30px] border border-black/[0.07] bg-surface p-6 sm:p-8 shadow-[0_30px_60px_rgba(46,42,38,0.13)]">
                {/* on-card mic: stopPropagation or the tap would swipe/flip the card */}
                <span
                  className="absolute right-4 top-4"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <PronounceButton text={word.word} lang={word.sourceLang} size="sm" />
                </span>
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                  {frontFields.map((f, i) => (
                    <div key={f} className="max-w-full">{fieldNode(f, i === 0, frontTr)}</div>
                  ))}
                  <div className="mt-6 text-sm font-medium text-ink-faint">{t("review.reveal")}</div>
                </div>
              </div>

              {/* BACK — the layout's back fields; scrollable so long content fits */}
              <div className="flip-face flip-back flex min-h-[320px] flex-col rounded-[30px] border border-black/[0.07] bg-surface p-6 shadow-[0_30px_60px_rgba(46,42,38,0.13)]">
                <div
                  className="flex max-h-[300px] flex-col gap-3 overflow-y-auto px-2 py-1"
                  // Keep the pointer for scrolling (so a drag here scrolls instead of
                  // starting a swipe), but DON'T swallow the click — a tap on the back
                  // must still flip the card back to the front.
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{ touchAction: "pan-y" }}
                >
                  {backFields.map((f, i) => (
                    <div key={f} className="text-center">
                      {i > 0 && <div className="mx-auto mb-3 h-px w-full bg-black/[0.06]" />}
                      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-faint">
                        {t(`field.${f}`)}
                      </p>
                      {fieldNode(f, false, backTr)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* All four grades from the moment the card lands, on either face: a word you
          already know shouldn't need a reveal before Easy, and behind the button the
          grades cost a tap on every single card. */}
      <div className="grid w-full max-w-[560px] grid-cols-4 gap-2">
        {GRADES.map(({ g, name, tone, dim }) => (
          <button
            key={g}
            onClick={() => commit(g, word)}
            className={cn(
              "relative flex flex-col items-center rounded-2xl py-2.5 font-bold transition-transform active:scale-95",
              tone,
            )}
          >
            {/* the key that fires it, where there's a keyboard to fire it from */}
            <span className="absolute left-2 top-1.5 hidden text-[10px] font-semibold opacity-40 sm:block">
              {g}
            </span>
            <span className="text-sm">{t(`review.${name}`)}</span>
            <span className={cn("text-[11px] font-medium", dim)}>{fmtInterval(iv[name], t)}</span>
          </button>
        ))}
      </div>

      {/* Up/down swipes and audio are toggled here rather than on the setup screen:
          this is the only place either can be felt, so the switches sit under the
          card they apply to — and they take effect on the very next card. */}
      <div className="mt-4 flex w-full max-w-[560px] flex-col items-center gap-2">
        <p className="text-center text-[13px] font-medium text-ink-faint">
          {t(swipeUpDown ? "review.dragHint4" : "review.dragHint")}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => setSwipeUpDown(!swipeUpDown)}
            aria-pressed={swipeUpDown}
            title={t("review.swipeUpDownHint")}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors",
              swipeUpDown
                ? "border-sage bg-sage-tint text-sage-deep"
                : "border-black/[0.08] bg-surface text-ink-muted hover:border-sage/60",
            )}
          >
            <MoveVertical className="h-3.5 w-3.5" />
            {t("review.swipeUpDown")}
          </button>
          {canSpeak() && (
            <button
              type="button"
              onClick={() => setPlayOnFlip(!playOnFlip)}
              aria-pressed={playOnFlip}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors",
                playOnFlip
                  ? "border-sage bg-sage-tint text-sage-deep"
                  : "border-black/[0.08] bg-surface text-ink-muted hover:border-sage/60",
              )}
            >
              {playOnFlip ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              {t("review.playOnFlip")}
            </button>
          )}
        </div>
      </div>

      {editing && (
        <EditWordModal
          word={editing}
          onClose={() => setEditing(null)}
          onUpdated={(u) => {
            setDeck((d) => d.map((w) => (w.id === u.id ? u : w)));
            setEditing(u);
          }}
        />
      )}
    </div>
  );
}
