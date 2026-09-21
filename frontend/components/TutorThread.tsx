"use client";

import type { TutorChat } from "@/lib/useTutorChat";
import { useI18n } from "@/lib/i18n";
import { displayCode, pairLabel } from "@/lib/langs";
import { CollectionMultiSelect } from "@/components/CollectionMultiSelect";
import { RichText } from "@/components/RichText";
import { HoverTip } from "@/components/ui/HoverTip";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";

// Mika's messages + the "create cards" picker under answers that suggest words.
// Shared by the floating widget and the /mika page; `large` = the roomier page sizing.
export function TutorThread({ chat, large = false }: { chat: TutorChat; large?: boolean }) {
  const { t } = useI18n();
  const {
    messages,
    pair,
    langOf,
    wordSel,
    setWordSel,
    toggleWord,
    isAdded,
    collections,
    collIds,
    setCollIds,
    creating,
    createCards,
    busy,
    streaming,
    isError,
    card,
    addToCard,
    addExampleToCard,
  } = chat;

  return (
    <>
      {messages.map((m, i) =>
        m.role === "assistant" ? (
          <div key={i} className="anim-msg space-y-2">
            <RichText text={m.content} streaming={m.streaming} className={cn("text-ink", large ? "text-[15px]" : "text-[14px]")} />
            {m.addWords &&
              m.addWords.length > 0 &&
              (() => {
                const all = m.addWords;
                // A suggestion keeps its own language: a Chinese word asked about
                // inside an English chat is saved as a Chinese card, not an English one.
                const langs = new Map(all.map((w) => [w, langOf(i, w)]));
                const addable = all.filter((w) => !isAdded(w, langs.get(w) ?? pair.source)); // exclude ones already in the deck
                const selected = (wordSel[i] ?? addable).filter((w) => !isAdded(w, langs.get(w) ?? pair.source));
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
                        const lang = langs.get(w) ?? pair.source;
                        const foreign = displayCode(lang) !== displayCode(pair.source);
                        const added = isAdded(w, lang);
                        const on = !added && selected.includes(w);
                        return (
                          <HoverTip
                            key={w}
                            title={added ? t("tutor.alreadyAdded") : foreign ? t("tutor.savedAs", { pair: pairLabel(lang, pair.target) }) : ""}
                            className="inline-flex"
                          >
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
                              {/* another language than the chat's — say which pair it lands in */}
                              {foreign && (
                                <span
                                  className={cn(
                                    "rounded-full px-1 text-[10px] font-bold uppercase leading-[15px]",
                                    on ? "bg-white/25 text-white" : "bg-black/[0.06] text-ink-faint",
                                  )}
                                >
                                  {displayCode(lang)}
                                </span>
                              )}
                            </button>
                          </HoverTip>
                        );
                      })}
                    </div>
                    {/* The sets load a moment after a reload — hold the row's place so
                        the card doesn't grow under the learner's thumb. */}
                    {!collections ? (
                      <div className="flex items-center gap-2" aria-hidden>
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("tutor.toSet")}</span>
                        <span className="h-9 w-[160px] animate-pulse rounded-[12px] bg-black/[0.05]" />
                      </div>
                    ) : collections.length > 0 ? (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{t("tutor.toSet")}</span>
                        <CollectionMultiSelect options={collections} value={collIds} onChange={setCollIds} menuClassName="max-h-48" />
                      </div>
                    ) : null}
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
            {/* A chat about a card can edit it: the tutor's suggestions are one tap
                away from the word's own synonyms, antonyms and examples. */}
            {card && (m.addExamples?.length || m.addSynonyms?.length || m.addAntonyms?.length) ? (
              <div className="flex flex-wrap gap-1.5">
                {m.addExamples?.map((ex, k) => (
                  <button
                    key={k}
                    type="button"
                    disabled={creating}
                    onClick={() => addExampleToCard(i, ex)}
                    className="max-w-full rounded-full border border-sage/50 bg-sage-tint px-3 py-1 text-left text-[12px] font-semibold text-sage-deep hover:bg-sage-tint/70 disabled:opacity-50"
                  >
                    ＋ {t("word.addExample")}: <span className="font-normal">{ex.sentence}</span>
                  </button>
                ))}
                {m.addSynonyms && m.addSynonyms.length > 0 && (
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => addToCard(i, "syn", m.addSynonyms!)}
                    className="rounded-full border border-sage/50 bg-sage-tint px-3 py-1 text-[12px] font-semibold text-sage-deep hover:bg-sage-tint/70 disabled:opacity-50"
                  >
                    ＋ {t("word.synonyms")}: {m.addSynonyms.join(", ")}
                  </button>
                )}
                {m.addAntonyms && m.addAntonyms.length > 0 && (
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => addToCard(i, "ant", m.addAntonyms!)}
                    className="rounded-full border border-warn/40 bg-warn-bg px-3 py-1 text-[12px] font-semibold text-warn-text hover:bg-warn-bg/70 disabled:opacity-50"
                  >
                    ＋ {t("word.antonyms")}: {m.addAntonyms.join(", ")}
                  </button>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <div key={i} className="anim-msg flex justify-end">
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
      {/* "Thinking" only until the first token — after that the answer types itself out. */}
      {busy && !streaming && (
        <p className="anim-fade-in flex items-center gap-2 text-sm text-ink-soft" role="status">
          <span className="typing-dots" aria-hidden>
            <span />
            <span />
            <span />
          </span>
          {t("word.thinking")}
        </p>
      )}
      {isError && <p className="text-sm text-warn-text">{t("word.askError")}</p>}
    </>
  );
}
