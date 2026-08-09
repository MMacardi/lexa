"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { pairLabel } from "@/lib/langs";
import { useI18n } from "@/lib/i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ErrorState";
import { EditWordForm } from "@/components/EditWordForm";
import { CollectionChips } from "@/components/CollectionChips";
import { SpeakButton } from "@/components/SpeakButton";
import { HighlightWord } from "@/components/HighlightWord";
import { ExplainChat } from "@/components/ExplainChat";
import { WordFamilyGraph } from "@/components/WordFamilyGraph";
import { PrintCardModal } from "@/components/PrintCardModal";

const targetFont = (lang: string) => (lang === "zh" ? "font-zh" : "");

function Pills({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <span
            key={it}
            className="rounded-full border border-black/[0.06] bg-sage-tint px-2.5 py-0.5 text-sm text-sage-deep"
          >
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

export default function WordDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const [printing, setPrinting] = useState(false);
  const { data: word, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["word", id],
    queryFn: () => api.getWord(id),
  });
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
        <Pills label={t("word.collocations")} items={word.collocations} />
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
            {ex.sourceUrl.trim() && ex.sourceName.trim() !== "Manual entry" ? (
              <a
                href={ex.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-block text-sm font-semibold text-sage hover:text-sage-deep hover:underline"
              >
                🔗 {ex.sourceName}
              </a>
            ) : ex.sourceName.trim() && ex.sourceName.trim() !== "Manual entry" ? (
              <div className="mt-3 text-[13px] font-semibold tracking-[0.04em] text-ink-faint">— {ex.sourceName}</div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
