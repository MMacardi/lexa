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
  CARD_PRESETS,
  CARD_FIELDS,
  type CardField,
  type CardLayout,
} from "@/lib/learnPrefs";
import { pairLabel } from "@/lib/langs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SpeakButton } from "@/components/SpeakButton";
import { PronounceButton } from "@/components/PronounceButton";
import { HighlightWord } from "@/components/HighlightWord";
import { Confetti } from "@/components/Confetti";
import { CollectionSelect } from "@/components/CollectionSelect";
import { CardLayoutPreview } from "@/components/CardLayoutPreview";
import { EditWordModal } from "@/components/EditWordModal";
import { PairMultiSelect } from "@/components/PairMultiSelect";
import { QuickChip } from "@/components/ui/QuickChip";
import { Checkbox } from "@/components/ui/Checkbox";
import { OnceHint } from "@/components/OnceHint";
import { previewMinutes, applyGradeLocally } from "@/lib/fsrsPreview";
import { fetchWordsCached, mirrorWords, submitReview } from "@/lib/sync";
import { ChevronDown, ExternalLink, Pencil, Repeat } from "lucide-react";
import { cn } from "@/lib/utils";

const targetFont = (lang: string) => (lang === "zh" || lang === "zh-Hant" ? "font-zh" : "");
const sourceFont = (lang: string) => (lang === "zh" || lang === "zh-Hant" || lang === "ja" ? "font-zh" : "");
const pairKey = (w: Word) => `${w.sourceLang}>${w.targetLang}`;

// Swipe geometry. EDGE_PX is a dead zone at the left and right screen edges: iOS
// treats a drag that starts there as its back/forward navigation and no amount of
// touch-action stops it, so a swipe begun on the edge would drag the whole page.
const SWIPE_PX = 110;
const EDGE_PX = 24;
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
  const { accountId } = useAccount();
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
  const [dragging, setDragging] = useState(false);
  const [known, setKnown] = useState(0);
  const [learning, setLearning] = useState(0);
  const [editing, setEditing] = useState<Word | null>(null);

  const swipeUpDown = useSwipeUpDown();

  // The drag never goes through React state: a setState per pointermove re-rendered
  // the whole card — both stamps, every field, and the FSRS interval preview — a
  // hundred-odd times a second, which is what made the swipe feel heavy on a phone.
  // The card and the stamps are written straight to the DOM inside one rAF instead.
  const startX = useRef(0);
  const startY = useRef(0);
  const dxRef = useRef(0);
  const dyRef = useRef(0);
  const axis = useRef<"" | "x" | "y">(""); // direction lock, decided on the first few px
  const rafRef = useRef(0);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const stampAgain = useRef<HTMLDivElement | null>(null);
  const stampGood = useRef<HTMLDivElement | null>(null);
  const stampHard = useRef<HTMLDivElement | null>(null);
  const stampEasy = useRef<HTMLDivElement | null>(null);
  const draggedRef = useRef(false);
  const gradable = useRef(false); // this gesture may grade — i.e. the card was flipped
  const pointerActive = useRef(false); // synchronous "a drag is in progress" flag

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

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

  // Anki's keys, so gating the grades behind a reveal doesn't cost desktop users a
  // second click per card: space/enter reveals, then 1–4 grade and space is Good.
  useEffect(() => {
    if (!started || editing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, [contenteditable=true]")) return;
      // Never steal space/enter from a focused control: someone who tabbed to
      // "Hard" must get Hard, not the space-is-Good shortcut.
      if ((e.key === " " || e.key === "Enter") && el?.closest("button, a")) return;
      const card = deck[index];
      if (!card) return;
      if (!flipped) {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          setFlipped(true);
        }
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
    // `commit` is left out on purpose — it's rebuilt every render, and the deps
    // above already re-bind the listener on every card and every flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, editing, deck, index, flipped]);

  // Put the card back at rest with no animation — for a fresh card, where snapping
  // in from the last one's fly-off would look like the new card arriving pre-swiped.
  function restCard() {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    dxRef.current = 0;
    dyRef.current = 0;
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
    restCard();
    setStarted(true);
  }

  // grade: 1=Again 2=Hard 3=Good 4=Easy (FSRS). Again re-queues in-session.
  // `fly` is where the card leaves from — a swipe passes its own direction so the
  // card keeps going the way the thumb was pushing it; the buttons use the default.
  function commit(grade: number, word: Word, fly?: { x: number; y: number }) {
    const to = fly ?? { x: grade >= 3 ? 640 : -640, y: 0 };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    const el = cardRef.current;
    if (el) {
      el.style.transition = SNAP_BACK;
      el.style.transform = `translate(${to.x}px, ${to.y}px) rotate(${to.x * 0.035}deg)`;
    }
    setDragging(false);
    void recordGrade(word, grade);
    if (grade >= 3) setKnown((k) => k + 1);
    else setLearning((l) => l + 1);
    if (grade === 1) setDeck((d) => [...d, word]); // "Again" comes back this session
    setTimeout(() => {
      restCard();
      setFlipped(false);
      setIndex((i) => i + 1);
    }, 260);
  }

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
            <div className="grid grid-cols-2 gap-1 rounded-full bg-black/[0.04] p-1 text-sm font-semibold">
              {([true, false] as const).map((due) => (
                <button
                  key={String(due)}
                  type="button"
                  onClick={() => setOnlyDue(due)}
                  className={cn(
                    "rounded-full px-3 py-1.5 transition-colors",
                    onlyDue === due ? "bg-sage text-white" : "text-ink-muted",
                  )}
                >
                  {t(due ? "review.modeDue" : "review.modeAll")}
                  <span className="ml-1.5 opacity-70">{due ? dueCount : allCount}</span>
                </button>
              ))}
            </div>
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
        <details className="group rounded-[20px] border border-black/[0.06] bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-semibold text-ink-muted [&::-webkit-details-marker]:hidden">
            <span>
              {t("review.cardLayout")}
              <span className="ml-2 font-medium text-ink-faint">{t(`layout.${activePreset}`)}</span>
            </span>
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-black/[0.06] px-5 pb-5 pt-4">
            <div className="scroll-row flex w-fit flex-wrap gap-1 rounded-full bg-black/[0.04] p-1 text-sm font-semibold">
              {CARD_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setCardLayout({ front: p.front, back: p.back })}
                  className={cn(
                    "rounded-full px-3 py-1 transition-colors",
                    activePreset === p.id ? "bg-sage text-white" : "text-ink-muted",
                  )}
                >
                  {t(`layout.${p.id}`)}
                </button>
              ))}
              {activePreset === "custom" && (
                <span className="rounded-full bg-sage px-3 py-1 text-white">{t("layout.custom")}</span>
              )}
            </div>

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
          </div>
        </details>

        {/* swipes — left/right are always on; up/down are the opt-in extra */}
        <details className="group rounded-[20px] border border-black/[0.06] bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-3.5 text-sm font-semibold text-ink-muted [&::-webkit-details-marker]:hidden">
            <span>
              {t("review.gestures")}
              <span className="ml-2 font-medium text-ink-faint">
                {t(swipeUpDown ? "review.gestures4" : "review.gestures2")}
              </span>
            </span>
            <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-black/[0.06] px-5 pb-5 pt-4">
            <button
              type="button"
              onClick={() => setSwipeUpDown(!swipeUpDown)}
              className="flex w-full items-start gap-3 text-left"
            >
              <Checkbox presentational checked={swipeUpDown} className="mt-0.5" />
              <span>
                <span className="block text-sm font-semibold text-ink">{t("review.swipeUpDown")}</span>
                <span className="mt-0.5 block text-[12px] leading-snug text-ink-faint">
                  {t("review.swipeUpDownHint")}
                </span>
              </span>
            </button>
          </div>
        </details>
      </div>
    );
  }

  // ---------------- Training ----------------
  const total = deck.length;
  const done = index >= total;

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
        <Button variant="dark" className="mt-8" onClick={() => setStarted(false)}>
          {t("review.backToSetup")}
        </Button>
      </div>
    );

  const word = deck[index];
  const iv = previewMinutes(word); // FSRS "next due" for each grade
  const clamp = (v: number) => Math.max(0, Math.min(1, v));

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
            <span className={cn(primary ? "font-serif text-[52px] font-medium leading-tight tracking-[-0.025em] text-ink" : "font-serif text-[26px] font-medium text-ink", sourceFont(word.sourceLang))}>
              {word.word}
            </span>
            <SpeakButton text={word.word} lang={word.sourceLang} size={primary ? "md" : "sm"} />
          </div>
        );
      case "phonetic":
        return word.phonetic ? <div className="text-[18px] text-ink-faint">{word.phonetic}</div> : null;
      case "pos":
        return word.partOfSpeech ? (
          <div className="text-[13px] font-semibold uppercase tracking-[0.14em] text-taupe-dim">{word.partOfSpeech}</div>
        ) : null;
      case "meaning":
        return word.meaningZh ? (
          <div className={cn(primary ? "font-serif text-[36px] font-bold leading-tight text-sage-deep" : "text-[22px] font-bold text-sage-deep", targetFont(word.targetLang))}>
            {word.meaningZh}
          </div>
        ) : null;
      case "example":
        return word.examples.length ? (
          <div className="space-y-3 text-left">
            {word.examples.map((ex) => (
              <div key={ex.id}>
                <p className="whitespace-pre-line font-serif text-[17px] leading-relaxed text-quote">
                  <HighlightWord text={ex.sentenceEn} word={word.word} />
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

  // Paint the drag straight to the DOM, coalesced into one frame — see the refs.
  const paint = () => {
    rafRef.current = 0;
    const dx = axis.current === "y" ? 0 : dxRef.current;
    const dy = axis.current === "y" ? dyRef.current : 0;
    if (cardRef.current)
      cardRef.current.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx * 0.035}deg)`;
    const op = (r: typeof stampGood, v: number) => {
      if (r.current) r.current.style.opacity = String(clamp(v));
    };
    op(stampGood, dx / SWIPE_PX);
    op(stampAgain, -dx / SWIPE_PX);
    op(stampEasy, -dy / SWIPE_PX); // up → Easy
    op(stampHard, dy / SWIPE_PX); // down → Hard
  };
  const schedule = () => {
    if (!rafRef.current) rafRef.current = requestAnimationFrame(paint);
  };

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
    dxRef.current = 0;
    dyRef.current = 0;
    axis.current = "";
    draggedRef.current = false;
    // No grading a card you haven't read yet. Before the flip the drag is still
    // tracked, but only so a long drag isn't mistaken for a tap on release.
    gradable.current = flipped;
    pointerActive.current = true;
    if (!flipped) return;
    if (cardRef.current) cardRef.current.style.transition = "none";
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointerActive.current) return;
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (!gradable.current) {
      if (Math.hypot(dx, dy) > 8) draggedRef.current = true;
      return;
    }
    // Lock to one axis on the first few px, so a swipe that drifts diagonally
    // doesn't end up grading on whichever direction happened to win at the end.
    if (!axis.current && Math.hypot(dx, dy) > 8) {
      const vertical = Math.abs(dy) > Math.abs(dx);
      if (vertical && !swipeUpDown) {
        // Vertical scrolling is the browser's here — let go of the card entirely.
        // Still a drag though, so releasing must not read as a tap and flip it.
        draggedRef.current = true;
        pointerActive.current = false;
        setDragging(false);
        return;
      }
      axis.current = vertical ? "y" : "x";
      draggedRef.current = true;
    }
    if (!axis.current) return;
    dxRef.current = dx;
    dyRef.current = dy;
    schedule();
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    if (!pointerActive.current) return;
    pointerActive.current = false;
    if (!gradable.current) return;
    setDragging(false);
    const dx = e.clientX - startX.current;
    const dy = e.clientY - startY.current;
    if (axis.current === "x") {
      if (dx > SWIPE_PX) return commit(3, word, { x: 640, y: 0 }); // right → Good
      if (dx < -SWIPE_PX) return commit(1, word, { x: -640, y: 0 }); // left → Again
    } else if (axis.current === "y") {
      if (dy < -SWIPE_PX) return commit(4, word, { x: 0, y: -640 }); // up → Easy
      if (dy > SWIPE_PX) return commit(2, word, { x: 0, y: 640 }); // down → Hard
    }
    // Short of the threshold: snap back. A plain tap never moved, so this is a
    // no-op there and onClick handles the flip (reliable on double-taps).
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    if (cardRef.current) cardRef.current.style.transition = SNAP_BACK;
    dxRef.current = 0;
    dyRef.current = 0;
    paint();
    axis.current = "";
  };
  const onPointerCancel = () => {
    if (!pointerActive.current) return;
    pointerActive.current = false;
    if (!gradable.current) return;
    setDragging(false);
    if (cardRef.current) cardRef.current.style.transition = SNAP_BACK;
    dxRef.current = 0;
    dyRef.current = 0;
    paint();
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
    setFlipped((f) => !f);
  };

  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-center">
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
          className="w-full max-w-[560px] select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerCancel}
          onClick={onFlip}
          style={{
            // transform/transition are written imperatively during a drag and so are
            // deliberately absent here — React must not clobber them on a re-render.
            willChange: "transform",
            cursor: dragging ? "grabbing" : "grab",
            // With up/down on we own both axes, so the card can no longer scroll the
            // page under it (the back face keeps its own scroll area below).
            touchAction: swipeUpDown ? "none" : "pan-y",
          }}
        >
          <div className="flip-scene">
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
                    <div key={f}>{fieldNode(f, i === 0, frontTr)}</div>
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

      {/* Anki's flow: the grades only appear once the answer is on screen, so a card
          can't be graded before it has been read. The reveal button copies the grade
          buttons' two-line shape so the row keeps its height across the flip. */}
      {!flipped ? (
        <button
          onClick={() => setFlipped(true)}
          className="flex w-full max-w-[560px] flex-col items-center rounded-2xl bg-sage py-2.5 font-bold text-white transition-transform active:scale-95"
        >
          <span className="text-sm">{t("review.showAnswer")}</span>
          <span className="invisible text-[11px] font-medium opacity-80 sm:visible">
            {t("review.showAnswerKey")}
          </span>
        </button>
      ) : (
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
      )}
      <p className="mt-4 text-center text-[13px] font-medium text-ink-faint">
        {t(swipeUpDown ? "review.dragHint4" : "review.dragHint")}
      </p>

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
