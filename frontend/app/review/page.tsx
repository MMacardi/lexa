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
  CARD_PRESETS,
  CARD_FIELDS,
  type CardField,
  type CardLayout,
} from "@/lib/learnPrefs";
import { pairLabel } from "@/lib/langs";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { SpeakButton } from "@/components/SpeakButton";
import { HighlightWord } from "@/components/HighlightWord";
import { Confetti } from "@/components/Confetti";
import { CollectionSelect } from "@/components/CollectionSelect";
import { CardLayoutPreview } from "@/components/CardLayoutPreview";
import { EditWordModal } from "@/components/EditWordModal";
import { PairMultiSelect } from "@/components/PairMultiSelect";
import { QuickChip } from "@/components/ui/QuickChip";
import { previewMinutes, applyGradeLocally } from "@/lib/fsrsPreview";
import { fetchWordsCached, mirrorWords, submitReview } from "@/lib/sync";
import { ExternalLink, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

const targetFont = (lang: string) => (lang === "zh" || lang === "zh-Hant" ? "font-zh" : "");
const sourceFont = (lang: string) => (lang === "zh" || lang === "zh-Hant" || lang === "ja" ? "font-zh" : "");
const pairKey = (w: Word) => `${w.sourceLang}>${w.targetLang}`;

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
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [known, setKnown] = useState(0);
  const [learning, setLearning] = useState(0);
  const [editing, setEditing] = useState<Word | null>(null);

  const startX = useRef(0);
  const draggedRef = useRef(false);
  const pointerActive = useRef(false); // synchronous "a drag is in progress" flag

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
    setDragX(0);
    setStarted(true);
  }, [allWords]);

  const words = allWords ?? [];
  const allPairs = Array.from(new Set(words.map(pairKey)));
  // Nothing selected by default — the learner picks a pair (quick chips below the
  // dropdown make the common ones one tap away).
  const sel = selPairs ?? [];

  // The 5 most recently used pairs (from add history), shown as quick-pick chips.
  const quickPairs = (() => {
    const recent = getRecentPairs().map((p) => `${p.s}>${p.t}`);
    const ordered = [...allPairs].sort((a, b) => {
      const ia = recent.indexOf(a);
      const ib = recent.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return ordered.slice(0, 5);
  })();

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
    setDragX(0);
    setStarted(true);
  }

  // grade: 1=Again 2=Hard 3=Good 4=Easy (FSRS). Again re-queues in-session.
  function commit(grade: number, word: Word) {
    setDragX(grade >= 3 ? 640 : -640);
    setDragging(false);
    void recordGrade(word, grade);
    if (grade >= 3) setKnown((k) => k + 1);
    else setLearning((l) => l + 1);
    if (grade === 1) setDeck((d) => [...d, word]); // "Again" comes back this session
    setTimeout(() => {
      setDragX(0);
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
      <p className="text-sm text-ink-soft">
        {t("review.noWords")}{" "}
        <Link href="/words" className="font-semibold text-sage hover:text-sage-deep">
          {t("review.addFirst")}
        </Link>
      </p>
    );

  // ---------------- Setup screen ----------------
  if (!started) {
    const candidateAll = words.filter(
      (w) => sel.includes(pairKey(w)) && inColl(w) && (onlyDue ? isDue(w) : true),
    );
    const candidate = onlyDue ? capNewCards(candidateAll) : candidateAll;
    return (
      <div className="mx-auto max-w-[520px] space-y-6">
        <h2 className="font-serif text-[28px] font-medium text-ink">{t("review.title")}</h2>

        <div className="rounded-[20px] border border-black/[0.06] bg-surface p-5 space-y-4">
          {/* card layout: presets + custom front/back fields */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">{t("review.cardLayout")}</p>
            <div className="flex flex-wrap gap-1 rounded-full bg-black/[0.04] p-1 text-sm font-semibold w-fit">
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

          {/* collection */}
          {collections && collections.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {t("review.collection")}
              </p>
              <CollectionSelect options={collections} value={selColl} onChange={setSelColl} />
              <div className="mt-2 flex flex-wrap gap-1.5">
                <QuickChip active={selColl === "all"} onClick={() => setSelColl("all")}>
                  {t("common.allWords")}
                </QuickChip>
                {collections.slice(0, 5).map((c) => (
                  <QuickChip key={c.id} active={selColl === c.id} onClick={() => setSelColl(c.id)}>
                    {c.name}
                  </QuickChip>
                ))}
              </div>
            </div>
          )}

          {/* pairs — nothing selected by default; quick-pick chips for recent pairs */}
          {allPairs.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {t("review.pairs")}
              </p>
              {allPairs.length > 1 && (
                <PairMultiSelect pairs={allPairs} selected={sel} onChange={setSelPairs} />
              )}
              <div className="mt-2 flex flex-wrap gap-1.5">
                {quickPairs.map((pk) => {
                  const [s, tg] = pk.split(">");
                  return (
                    <QuickChip key={pk} active={sel.includes(pk)} onClick={() => togglePair(pk)}>
                      {pairLabel(s, tg)}
                    </QuickChip>
                  );
                })}
              </div>
            </div>
          )}

          {/* due toggle */}
          <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-ink-muted">
            <input
              type="checkbox"
              checked={onlyDue}
              onChange={(e) => setOnlyDue(e.target.checked)}
              className="h-4 w-4 accent-[#7c9885]"
            />
            {t("review.onlyDue")}
          </label>
        </div>

        <Button className="w-full" disabled={candidate.length === 0} onClick={start}>
          {candidate.length === 0
            ? t("review.nothing")
            : candidate.length === 1
              ? t("review.startOne", { n: candidate.length })
              : t("review.start", { n: candidate.length })}
        </Button>
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
        <h2 className="mt-5 font-serif text-[32px] font-medium text-ink">{t("review.complete")}</h2>
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

  const fieldNode = (field: CardField, primary: boolean): React.ReactNode => {
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
  const frontFields = layout.front.filter((f) => fieldNode(f, true) !== null);
  const backFields = layout.back.filter((f) => fieldNode(f, false) !== null);

  // Drag/flip via pointer capture on the card itself — no window listeners, so a
  // lost pointerup (e.g. switching to a new tab) can never leave a stuck state.
  const onPointerDown = (e: React.PointerEvent) => {
    // Let interactive children (speak button, links) work without flipping/dragging.
    if ((e.target as HTMLElement).closest("button, a, input, textarea")) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    startX.current = e.clientX;
    draggedRef.current = false;
    pointerActive.current = true;
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointerActive.current) return;
    const dx = e.clientX - startX.current;
    if (Math.abs(dx) > 6) draggedRef.current = true;
    setDragX(dx);
  };
  const onPointerEnd = (e: React.PointerEvent) => {
    if (!pointerActive.current) return;
    pointerActive.current = false;
    setDragging(false);
    const dx = e.clientX - startX.current;
    if (dx > 110) commit(3, word); // swipe right → Good
    else if (dx < -110) commit(1, word); // swipe left → Again
    else setDragX(0); // a tap → let onClick handle the flip (reliable on double-taps)
  };
  const onPointerCancel = () => {
    pointerActive.current = false;
    setDragging(false);
    setDragX(0);
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
            className="rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
          >
            {t("review.setup")}
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

      <div className="relative flex w-full items-center justify-center py-8">
        <div
          className="pointer-events-none absolute left-1 top-12 z-10 -rotate-12 rounded-xl border-[3px] border-sage bg-paper/70 px-4 py-2 text-lg font-bold tracking-wider text-sage-deep"
          style={{ opacity: clamp(dragX / 110) }}
        >
          {t("review.knowBadge")}
        </div>
        <div
          className="pointer-events-none absolute right-1 top-12 z-10 rotate-12 rounded-xl border-[3px] border-warn bg-paper/70 px-4 py-2 text-lg font-bold tracking-wider text-warn-text"
          style={{ opacity: clamp(-dragX / 110) }}
        >
          {t("review.learningBadge")}
        </div>

        <div
          className="w-full max-w-[560px] select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerCancel}
          onClick={onFlip}
          style={{
            transform: `translateX(${dragX}px) rotate(${dragX * 0.035}deg)`,
            transition: dragging ? "none" : "transform 0.34s cubic-bezier(.22,.8,.26,1)",
            cursor: dragging ? "grabbing" : "grab",
            touchAction: "pan-y",
          }}
        >
          <div className="flip-scene">
            <div className={cn("flip-card", flipped && "is-flipped")}>
              {/* FRONT — the layout's front fields, first one as the hero */}
              <div className="flip-face flex min-h-[320px] flex-col rounded-[30px] border border-black/[0.07] bg-surface p-8 shadow-[0_30px_60px_rgba(46,42,38,0.13)]">
                <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                  {frontFields.map((f, i) => (
                    <div key={f}>{fieldNode(f, i === 0)}</div>
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
                      {fieldNode(f, false)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid w-full max-w-[560px] grid-cols-4 gap-2">
        <button
          onClick={() => commit(1, word)}
          className="flex flex-col items-center rounded-2xl bg-warn-bg py-2.5 font-bold text-warn-text transition-transform active:scale-95"
        >
          <span className="text-sm">{t("review.again")}</span>
          <span className="text-[11px] font-medium opacity-70">{fmtInterval(iv.again, t)}</span>
        </button>
        <button
          onClick={() => commit(2, word)}
          className="flex flex-col items-center rounded-2xl border border-black/[0.1] bg-surface py-2.5 font-bold text-ink-muted transition-transform active:scale-95"
        >
          <span className="text-sm">{t("review.hard")}</span>
          <span className="text-[11px] font-medium opacity-70">{fmtInterval(iv.hard, t)}</span>
        </button>
        <button
          onClick={() => commit(3, word)}
          className="flex flex-col items-center rounded-2xl bg-sage py-2.5 font-bold text-white transition-transform active:scale-95"
        >
          <span className="text-sm">{t("review.good")}</span>
          <span className="text-[11px] font-medium opacity-80">{fmtInterval(iv.good, t)}</span>
        </button>
        <button
          onClick={() => commit(4, word)}
          className="flex flex-col items-center rounded-2xl bg-sage-deep py-2.5 font-bold text-white transition-transform active:scale-95"
        >
          <span className="text-sm">{t("review.easy")}</span>
          <span className="text-[11px] font-medium opacity-80">{fmtInterval(iv.easy, t)}</span>
        </button>
      </div>
      <p className="mt-4 text-[13px] font-medium text-ink-faint">
        {t("review.dragHint")}
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
