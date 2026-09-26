"use client";

import { HskBadge } from "@/components/HskBadge";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn, safeHttpUrl } from "@/lib/utils";
import { isAiSupported, pairLabel } from "@/lib/langs";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { useDialog } from "@/lib/dialog";
import { useToast } from "@/lib/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { EditWordForm } from "@/components/EditWordForm";
import { CollectionChips } from "@/components/CollectionChips";
import { SpeakButton } from "@/components/SpeakButton";
import { PronounceButton } from "@/components/PronounceButton";
import { HoverTip } from "@/components/ui/HoverTip";
import { ExampleText } from "@/components/ExampleText";
import { setExamplePinyin, useExamplePinyin } from "@/lib/learnPrefs";
import { WordSenses } from "@/components/WordSenses";
import { AddExampleInline } from "@/components/AddExampleInline";
import { openMikaOnCard } from "@/lib/mobileNav";
import { DictMeaningLabel, pollWhileUpgrading, shownMeaning, upgradePending } from "@/components/DictMeaningLabel";
import { Link as LinkIcon, BookOpen, Lightbulb, Sparkles, Trash2 } from "lucide-react";
import dynamic from "next/dynamic";

// Heavy, on-demand widgets: the physics word-family graph and the canvas-based
// print modal. Code-splitting them keeps the initial word-page bundle lean; they
// load only when this page mounts the graph / opens the modal.
const WordFamilyGraph = dynamic(() => import("@/components/WordFamilyGraph").then((m) => m.WordFamilyGraph), {
  ssr: false,
  loading: () => <Skeleton className="h-[320px] w-full rounded-[20px]" />,
});
const PrintCardModal = dynamic(() => import("@/components/PrintCardModal").then((m) => m.PrintCardModal), {
  ssr: false,
});

const targetFont = (lang: string) => (lang === "zh" || lang === "zh-Hant" ? "font-zh" : "");

// Hand a sentence off to the Reader (full tap-to-look-up), pre-filling its text
// and language pair via sessionStorage so it survives the navigation.
function openInReader(
  router: ReturnType<typeof useRouter>,
  text: string,
  sourceLang: string,
  targetLang: string,
  word?: string,
  source?: string,
) {
  try {
    // `source` is the example's attribution (a saved text's title when it came
    // from the Reader) — the Reader uses it to reopen that FULL text if it still
    // exists, instead of just this one sentence.
    sessionStorage.setItem("lexa.readerPrefill", JSON.stringify({ text, sourceLang, targetLang, word, source }));
  } catch {
    /* ignore storage errors */
  }
  router.push("/reader");
}

// Attributions that are not a saved reader text (so don't try to reopen a text).
const NON_TEXT_SOURCE = new Set(["", "Manual entry", "Onomika AI", "Imported list"]);

// An example added from the Reader carries the text's title as its source and no
// URL. We label those "«title» (reader)" and let "Open in Reader" reopen the text.
function isReaderSource(ex: { sourceName: string; sourceUrl: string }): boolean {
  return !ex.sourceUrl?.trim() && !!ex.sourceName?.trim() && !NON_TEXT_SOURCE.has(ex.sourceName.trim());
}

export default function WordDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { t } = useI18n();
  const qc = useQueryClient();
  const { confirm } = useDialog();
  const { show } = useToast();
  const [editing, setEditing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [filling, setFilling] = useState(false);
  const examplePinyin = useExamplePinyin();
  const { data: word, isLoading, isError, refetch } = useQuery({
    queryKey: ["word", id],
    queryFn: () => api.getWord(id),
    // A card made from the dictionary a moment ago: its meaning is on its way.
    refetchInterval: (q) => pollWhileUpgrading(q.state.data ? [q.state.data] : null),
  });

  // "Fill this in": the recovery for a card whose enrichment failed or was
  // stopped, so no card stays without a meaning in the learner's language.
  async function fillIn() {
    if (!word || filling) return;
    setFilling(true);
    try {
      const fresh = await api.enrichWord(word.id);
      qc.setQueryData(["word", id], fresh);
      qc.invalidateQueries({ queryKey: ["words"] });
      show({ icon: "✨", title: t("capture.filled") });
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
    } finally {
      setFilling(false);
    }
  }

  async function removeCard() {
    if (!word || deleting) return;
    const ok = await confirm({
      title: t("word.deleteTitle"),
      message: t("word.deleteConfirm", { word: word.word }),
      confirmLabel: t("word.delete"),
      tone: "danger",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await api.deleteWord(word.id);
      qc.invalidateQueries({ queryKey: ["words"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      show({ icon: "🗑", title: t("word.deleted") });
      router.push("/words");
    } catch (e) {
      show({ icon: "⚠️", title: errText(e, t) });
      setDeleting(false);
    }
  }
  if (isLoading)
    return (
      <div className="space-y-6">
        <Link href="/words" className="text-sm font-semibold text-ink-soft hover:text-ink">
          {t("word.back")}
        </Link>
        <Skeleton className="h-10 w-52" />
        <Skeleton className="h-6 w-72" />
        <Skeleton className="h-28 rounded-[18px]" />
      </div>
    );
  if (isError || !word)
    return (
      <div className="space-y-4">
        <Link href="/words" className="text-sm font-semibold text-ink-soft hover:text-ink">
          {t("word.back")}
        </Link>
        <ErrorState
          message={t("word.notFound")}
          onRetry={() => refetch()}
        />
      </div>
    );

  const filled = word.reviewCount >= 5 ? 3 : word.reviewCount >= 3 ? 2 : word.reviewCount >= 1 ? 1 : 0;
  // A card on the shared default whose upgrade never came has a meaning but no
  // example or details: that is a card to fill in too.
  const neverUpgraded = Boolean(word.dictDefault) && !word.partOfSpeech && word.examples.length === 0;
  const needsFill =
    isAiSupported(word.sourceLang) &&
    !upgradePending(word) &&
    (!word.meaningZh?.trim() || Boolean(word.dictMeaning) || neverUpgraded);

  return (
    <div className="anim-fade-up space-y-7">
      <div className="flex items-center justify-between">
        <Link href="/words" className="text-sm font-semibold text-ink-soft hover:text-ink">
          {t("word.back")}
        </Link>
        {!editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPrinting(true)}
              className="rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
            >
              {t("word.share")}
            </button>
            <button
              onClick={() => setEditing(true)}
              className="rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted hover:bg-black/[0.03]"
            >
              {t("word.edit")}
            </button>
            <HoverTip title={t("word.delete")} className="inline-flex">
              <button
                onClick={removeCard}
                disabled={deleting}
                aria-label={t("word.delete")}
                className="inline-flex items-center gap-1.5 rounded-full border border-warn-text/30 px-3 py-1.5 text-xs font-semibold text-warn-text transition-colors hover:bg-warn-bg disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </HoverTip>
          </div>
        )}
      </div>

      {editing && <EditWordForm word={word} onDone={() => setEditing(false)} />}
      {printing && <PrintCardModal word={word} onClose={() => setPrinting(false)} />}

      <div className="space-y-2.5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-[36px] font-semibold leading-none tracking-[-0.02em] break-words text-ink sm:text-[44px]">
            {word.word}
          </h1>
          <SpeakButton text={word.word} lang={word.sourceLang} />
          <PronounceButton text={word.word} lang={word.sourceLang} />
          {word.phonetic && <span className="text-[18px] text-ink-faint">{word.phonetic}</span>}
          {word.partOfSpeech && (
            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
              {word.partOfSpeech}
            </span>
          )}
          <span className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-semibold text-sage-deep">
            {pairLabel(word.sourceLang, word.targetLang)}
          </span>
          <HskBadge hsk={word.hsk} />
        </div>
        {shownMeaning(word) && (
          <p className={cn("text-[22px] font-medium text-sage-deep", targetFont(word.dictMeaning ? "en" : word.targetLang))}>
            {word.meaningZh}
          </p>
        )}
        <DictMeaningLabel word={word} className="block" />
        {needsFill && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              onClick={fillIn}
              disabled={filling}
              className="inline-flex items-center gap-1.5 rounded-full border border-sage/40 bg-sage-tint px-3 py-1.5 text-xs font-semibold text-sage-deep transition-colors hover:bg-sage-tint/70 disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {filling ? "…" : t("capture.fill")}
            </button>
            <span className="text-xs text-ink-faint">{t("capture.fillHint")}</span>
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={cn("h-2 w-8 rounded-full", i < filled ? "bg-sage" : "bg-dot-empty")}
            />
          ))}
          <span className="ml-2 text-xs font-semibold text-ink-faint">
            {t("word.reviewedTimes", { n: word.reviewCount })}
          </span>
        </div>
        {/* The other half of knowing a word: whether the learner can produce it. */}
        <div className="flex items-center gap-2 text-xs font-semibold">
          {word.canUseAt ? (
            <span className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] text-sage-deep">
              {t("word.canUse")}
            </span>
          ) : (
            <span className="text-ink-faint">
              {(word.produceAttempts ?? 0) > 0
                ? t("word.canUseSoon", { n: word.produceCorrect ?? 0, total: word.produceAttempts ?? 0 })
                : t("word.canUseUntried")}
            </span>
          )}
        </div>
        {word.sharedFrom && (
          <p className="text-[13px] text-ink-soft">
            {t("community.creditFrom")}{" "}
            {word.sharedDeckId ? (
              <Link href={`/community/${word.sharedDeckId}`} className="font-semibold text-sage-deep hover:underline">
                {t("community.credit", { author: word.sharedFrom, deck: word.sharedDeck ?? "" })}
              </Link>
            ) : (
              <span className="font-semibold">{t("community.credit", { author: word.sharedFrom, deck: word.sharedDeck ?? "" })}</span>
            )}
          </p>
        )}
      </div>

      <CollectionChips word={word} />

      {word.notes && word.notes.trim() && (
        <div className="rounded-[18px] border border-black/[0.06] bg-paper/60 p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("edit.notes")}</p>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{word.notes}</p>
        </div>
      )}

      {/* AI tutor — the explanation opens in the Mika widget, so it can be read
          beside the card instead of pushing the page down, and it joins the chat
          history like every other conversation (opt-in, LLM calls) */}
      <button
        type="button"
        onClick={() =>
          openMikaOnCard({ id: word.id, word: word.word, sourceLang: word.sourceLang, targetLang: word.targetLang })
        }
        className="inline-flex items-center gap-2 rounded-full border border-sage/40 bg-sage-tint/40 px-4 py-2 text-sm font-semibold text-sage-deep transition-colors hover:bg-sage-tint"
      >
        <Lightbulb className="h-4 w-4" /> {t("word.explain")}
      </button>

      {/* Pleco-style numbered senses (generated on first open, cached); pick
          which ones the card tests. Falls back to the collocation chips. */}
      <WordSenses word={word} />

      {/* synonyms + antonyms as a tappable mini word-family graph — kept in the
          focus pass: telling 近义词 apart is what HSK 4+ gap-fills test */}
      <WordFamilyGraph word={word} />

      <div className="space-y-3">
        {word.examples.length > 0 && (
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-serif text-[15px] font-medium italic text-ink-soft">{t("word.inContext")}</h2>
            {/* Pinyin over the sentences: one tap here, remembered (also in Settings). */}
            {(word.sourceLang === "zh" || word.sourceLang === "zh-Hant") && (
              <button
                type="button"
                onClick={() => setExamplePinyin(!examplePinyin)}
                aria-pressed={examplePinyin}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors",
                  examplePinyin
                    ? "border-sage bg-sage-tint text-sage-deep"
                    : "border-black/[0.08] bg-surface text-ink-muted hover:border-sage/60 hover:text-sage-deep",
                )}
              >
                {t("exPinyin.toggle")}
              </button>
            )}
          </div>
        )}
        {word.examples.map((ex) => (
          <div
            key={ex.id}
            className="rounded-[18px] border border-black/[0.06] bg-surface p-5"
          >
            <p className="whitespace-pre-line font-serif text-[19px] leading-relaxed text-ink">
              <ExampleText text={ex.sentenceEn} word={word.word} lang={word.sourceLang} />
            </p>
            {ex.sentenceZh && (
              <p className={cn("mt-2 whitespace-pre-line text-[15px] text-ink-soft", targetFont(word.targetLang))}>
                {ex.sentenceZh}
              </p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {safeHttpUrl(ex.sourceUrl) && ex.sourceName.trim() !== "Manual entry" ? (
                <a
                  href={safeHttpUrl(ex.sourceUrl)!}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-sage hover:text-sage-deep hover:underline"
                >
                  <LinkIcon className="h-3.5 w-3.5" /> {ex.sourceName}
                </a>
              ) : isReaderSource(ex) ? (
                <div className="text-[13px] font-semibold tracking-[0.04em] text-ink-faint">
                  — «{ex.sourceName}» {t("word.fromReader")}
                </div>
              ) : ex.sourceName.trim() && ex.sourceName.trim() !== "Manual entry" ? (
                <div className="text-[13px] font-semibold tracking-[0.04em] text-ink-faint">— {ex.sourceName}</div>
              ) : null}
              {ex.register && (
                <span className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-semibold text-sage-deep">
                  {t(`style.${ex.register}`)}
                </span>
              )}
              {ex.level && (
                <span className="rounded-full border border-black/[0.08] px-2 py-0.5 text-[11px] font-semibold text-ink-faint">
                  {ex.level}
                </span>
              )}
              <button
                type="button"
                onClick={() =>
                  openInReader(router, ex.sentenceEn, word.sourceLang, word.targetLang, word.word, isReaderSource(ex) ? ex.sourceName : undefined)
                }
                className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-muted transition-colors hover:border-sage/60 hover:text-sage-deep"
              >
                <BookOpen className="h-3.5 w-3.5" /> {t("word.openInReader")}
              </button>
            </div>
          </div>
        ))}
        <AddExampleInline word={word} />
      </div>
    </div>
  );
}
