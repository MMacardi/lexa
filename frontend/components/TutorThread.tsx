"use client";

import type { TutorChat } from "@/lib/useTutorChat";
import { useI18n } from "@/lib/i18n";
import { CollectionMultiSelect } from "@/components/CollectionMultiSelect";
import { RichText } from "@/components/RichText";
import { HoverTip } from "@/components/ui/HoverTip";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

// Mika's messages + the "create cards" picker under answers that suggest words.
// Shared by the floating widget and the /mika page; `large` = the roomier page sizing.
export function TutorThread({ chat, large = false }: { chat: TutorChat; large?: boolean }) {
  const { t } = useI18n();
  const { messages, wordSel, setWordSel, toggleWord, isAdded, collections, collIds, setCollIds, creating, createCards, busy, isError } = chat;

  return (
    <>
      {messages.map((m, i) =>
        m.role === "assistant" ? (
          <div key={i} className="space-y-2">
            <RichText text={m.content} className={cn("text-ink", large ? "text-[15px]" : "text-[14px]")} />
            {m.addWords &&
              m.addWords.length > 0 &&
              (() => {
                const all = m.addWords;
                const addable = all.filter((w) => !isAdded(w)); // exclude ones already in the deck
                const selected = (wordSel[i] ?? addable).filter((w) => !isAdded(w));
                return (
                  <div className={cn("space-y-2 rounded-[14px] border border-sage/25 bg-sage-tint/40 p-2.5", large && "p-3.5")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                        {t("reader.selectedN", { n: selected.length })}
                      </span>
                      <div className="flex gap-2 text-[11px] font-semibold">
                        <button type="button" onClick={() => setWordSel((s) => ({ ...s, [i]: [...addable] }))} className="text-sage hover:text-sage-deep">
                          {t("reader.selectAllNew")}
                        </button>
                        <button type="button" onClick={() => setWordSel((s) => ({ ...s, [i]: [] }))} className="text-ink-faint hover:text-ink-muted">
                          {t("reader.deselectAll")}
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {all.map((w) => {
                        const added = isAdded(w);
                        const on = !added && selected.includes(w);
                        return (
                          <HoverTip key={w} title={added ? t("tutor.alreadyAdded") : ""} className="inline-flex">
                            <button
                              type="button"
                              disabled={added}
                              onClick={() => toggleWord(i, addable, w)}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium transition-colors",
                                added
                                  ? "cursor-default border-black/[0.08] bg-black/[0.03] text-ink-faint line-through opacity-70"
                                  : on
                                    ? "border-sage bg-sage text-white"
                                    : "border-black/[0.12] bg-surface text-ink-muted hover:border-sage/60",
                              )}
                            >
                              {added && <Check className="h-3 w-3 shrink-0" />}
                              {w}
                            </button>
                          </HoverTip>
                        );
                      })}
                    </div>
                    {collections && collections.length > 0 && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("tutor.toSet")}</span>
                        <CollectionMultiSelect options={collections} value={collIds} onChange={setCollIds} menuClassName="max-h-48" />
                      </div>
                    )}
                    <button
                      type="button"
                      disabled={creating || selected.length === 0}
                      onClick={() => createCards(i, selected)}
                      className={cn(
                        "rounded-full bg-sage px-3 py-2 text-[13px] font-semibold text-white hover:bg-sage-deep disabled:opacity-50",
                        large ? "px-5" : "w-full",
                      )}
                    >
                      ＋ {t("word.createCards")} ({selected.length})
                    </button>
                  </div>
                );
              })()}
          </div>
        ) : (
          <div key={i} className="flex justify-end">
            <span
              className={cn(
                "max-w-[85%] whitespace-pre-wrap rounded-[14px] rounded-br-sm bg-sage px-3.5 py-2 font-medium text-white",
                large ? "text-[15px]" : "text-[13px]",
              )}
            >
              {m.content}
            </span>
          </div>
        ),
      )}
      {busy && <p className="text-sm text-ink-soft">{t("word.thinking")}</p>}
      {isError && <p className="text-sm text-warn-text">{t("word.askError")}</p>}
    </>
  );
}
