"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn, safeHttpUrl } from "@/lib/utils";
import { pairLabel } from "@/lib/langs";
import { useI18n } from "@/lib/i18n";
import { useDialog } from "@/lib/dialog";
import { useToast } from "@/lib/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { EditWordForm } from "@/components/EditWordForm";
import { CollectionChips } from "@/components/CollectionChips";
import { SpeakButton } from "@/components/SpeakButton";
import { HighlightWord } from "@/components/HighlightWord";
import { ExplainChat } from "@/components/ExplainChat";
import { TapGlossPills } from "@/components/TapGlossPills";
import { Link as LinkIcon, BookOpen, Trash2 } from "lucide-react";
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
function openInReader(router: ReturnType<typeof useRouter>, text: string, sourceLang: string, targetLang: string) {
  try {
    sessionStorage.setItem("lexa.readerPrefill", JSON.stringify({ text, sourceLang, targetLang }));
  } catch {
    /* ignore storage errors */
  }
  router.push("/reader");
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
  const { data: word, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["word", id],
    queryFn: () => api.getWord(id),
  });

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
      show({ icon: "⚠️", title: (e as Error).message });
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
          message={(error as Error)?.message ?? t("word.notFound")}
          onRetry={() => refetch()}
        />
      </div>
    );

  const filled = word.reviewCount >= 5 ? 3 : word.reviewCount >= 3 ? 2 : word.reviewCount >= 1 ? 1 : 0;

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
            <button
              onClick={removeCard}
              disabled={deleting}
              aria-label={t("word.delete")}
              title={t("word.delete")}
              className="inline-flex items-center gap-1.5 rounded-full border border-warn-text/30 px-3 py-1.5 text-xs font-semibold text-warn-text transition-colors hover:bg-warn-bg disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {editing && <EditWordForm word={word} onDone={() => setEditing(false)} />}
      {printing && <PrintCardModal word={word} onClose={() => setPrinting(false)} />}

      <div className="space-y-2.5">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-[44px] font-semibold leading-none tracking-[-0.02em] text-ink">
            {word.word}
          </h1>
          <SpeakButton text={word.word} lang={word.sourceLang} />
          {word.phonetic && <span className="text-[18px] text-ink-faint">{word.phonetic}</span>}
          {word.partOfSpeech && (
            <span className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
              {word.partOfSpeech}
            </span>
          )}
          <span className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-semibold text-sage-deep">
            {pairLabel(word.sourceLang, word.targetLang)}
          </span>
        </div>
        {word.meaningZh && (
          <p className={cn("text-[22px] font-medium text-sage-deep", targetFont(word.targetLang))}>
            {word.meaningZh}
          </p>
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
      </div>

      <CollectionChips word={word} />

      {word.notes && word.notes.trim() && (
        <div className="rounded-[18px] border border-black/[0.06] bg-paper/60 p-4">
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{t("edit.notes")}</p>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{word.notes}</p>
        </div>
      )}

      {/* AI tutor — on-demand explanation + follow-up mini-chat that can also add
          synonyms/antonyms to the card (opt-in, LLM calls) */}
      <ExplainChat word={word} />

      {word.collocations.length > 0 && (
        <TapGlossPills
          label={t("word.collocations")}
          items={word.collocations}
          sourceLang={word.sourceLang}
          targetLang={word.targetLang}
        />
      )}

      {/* synonyms + antonyms as a tappable mini word-family graph */}
      <WordFamilyGraph word={word} />

      <div className="space-y-3">
        {word.examples.length > 0 && (
          <h2 className="font-serif text-[15px] font-medium italic text-ink-soft">
            {t("word.inContext")}
          </h2>
        )}
        {word.examples.map((ex) => (
          <div
            key={ex.id}
            className="rounded-[18px] border border-black/[0.06] bg-surface p-5"
          >
            <p className="whitespace-pre-line font-serif text-[19px] leading-relaxed text-ink">
              <HighlightWord text={ex.sentenceEn} word={word.word} />
            </p>
            {ex.sentenceZh && (
              <p className={cn("mt-2 whitespace-pre-line text-[15px] text-ink-soft", targetFont(word.targetLang))}>
                {ex.sentenceZh}
              </p>
            )}
            {safeHttpUrl(ex.sourceUrl) && ex.sourceName.trim() !== "Manual entry" ? (
              <a
                href={safeHttpUrl(ex.sourceUrl)!}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-sage hover:text-sage-deep hover:underline"
              >
                <LinkIcon className="h-3.5 w-3.5" /> {ex.sourceName}
              </a>
            ) : ex.sourceName.trim() && ex.sourceName.trim() !== "Manual entry" ? (
              <div className="mt-3 text-[13px] font-semibold tracking-[0.04em] text-ink-faint">— {ex.sourceName}</div>
            ) : null}
            <button
              type="button"
              onClick={() => openInReader(router, ex.sentenceEn, word.sourceLang, word.targetLang)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-3 py-1.5 text-[12px] font-semibold text-ink-muted transition-colors hover:border-sage/60 hover:text-sage-deep"
            >
              <BookOpen className="h-3.5 w-3.5" /> {t("word.openInReader")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
