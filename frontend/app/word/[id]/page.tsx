"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
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
import { downloadShareCard } from "@/lib/shareCard";

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
  const { data: word, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["word", id],
    queryFn: () => api.getWord(id),
  });
  // On-demand AI explanation (costs one LLM call per click — kept opt-in).
  const explain = useMutation({ mutationFn: () => api.explainWord(id) });

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
              onClick={() =>
                downloadShareCard({
                  word: word.word,
                  phonetic: word.phonetic,
                  partOfSpeech: word.partOfSpeech,
                  meaning: word.meaningZh,
                  example: word.examples[0]?.sentenceEn,
                  source: word.examples[0]?.sourceName,
                })
              }
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

      {/* AI explanation — on demand (opt-in, one LLM call) */}
      {explain.data || explain.isPending || explain.isError ? (
        <div className="rounded-[18px] border border-sage/25 bg-sage-tint/40 p-5">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-serif text-[15px] font-medium italic text-sage-deep">{t("word.explainTitle")}</h2>
            {explain.data && (
              <button
                type="button"
                onClick={() => explain.mutate()}
                className="text-xs font-semibold text-sage hover:text-sage-deep"
              >
                ↻ {t("edit.regenerate")}
              </button>
            )}
          </div>
          {explain.isPending && <p className="mt-2 text-sm text-ink-soft">{t("word.explaining")}</p>}
          {explain.data && (
            <p className="mt-2 whitespace-pre-wrap text-[15px] leading-relaxed text-ink">{explain.data.explanation}</p>
          )}
          {explain.isError && <p className="mt-2 text-sm text-warn-text">{(explain.error as Error).message}</p>}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => explain.mutate()}
          className="inline-flex items-center gap-2 rounded-full border border-sage/40 bg-sage-tint/40 px-4 py-2 text-sm font-semibold text-sage-deep transition-colors hover:bg-sage-tint"
        >
          🤔 {t("word.explain")}
        </button>
      )}

      <div className="grid gap-5 sm:grid-cols-3">
        <Pills label={t("word.collocations")} items={word.collocations} />
        <Pills label={t("word.synonyms")} items={word.synonyms} />
        <Pills label={t("word.antonyms")} items={word.antonyms} />
      </div>

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
            <p className="font-serif text-[19px] leading-relaxed text-ink">{ex.sentenceEn}</p>
            {ex.sentenceZh && (
              <p className={cn("mt-2 text-[15px] text-ink-soft", targetFont(word.targetLang))}>
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
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
