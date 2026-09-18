"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Flag, Plus } from "lucide-react";
import { api, type DeckWord, type ReportReason } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { errText } from "@/lib/errText";
import { pairLabel } from "@/lib/langs";
import { DeckAuthor, DeckCounters } from "@/components/DeckCard";
import { ErrorState } from "@/components/ErrorState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const targetFont = (lang: string) => (lang === "zh" || lang === "zh-Hant" ? "font-zh" : "");

export default function DeckPage() {
  return (
    <Suspense fallback={<DeckSkeleton />}>
      <DeckView />
    </Suspense>
  );
}

function DeckSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-24 rounded-[18px]" />
      <Skeleton className="h-64 rounded-[18px]" />
    </div>
  );
}

function DeckView() {
  const { id } = useParams<{ id: string }>();
  const code = useSearchParams().get("code") ?? undefined;
  const { t } = useI18n();
  const qc = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  const { data: deck, isLoading, error } = useQuery({
    queryKey: ["community", "deck", id, code],
    queryFn: () => api.deck(id, code),
    retry: false,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["community"] });
    qc.invalidateQueries({ queryKey: ["words"] });
    qc.invalidateQueries({ queryKey: ["collections"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  };

  const copyAll = useMutation({
    mutationFn: () => api.copyDeck(id, { code }),
    onSuccess: (r) => {
      setNotice(r.added ? t("community.addedN", { n: r.added }) : t("community.nothingNew"));
      refresh();
    },
  });
  const copyOne = useMutation({
    mutationFn: (wordId: string) => api.copyDeck(id, { code, wordIds: [wordId] }),
    onSuccess: refresh,
  });

  if (isLoading) return <DeckSkeleton />;
  if (error || !deck)
    return (
      <div className="space-y-4">
        <BackLink />
        <ErrorState message={errText(error, t)} />
      </div>
    );

  const fresh = deck.words.filter((w) => !w.owned).length;

  return (
    <div className="anim-fade-up space-y-7">
      <div className="space-y-3">
        <BackLink />
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-serif text-[28px] font-medium break-words sm:text-[34px] leading-tight tracking-[-0.01em] text-ink">{deck.name}</h1>
          <span className="rounded-full bg-sage-tint px-2 py-0.5 text-[11px] font-semibold text-sage-deep">
            {pairLabel(deck.sourceLang, deck.targetLang)}
          </span>
        </div>
        <DeckAuthor deck={deck} link />
        {deck.description && <p className="text-ink-soft">{deck.description}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] font-medium text-ink-soft">
            {deck.count === 1 ? t("col.word", { n: deck.count }) : t("col.words", { n: deck.count })}
          </span>
          <DeckCounters deck={deck} />
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          {deck.mine ? (
            <Link
              href="/collections"
              className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-surface px-4 py-2 text-sm font-semibold text-ink-muted hover:bg-black/[0.03]"
            >
              {t("community.yourDeck")} →
            </Link>
          ) : (
            <>
              <Button onClick={() => copyAll.mutate()} disabled={copyAll.isPending}>
                {copyAll.isPending
                  ? t("community.adding")
                  : fresh > 0
                    ? t("community.addDeck", { n: fresh })
                    : t("community.addDeckAgain")}
              </Button>
              {deck.copiedCollectionId && (
                <Link href={`/collections/${deck.copiedCollectionId}`} className="text-sm font-semibold text-sage-deep hover:underline">
                  {t("community.openCopy")} →
                </Link>
              )}
            </>
          )}
        </div>
        {!deck.mine && <p className="text-[13px] text-ink-faint">{t("community.copyHint")}</p>}
        {notice && <p className="text-sm font-semibold text-sage-deep">{notice}</p>}
        {(copyAll.isError || copyOne.isError) && (
          <p className="text-sm font-medium text-warn-text">{errText(copyAll.error ?? copyOne.error, t)}</p>
        )}
        {!deck.mine && <ReportDeck id={id} code={code} />}
      </div>

      <div className="divide-y divide-black/[0.05] overflow-hidden rounded-[16px] border border-black/[0.06] bg-surface">
        {deck.words.map((w) => (
          <WordRow
            key={w.id}
            w={w}
            canAdd={!deck.mine}
            pending={copyOne.isPending && copyOne.variables === w.id}
            onAdd={() => copyOne.mutate(w.id)}
          />
        ))}
      </div>
    </div>
  );
}

function BackLink() {
  const { t } = useI18n();
  return (
    <Link href="/community" className="text-sm font-semibold text-ink-soft hover:text-ink">
      ← {t("nav.community")}
    </Link>
  );
}

const REASONS: ReportReason[] = ["spam", "offensive", "wrong", "other"];

/** Quiet "Report" link under the deck header; opens a small reason picker. */
function ReportDeck({ id, code }: { id: string; code?: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const send = useMutation({
    mutationFn: () => api.reportDeck(id, { reason: reason!, note: note.trim() || undefined, code }),
  });

  if (send.isSuccess) return <p className="text-[13px] font-medium text-sage-deep">{t("report.thanks")}</p>;
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink-faint hover:text-ink-soft"
      >
        <Flag className="h-3.5 w-3.5" /> {t("report.button")}
      </button>
    );
  return (
    <div className="space-y-3 rounded-[14px] border border-black/[0.06] bg-paper/60 p-4">
      <p className="text-sm font-semibold text-ink">{t("report.title")}</p>
      <div className="flex flex-wrap gap-1.5">
        {REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className={cn(
              "rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors",
              r === reason ? "bg-sage text-white" : "border border-black/[0.07] bg-surface text-ink-muted hover:bg-black/[0.03]",
            )}
          >
            {t(`report.${r}`)}
          </button>
        ))}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("report.notePh")}
        maxLength={500}
        rows={2}
        className="w-full resize-none rounded-[14px] border border-black/[0.1] bg-surface px-3 py-2.5 text-[14px] text-ink outline-none placeholder:text-ink-faint focus:border-sage/60"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => send.mutate()} disabled={!reason || send.isPending}>
          {send.isPending ? t("report.sending") : t("report.send")}
        </Button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm font-semibold text-ink-soft hover:text-ink">
          {t("report.cancel")}
        </button>
      </div>
      {send.isError && <p className="text-sm font-medium text-warn-text">{errText(send.error, t)}</p>}
    </div>
  );
}

function WordRow({ w, canAdd, pending, onAdd }: { w: DeckWord; canAdd: boolean; pending: boolean; onAdd: () => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-serif text-[18px] font-semibold text-ink">{w.word}</span>
          {w.phonetic && <span className="text-sm text-ink-faint">{w.phonetic}</span>}
          {w.partOfSpeech && (
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{w.partOfSpeech}</span>
          )}
        </div>
        {w.meaning && <p className={cn("text-sm text-sage-deep", targetFont(w.targetLang))}>{w.meaning}</p>}
        {w.example && (
          <p className="mt-1 text-[13px] text-ink-soft">
            {w.example.sentenceEn}
            {w.example.sentenceZh && <span className={cn("text-ink-faint", targetFont(w.targetLang))}> — {w.example.sentenceZh}</span>}
          </p>
        )}
        {w.synonyms.length > 0 && (
          <p className="mt-0.5 text-[12px] text-ink-faint">≈ {w.synonyms.join(", ")}</p>
        )}
      </div>
      {canAdd &&
        (w.owned ? (
          <span className="inline-flex shrink-0 items-center gap-1 pt-1 text-[12px] font-semibold text-sage-deep" title={t("community.haveIt")}>
            <Check className="h-4 w-4" /> {t("community.haveIt")}
          </span>
        ) : (
          <button
            onClick={onAdd}
            disabled={pending}
            aria-label={t("community.addWord")}
            title={t("community.addWord")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-sage/40 text-sage-deep transition-colors hover:bg-sage-tint disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
          </button>
        ))}
    </div>
  );
}
